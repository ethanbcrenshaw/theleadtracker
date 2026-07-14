// Server-only enrichment pipeline: Firecrawl web search + optional deep
// profile scrape + AI pitch-angle generation (provider-agnostic — see
// ai.server.ts). Used by the generate-leads batch route and the single-lead
// re-research route.

import type {
  LeadEnrichment,
  LeadProfile,
  LeadProfileType,
  LeadReviews,
  VerificationTier,
} from "./types";
import { aiText, type AIConfig } from "./ai.server";

const SEARCH_TIMEOUT_MS = 9000;
const SCRAPE_TIMEOUT_MS = 8000;
const AI_TIMEOUT_MS = 12000;
const SITE_FETCH_TIMEOUT_MS = 7000;
const CURRENT_YEAR = new Date().getFullYear();

const DIRECTORY_HOSTS = [
  "yelp.com",
  "yellowpages.com",
  "mapquest.com",
  "angi.com",
  "houzz.com",
  "bbb.org",
  "manta.com",
  "foursquare.com",
  "tripadvisor.com",
  "porch.com",
  "homeadvisor.com",
  "thumbtack.com",
  "nextdoor.com",
  "alignable.com",
];

export function hostOf(u: string): string | null {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOneOf(host: string, list: string[]): boolean {
  return list.some((d) => host === d || host.endsWith("." + d));
}

export function classifyProfile(url: string): LeadProfileType | null {
  const h = hostOf(url);
  if (!h) return null;
  if (h === "facebook.com" || h.endsWith(".facebook.com")) return "facebook";
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return "instagram";
  if (h === "yelp.com" || h.endsWith(".yelp.com")) return "yelp";
  if (h === "linkedin.com" || h.endsWith(".linkedin.com")) return "linkedin";
  if (
    h.includes("google.") &&
    (url.includes("/maps") || url.includes("g.co/kgs") || url.includes("business.google"))
  )
    return "google-business";
  if (isOneOf(h, DIRECTORY_HOSTS)) return "directory";
  return null;
}

type FirecrawlSearchItem = { url?: string; title?: string; description?: string };
type FirecrawlSearchResp = {
  success?: boolean;
  data?: { web?: FirecrawlSearchItem[] } | FirecrawlSearchItem[];
};

async function firecrawlSearch(
  query: string,
  apiKey: string,
  limit = 10,
): Promise<FirecrawlSearchItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, limit }),
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as FirecrawlSearchResp;
    if (!json?.success) return [];
    const data = json.data;
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.web) ? data!.web! : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

type FirecrawlDoc = {
  html?: string;
  markdown?: string;
  metadata?: { title?: string; description?: string };
};

async function firecrawlScrape(url: string, apiKey: string): Promise<FirecrawlDoc | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: SCRAPE_TIMEOUT_MS,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: FirecrawlDoc };
    if (!json?.success) return null;
    return json.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Parse "4.6 stars", "4.6/5", "Rating 4.6" and "214 reviews", "(214)"
function parseReviewSnippet(text: string): { rating?: number; count?: number } {
  const rating = text.match(/(?:^|[^0-9])([1-5](?:\.[0-9])?)\s*(?:stars?|★|\/\s*5|\()/i);
  const count =
    text.match(/([0-9][0-9,]{0,6})\s*(?:reviews?|ratings?)/i) ||
    text.match(/\(([0-9][0-9,]{1,6})\)/);
  return {
    rating: rating ? parseFloat(rating[1]) : undefined,
    count: count ? parseInt(count[1].replace(/,/g, ""), 10) : undefined,
  };
}

function parseRecentActivity(text: string): string | undefined {
  const m = text.match(/(\d+)\s*(day|week|month|hour)s?\s*ago/i);
  return m ? m[0] : undefined;
}

function parseHours(md: string): string | undefined {
  const dayRE =
    /(mon|tue|wed|thu|fri|sat|sun)[^\n]{0,60}?(\d{1,2}(?::\d{2})?\s*(?:am|pm))[^\n]{0,20}?(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi;
  const lines: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = dayRE.exec(md)) && lines.length < 7) {
    lines.push(`${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}–${m[3]}`);
  }
  if (lines.length) return lines.join(" · ");
  const generic = md.match(
    /(open|hours)[^\n]{0,80}?(\d{1,2}(?::\d{2})?\s*(?:am|pm)[^\n]{0,20}?\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  );
  return generic ? generic[0].slice(0, 80) : undefined;
}

function parseOwnerName(md: string): string | undefined {
  const m = md.match(
    /(?:owner|founder|proprietor|operated by|owned by)[:\s]+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})/,
  );
  return m ? m[1] : undefined;
}

