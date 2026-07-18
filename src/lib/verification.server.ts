// Server-only lead verification checks (Phase 2 pipeline).
//
// Runs after Google Places discovery and enrichment, before leads are saved:
//   1. Website check — direct HTTP fetch of the claimed site, following up to
//      3 redirect hops with a hard 5s timeout per hop. Classifies the result
//      as live / dead / parked / redirect-social / none.
//   2. Freshness check — for live sites, cheap staleness heuristics on the
//      fetched body: copyright year, mobile viewport meta, HTTPS.
//   3. Business-alive signals — passed through from the Places response
//      (business status, rating, review count, most recent review date).
//   4. Composite 0-100 lead score — weighted toward no/dead website, business
//      clearly active, and phone number present.
//
// Results persist on the lead row: `verification` (jsonb) + `leadScore` (int).

import type { LeadVerification, VerificationTier, WebsiteCheckStatus } from "./types";

const CHECK_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 300_000;
const CURRENT_YEAR = new Date().getFullYear();

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linktr.ee",
  "linktree.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
];

const PARKED_PATTERNS =
  /domain (?:is|may be) for sale|buy this domain|this domain is parked|parked free|sedoparking|hugedomains|afternic|dan\.com|godaddy\.com\/domainsearch|is for sale!|domain expired|renew now|courtesy of (?:godaddy|namecheap)|web hosting provider|account (?:has been )?suspended/i;

export interface PlacesSignals {
  businessStatus?: string; // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  rating?: number;
  reviewCount?: number;
  lastReviewAt?: string; // ISO — most recent review publishTime when available
  utcOffsetMinutes?: number; // exact business UTC offset from Places (incl. DST at fetch)
}

function hostOf(u: string): string | null {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isSocialHost(host: string): boolean {
  return SOCIAL_HOSTS.some((d) => host === d || host.endsWith("." + d));
}

async function fetchOnce(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LeadBloomVerifier/1.0)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface WebsiteCheckResult {
  website: LeadVerification["website"];
  body?: string; // final page body for live sites — reused by the freshness check
}

/** HTTP check of a claimed website. Never throws. */
export async function checkWebsite(rawUrl: string | null | undefined): Promise<WebsiteCheckResult> {
  if (!rawUrl) return { website: { status: "none" } };
  let url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const original = url;
  let redirects = 0;

  try {
    for (;;) {
      const res = await fetchOnce(url);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc)
          return {
            website: {
              status: "dead",
              url: original,
              finalUrl: url,
              httpStatus: res.status,
              redirects,
              reason: "redirect with no target",
            },
          };
        const next = new URL(loc, url).toString();
        redirects++;
        const nextHost = hostOf(next);
        if (nextHost && isSocialHost(nextHost)) {
          return {
            website: {
              status: "redirect-social",
              url: original,
              finalUrl: next,
              httpStatus: res.status,
              redirects,
              reason: `redirects to ${nextHost}`,
            },
          };
        }
        if (redirects > MAX_REDIRECTS) {
          return {
            website: {
              status: "dead",
              url: original,
              finalUrl: next,
              httpStatus: res.status,
              redirects,
              reason: "too many redirects",
            },
          };
        }
        url = next;
        continue;
      }

      if (res.status >= 400) {
        return {
          website: {
            status: "dead",
            url: original,
            finalUrl: url,
            httpStatus: res.status,
            redirects,
            reason: `HTTP ${res.status}`,
          },
        };
      }

      // 2xx — read (a bounded slice of) the body and check for parking pages.
      let body = "";
      try {
        body = (await res.text()).slice(0, MAX_BODY_BYTES);
      } catch {
        /* body read failure still counts as live */
      }
      if (PARKED_PATTERNS.test(body)) {
        return {
          website: {
            status: "parked",
            url: original,
            finalUrl: url,
            httpStatus: res.status,
            redirects,
            reason: "parking/for-sale page detected",
          },
          body,
        };
      }
      return {
        website: {
          status: "live",
          url: original,
          finalUrl: url,
          httpStatus: res.status,
          redirects,
        },
        body,
      };
    }
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError" ? "timeout (5s)" : "connection failed";
    return { website: { status: "dead", url: original, finalUrl: url, redirects, reason } };
  }
}