function parseRating(md: string): { rating?: number; count?: number } {
  return parseReviewSnippet(md);
}

function parseFbLastActivity(md: string): string | undefined {
  // Firecrawl-normalized Facebook markdown often contains "· 3d" / "· 2h"
  const m =
    md.match(/·\s*(\d+)\s*(d|h|w|m|y|mo)\b/i) || md.match(/(\d+)\s*(day|week|month|hour)s?\s*ago/i);
  if (!m) return undefined;
  return m[0].replace(/·\s*/, "").trim();
}

// ── Verification helpers ────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function normalizePhone(s: string): string {
  return s.replace(/\D/g, "");
}
function nameSimilar(md: string, business: string): boolean {
  const n = normalizeName(business);
  if (n.length < 3) return false;
  const m = normalizeName(md);
  if (m.includes(n)) return true;
  const parts = business.split(/\s+/).filter((p) => p.length > 2);
  if (parts.length >= 2) {
    const first = normalizeName(parts.slice(0, 2).join(""));
    if (first.length >= 4 && m.includes(first)) return true;
  }
  return false;
}
function phoneMatches(md: string, phone: string): boolean {
  const p = normalizePhone(phone);
  if (p.length < 7) return false;
  const last10 = p.slice(-10);
  return normalizePhone(md).includes(last10);
}
function cityMentioned(md: string, city: string): boolean {
  if (!city) return false;
  return md.toLowerCase().includes(city.toLowerCase());
}
function detectClosure(md: string): string | null {
  if (/permanently closed/i.test(md)) return "marked permanently closed";
  if (/temporarily closed|closed until further notice/i.test(md)) return "marked closed";
  if (
    /this page isn'?t available|content isn'?t available|page (has been )?removed|page not found|content not available/i.test(
      md,
    )
  )
    return "profile page removed";
  if (/out of business|no longer in business|shut down/i.test(md))
    return "reported out of business";
  return null;
}