/** Staleness heuristics on a live site's body. */
export function checkFreshness(
  body: string,
  finalUrl: string,
): NonNullable<LeadVerification["freshness"]> {
  const https = finalUrl.startsWith("https://");
  const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(body);
  let copyrightYear: number | undefined;
  const years = [...body.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((y) => y >= 2000 && y <= CURRENT_YEAR + 1);
  if (years.length) copyrightYear = Math.max(...years);

  const outdated =
    (copyrightYear !== undefined && copyrightYear <= CURRENT_YEAR - 2) ||
    !hasViewportMeta ||
    !https;
  return { copyrightYear, hasViewportMeta, https, outdated };
}

export interface ScoreInput {
  websiteStatus: WebsiteCheckStatus;
  outdated?: boolean;
  phone?: string;
  tier?: VerificationTier | null;
  signals?: PlacesSignals | null;
  /** Cross-checked against Places and not found there (multi-source discovery). */
  offGoogle?: boolean;
  /** Discovery source ids that independently found this business. */
  foundVia?: string[] | null;
}

/**
 * Composite 0-100 opportunity score. Weighted toward: no/dead website (the
 * product opportunity), business clearly active (worth calling), phone number
 * present (callable), and identity verification (data trustworthy).
 */
export function computeLeadScore(input: ScoreInput): number {
  let score = 0;

  // Website opportunity — max 35
  switch (input.websiteStatus) {
    case "none":
      score += 35;
      break;
    case "dead":
      score += 35;
      break;
    case "parked":
      score += 32;
      break;
    case "redirect-social":
      score += 28;
      break;
    case "live":
      score += input.outdated ? 20 : 5;
      break;
  }

  // Business clearly active — max 35
  const s = input.signals ?? {};
  if (s.businessStatus === "OPERATIONAL") score += 8;
  const rc = s.reviewCount ?? 0;
  if (rc >= 100) score += 12;
  else if (rc >= 25) score += 9;
  else if (rc >= 5) score += 6;
  else if (rc >= 1) score += 3;
  if ((s.rating ?? 0) >= 4) score += 5;
  if (s.lastReviewAt) {
    const days = (Date.now() - new Date(s.lastReviewAt).getTime()) / 86_400_000;
    if (days <= 30) score += 10;
    else if (days <= 90) score += 7;
    else if (days <= 365) score += 3;
  }

  // Off-Google finds have no Places signals, so the business-active section
  // scores 0 for them — don't let absence from Google (the very thing that
  // makes them good prospects) crater the score. Grant a modest floor when
  // the lead still shows life signals: a callable phone, or a live page we
  // found them on. Capped so a dead phone / CLOSED status still dominates.
  const hasPhone = (input.phone ?? "").replace(/\D/g, "").length >= 7;
  if (input.offGoogle && s.businessStatus === undefined) {
    if (hasPhone) score += 12;
    if (input.tier === "verified" || input.tier === "partial") score += 6;
  }

  // Callable — max 15
  if (hasPhone) score += 15;

  // Corroboration: independently found by 2+ discovery sources. Worth a real
  // bump, but sized so it can't outweigh a dead phone (-15 callable) or a
  // closure (tier drops to unverified, -15 vs verified).
  if ((input.foundVia?.length ?? 0) >= 2) score += 8;

  // Identity verification — max 15
  if (input.tier === "verified") score += 15;
  else if (input.tier === "partial") score += 7;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface VerifyInput {
  website?: string | null;
  phone?: string;
  tier?: VerificationTier | null;
  signals?: PlacesSignals | null;
  offGoogle?: boolean;
  foundVia?: string[] | null;
}

/** Full check pass for one lead. Never throws. */
export async function runVerificationChecks(
  input: VerifyInput,
): Promise<{ verification: LeadVerification; leadScore: number }> {
  const { website, body } = await checkWebsite(input.website);
  const freshness =
    website.status === "live" && body !== undefined
      ? checkFreshness(body, website.finalUrl ?? "")
      : undefined;

  const verification: LeadVerification = {
    website,
    ...(freshness ? { freshness } : {}),
    business: {
      businessStatus: input.signals?.businessStatus,
      rating: input.signals?.rating,
      reviewCount: input.signals?.reviewCount,
      lastReviewAt: input.signals?.lastReviewAt,
      utcOffsetMinutes: input.signals?.utcOffsetMinutes,
    },
    checkedAt: new Date().toISOString(),
  };

  const leadScore = computeLeadScore({
    websiteStatus: website.status,
    outdated: freshness?.outdated,
    phone: input.phone,
    tier: input.tier,
    signals: input.signals,
    offGoogle: input.offGoogle,
    foundVia: input.foundVia,
  });

  return { verification, leadScore };
}