/** Cheap plain-fetch verification of a website host. Returns whether it loaded real content. */
async function verifyWebsiteAlive(
  host: string,
): Promise<{ alive: boolean; finalHost?: string; body?: string; reason?: string }> {
  const url = `https://${host}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SITE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 lead-bloom-verifier" },
    });
    if (!res.ok) return { alive: false, reason: `status ${res.status}` };
    const body = await res.text();
    if (body.length < 400) return { alive: false, body, reason: "empty page" };
    if (
      /domain (is )?for sale|buy this domain|parked (free )?by|godaddy\.com\/domains|sedoparking|hugedomains|this domain may be for sale/i.test(
        body,
      )
    ) {
      return { alive: false, body, reason: "parked domain" };
    }
    const finalHost = hostOf(res.url) ?? host;
    // Redirected off to a social/directory — treat as no dedicated website.
    if (finalHost !== host) {
      if (finalHost.endsWith("facebook.com") || finalHost.endsWith("instagram.com")) {
        return { alive: false, body, finalHost, reason: "redirects to social page" };
      }
      if (isOneOf(finalHost, DIRECTORY_HOSTS)) {
        return { alive: false, body, finalHost, reason: "redirects to directory" };
      }
    }
    return { alive: true, finalHost, body };
  } catch {
    return { alive: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function isBodyOutdated(body: string): boolean {
  if (body && !/<meta[^>]+name=["']viewport["']/i.test(body)) return true;
  const years = Array.from(body.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}(20\d{2})/gi)).map(
    (m) => parseInt(m[1], 10),
  );
  if (years.length) {
    const latest = Math.max(...years);
    if (CURRENT_YEAR - latest > 5) return true;
  }
  return false;
}

type ProfileVerdict = {
  match: "phone" | "name+city" | "name" | "none";
  closure: string | null;
};
function evaluateProfile(
  md: string,
  business: string,
  city: string,
  phone: string,
): ProfileVerdict {
  const closure = detectClosure(md);
  const phoneOk = phoneMatches(md, phone);
  const nameOk = nameSimilar(md, business);
  const cityOk = cityMentioned(md, city);
  let match: ProfileVerdict["match"] = "none";
  if (phoneOk) match = "phone";
  else if (nameOk && cityOk) match = "name+city";
  else if (nameOk) match = "name";
  return { match, closure };
}

export interface EnrichInput {
  business: string;
  city: string;
  state: string;
  phone: string;
  website?: string | null; // host only
  websiteOpportunity?: string; // used for websiteStatus classification
}

export interface EnrichResult {
  enrichment: LeadEnrichment;
  confidenceScore: number;
  confidenceEvidence: string[];
  unverified: boolean;
  unverifiedReason?: string;
  verificationTier: VerificationTier;
  verificationReasons: string[];
}

async function generatePitchAngle(
  input: EnrichInput,
  enrichment: LeadEnrichment,
  unverified: boolean,
  unverifiedReason: string | undefined,
  ai: AIConfig,
): Promise<string | undefined> {
  if (unverified) {
    return `⚠ Poor prospect — ${unverifiedReason ?? "unverified"}. Skip or verify basics before spending call time.`;
  }
  try {
    const facts = {
      business: input.business,
      city: input.city,
      state: input.state,
      websiteStatus: enrichment.websiteStatus,
      website: input.website ?? null,
      profiles: enrichment.profiles.map((p) => p.type),
      reviews: enrichment.reviews,
      hours: enrichment.hours ?? null,
      ownerName: enrichment.ownerName ?? null,
      recentActivity: enrichment.recentActivity ?? null,
      verifiedSummary: enrichment.verifiedSummary ?? null,
    };
    const text = await aiText(ai, {
      system:
        "You brief a solo web designer before a cold call. Write a tight 2–4 sentence pitch angle explaining why THIS specific business is a good website prospect. Ground every claim in the JSON facts provided — never invent details. Cite specific evidence (review counts, active socials, no website, outdated site, etc). Be direct, no filler, no marketing fluff.",
      user: `Facts:\n${JSON.stringify(facts, null, 2)}`,
      maxTokens: 1024,
      timeoutMs: AI_TIMEOUT_MS,
    });
    return text || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Full enrichment: search → optional deep scrape of primary profile → confidence
 * scoring → AI pitch angle. Fails soft: any single step returning nothing still
 * yields a valid, persistable EnrichResult.
 */
export async function enrichLeadFull(
  input: EnrichInput,
  opts: { firecrawlKey: string; ai?: AIConfig | null },
): Promise<EnrichResult> {
  const { firecrawlKey, ai } = opts;
  const q = `"${input.business}" ${input.city} ${input.state}`;
  const results = await firecrawlSearch(q, firecrawlKey, 10);

  // Candidate profiles from search — kept aside pending identity match.
  const candidateProfiles: LeadProfile[] = [];
  const reviews: LeadReviews[] = [];
  const seen = new Set<string>();
  let recentActivity: string | undefined;

  for (const r of results) {
    if (!r.url) continue;
    const t = classifyProfile(r.url);
    if (!t) continue;
    const key = `${t}:${r.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidateProfiles.push({ type: t, url: r.url, label: r.title });

    const snip = `${r.title || ""} ${r.description || ""}`;
    const rv = parseReviewSnippet(snip);
    if (rv.rating || rv.count) {
      const src =
        t === "google-business"
          ? "Google"
          : t === "yelp"
            ? "Yelp"
            : t === "facebook"
              ? "Facebook"
              : t;
      if (!reviews.some((x) => x.source === src))
        reviews.push({ source: src, rating: rv.rating, count: rv.count });
    }
    if (!recentActivity) {
      const ra = parseRecentActivity(snip);
      if (ra) recentActivity = `${t}: ${ra}`;
    }
  }

  // ── Deep-scrape profiles for identity match + closure signals. We check FB
  // and GMB (the two most authoritative), discard anything that doesn't
  // match this business, and hard-flag if the actual page says closed.
  const verifiedProfiles: LeadProfile[] = [];
  const verificationReasons: string[] = [];
  let closureReason: string | null = null;
  let anyIdentityMatch = false;
  let phoneVerifiedOnProfile = false;
  let profileMatchFailed = false;

  let hours: string | undefined;
  let ownerName: string | undefined;
  let verifiedSummary: string | undefined = results[0]?.description
    ? results[0].description.slice(0, 220)
    : undefined;

  const toDeepScrape = [
    candidateProfiles.find((p) => p.type === "google-business"),
    candidateProfiles.find((p) => p.type === "facebook"),
  ].filter((p): p is LeadProfile => !!p);

  for (const cand of toDeepScrape) {
    try {
      const doc = await firecrawlScrape(cand.url, firecrawlKey);
      const md = (doc?.markdown || "").slice(0, 12000);
      if (!md) {
        profileMatchFailed = true;
        continue;
      }

      const verdict = evaluateProfile(md, input.business, input.city, input.phone);
      if (verdict.match === "none") {
        profileMatchFailed = true;
        continue; // wrong business — discard from presence map
      }
      anyIdentityMatch = true;
      if (verdict.match === "phone") phoneVerifiedOnProfile = true;

      if (verdict.closure) {
        closureReason = `${cand.type === "facebook" ? "Facebook" : "Google"}: ${verdict.closure}`;
      }

      verifiedProfiles.push(cand);

      // Only pull signals from a matched profile.
      if (!hours) hours = parseHours(md);
      if (!ownerName) ownerName = parseOwnerName(md);
      const rv = parseRating(md);
      if (rv.rating || rv.count) {
        const src = cand.type === "google-business" ? "Google" : "Facebook";
        const existing = reviews.find((x) => x.source === src);
        if (existing) {
          if (rv.rating && !existing.rating) existing.rating = rv.rating;
          if (rv.count && !existing.count) existing.count = rv.count;
        } else {
          reviews.push({ source: src, ...rv });
        }
      }
      if (cand.type === "facebook") {
        const ra = parseFbLastActivity(md);
        if (ra) recentActivity = `facebook: ${ra}`;
      }
      if (!verifiedSummary && doc?.metadata?.description) {
        verifiedSummary = doc.metadata.description.slice(0, 220);
      }
    } catch {
      profileMatchFailed = true;
    }
  }

  // Non-scraped (IG/Yelp/directory) profiles are surfaced as leads to the user
  // but flagged as unverified in the presence map — labeled clearly.
  for (const p of candidateProfiles) {
    if (verifiedProfiles.includes(p)) continue;
    if (p.type === "google-business" || p.type === "facebook") continue; // discarded above
    verifiedProfiles.push({ ...p, note: p.note || "unverified match" });
  }

  // ── Verify the website claim by actually fetching it ────────────────────
  let websiteStatus: LeadEnrichment["websiteStatus"] = "unknown";
  let lastVerifiedAt: string | undefined;

  if (input.website) {
    const check = await verifyWebsiteAlive(input.website);
    lastVerifiedAt = new Date().toISOString();
    if (!check.alive) {
      websiteStatus = "none";
      verificationReasons.push(`claimed site unreachable (${check.reason || "no response"})`);
      // Drop the website from the presence map since it doesn't actually exist.
    } else {
      // Loaded — now classify good vs outdated based on real content.
      const outdated = isBodyOutdated(check.body || "");
      websiteStatus = outdated ? "outdated" : "good";
      const host = check.finalHost || input.website;
      verifiedProfiles.unshift({
        type: "website",
        url: `https://${host}`,
        label: host,
        note: outdated ? "verified — looks outdated" : "verified live site",
      });
      if (outdated) verificationReasons.push("site loads but looks outdated");
      else verificationReasons.push("website verified live");
    }
  } else {
    websiteStatus = "none";
  }

  // Re-derive presence counts against the verified set (post-discard).
  const profiles = verifiedProfiles;

  // ── Confidence scoring ──
  let score = 30; // baseline: found in Places
  const evidence: string[] = [];

  if (input.phone) {
    score += 15;
    evidence.push("phone listed");
  } else evidence.push("no phone");

  const hasFB = profiles.some((p) => p.type === "facebook");
  const hasIG = profiles.some((p) => p.type === "instagram");
  const hasYelp = profiles.some((p) => p.type === "yelp");
  const hasGMB = profiles.some((p) => p.type === "google-business");
  const profileCount = [hasFB, hasIG, hasYelp, hasGMB].filter(Boolean).length;
  score += Math.min(profileCount * 8, 24);

  if (hasFB) evidence.push("FB found");
  if (hasIG) evidence.push("IG found");
  if (hasYelp) evidence.push("Yelp found");
  if (hasGMB) evidence.push("GMB listed");

  if (reviews.length) {
    const top = reviews[0];
    const chip = [top.rating ? `${top.rating}★` : null, top.count ? `${top.count} reviews` : null]
      .filter(Boolean)
      .join(" · ");
    if (chip) evidence.push(chip);
    score += 10;
  }
  if (recentActivity) {
    score += 8;
    evidence.push(recentActivity);
  }
  if (hours) evidence.push("hours known");
  if (ownerName) evidence.push(`owner: ${ownerName}`);

  if (websiteStatus === "none" && input.website) {
    score -= 15;
    evidence.push("claimed site unreachable");
  } else if (websiteStatus === "none") {
    score -= 5;
    evidence.push("no website");
  } else if (websiteStatus === "outdated") {
    score += 5;
    evidence.push("outdated site (verified)");
  } else if (websiteStatus === "good") {
    evidence.push("website verified");
  }

  if (phoneVerifiedOnProfile) {
    score += 10;
    evidence.push("phone matches FB/GMB");
  }
  if (profileMatchFailed && !anyIdentityMatch) {
    score -= 15;
    evidence.push("profile match uncertain");
  }

  // ── Unverified flags ──
  let unverified = false;
  let unverifiedReason: string | undefined;
  if (closureReason) {
    unverified = true;
    unverifiedReason = closureReason;
    evidence.push("closed on page");
    score = Math.min(score, 10);
  } else if (!input.phone && profileCount === 0 && websiteStatus !== "good") {
    unverified = true;
    unverifiedReason = "could not verify business exists";
    score -= 30;
  } else if (
    websiteStatus === "good" &&
    profileCount >= 2 &&
    reviews.length &&
    (reviews[0].count ?? 0) > 50
  ) {
    unverified = true;
    unverifiedReason = "already has strong modern presence — poor prospect";
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const enrichment: LeadEnrichment = {
    verifiedSummary,
    websiteStatus,
    profiles,
    reviews,
    hours,
    ownerName,
    recentActivity,
    enrichedAt: new Date().toISOString(),
    lastVerifiedAt,
  };

  if (ai) {
    const pitch = await generatePitchAngle(input, enrichment, unverified, unverifiedReason, ai);
    if (pitch) enrichment.pitchAngle = pitch;
  }

  // ── Verification tier ────────────────────────────────────────────────────
  // VERIFIED: no closure markers AND (an identity-matched profile OR a
  //           website URL we fetched and evaluated). Sibling profiles that
  //           failed identity matching are already dropped from the presence
  //           map — they no longer count against the tier.
  // UNVERIFIED: closure markers on a real page, or truly nothing matched.
  // PARTIAL: leads with only unverified sibling profiles (IG, directories)
  //          and no matched anchor.
  let tier: VerificationTier;
  const websiteResolvedAlive = websiteStatus === "good" || websiteStatus === "outdated";
  const websiteClaimBroken = !!input.website && websiteStatus === "none";
  if (closureReason) {
    tier = "unverified";
  } else if (anyIdentityMatch || websiteResolvedAlive) {
    tier = "verified";
  } else if (!anyIdentityMatch && websiteClaimBroken && profileCount === 0) {
    tier = "unverified";
    if (!unverifiedReason) unverifiedReason = "no verifiable presence";
    unverified = true;
  } else if (!anyIdentityMatch && !input.website && profileCount === 0) {
    tier = "unverified";
    if (!unverifiedReason) unverifiedReason = "no verifiable presence";
    unverified = true;
  } else {
    tier = "partial";
  }

  if (tier === "verified") verificationReasons.unshift("identity confirmed");
  if (phoneVerifiedOnProfile) verificationReasons.push("phone matched on profile page");
  if (profileMatchFailed && !anyIdentityMatch)
    verificationReasons.push("scraped profile didn't match business");

  return {
    enrichment,
    confidenceScore: score,
    confidenceEvidence: evidence,
    unverified,
    unverifiedReason,
    verificationTier: tier,
    verificationReasons,
  };
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        await fn(items[idx]);
      } catch {
        /* swallow */
      }
    }
  });
  await Promise.all(workers);
}
