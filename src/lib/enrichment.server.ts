// Server-only enrichment pipeline: Firecrawl web search + optional deep
// profile scrape + Lovable AI pitch-angle generation. Used by the
// generate-leads batch route and the single-lead re-research route.

import type { LeadEnrichment, LeadProfile, LeadProfileType, LeadReviews } from "./types";

const SEARCH_TIMEOUT_MS = 9000;
const SCRAPE_TIMEOUT_MS = 8000;
const AI_TIMEOUT_MS = 12000;

const DIRECTORY_HOSTS = [
  "yelp.com", "yellowpages.com", "mapquest.com", "angi.com", "houzz.com",
  "bbb.org", "manta.com", "foursquare.com", "tripadvisor.com", "porch.com",
  "homeadvisor.com", "thumbtack.com", "nextdoor.com", "alignable.com",
];

export function hostOf(u: string): string | null {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`)
      .hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
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
  if (h.includes("google.") && (url.includes("/maps") || url.includes("g.co/kgs") || url.includes("business.google"))) return "google-business";
  if (isOneOf(h, DIRECTORY_HOSTS)) return "directory";
  return null;
}

type FirecrawlSearchItem = { url?: string; title?: string; description?: string };
type FirecrawlSearchResp = { success?: boolean; data?: { web?: FirecrawlSearchItem[] } | FirecrawlSearchItem[] };

async function firecrawlSearch(query: string, apiKey: string, limit = 10): Promise<FirecrawlSearchItem[]> {
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

type FirecrawlDoc = { html?: string; markdown?: string; metadata?: { title?: string; description?: string } };

async function firecrawlScrape(url: string, apiKey: string): Promise<FirecrawlDoc | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: SCRAPE_TIMEOUT_MS }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: FirecrawlDoc };
    if (!json?.success) return null;
    return json.data ?? null;
  } catch { return null; } finally { clearTimeout(timer); }
}

// Parse "4.6 stars", "4.6/5", "Rating 4.6" and "214 reviews", "(214)"
function parseReviewSnippet(text: string): { rating?: number; count?: number } {
  const rating = text.match(/(?:^|[^0-9])([1-5](?:\.[0-9])?)\s*(?:stars?|★|\/\s*5|\()/i);
  const count = text.match(/([0-9][0-9,]{0,6})\s*(?:reviews?|ratings?)/i)
             || text.match(/\(([0-9][0-9,]{1,6})\)/);
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
  const dayRE = /(mon|tue|wed|thu|fri|sat|sun)[^\n]{0,60}?(\d{1,2}(?::\d{2})?\s*(?:am|pm))[^\n]{0,20}?(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi;
  const lines: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = dayRE.exec(md)) && lines.length < 7) {
    lines.push(`${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}–${m[3]}`);
  }
  if (lines.length) return lines.join(" · ");
  const generic = md.match(/(open|hours)[^\n]{0,80}?(\d{1,2}(?::\d{2})?\s*(?:am|pm)[^\n]{0,20}?\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  return generic ? generic[0].slice(0, 80) : undefined;
}

function parseOwnerName(md: string): string | undefined {
  const m = md.match(/(?:owner|founder|proprietor|operated by|owned by)[:\s]+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})/);
  return m ? m[1] : undefined;
}

function parseRating(md: string): { rating?: number; count?: number } {
  return parseReviewSnippet(md);
}

function parseFbLastActivity(md: string): string | undefined {
  // Firecrawl-normalized Facebook markdown often contains "· 3d" / "· 2h"
  const m = md.match(/·\s*(\d+)\s*(d|h|w|m|y|mo)\b/i)
         || md.match(/(\d+)\s*(day|week|month|hour)s?\s*ago/i);
  if (!m) return undefined;
  return m[0].replace(/·\s*/, "").trim();
}

export interface EnrichInput {
  business: string;
  city: string;
  state: string;
  phone: string;
  website?: string | null;         // host only
  websiteOpportunity?: string;     // used for websiteStatus classification
}

export interface EnrichResult {
  enrichment: LeadEnrichment;
  confidenceScore: number;
  confidenceEvidence: string[];
  unverified: boolean;
  unverifiedReason?: string;
}

async function generatePitchAngle(
  input: EnrichInput,
  enrichment: LeadEnrichment,
  unverified: boolean,
  unverifiedReason: string | undefined,
  aiKey: string,
): Promise<string | undefined> {
  if (unverified) {
    return `⚠ Poor prospect — ${unverifiedReason ?? "unverified"}. Skip or verify basics before spending call time.`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
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
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You brief a solo web designer before a cold call. Write a tight 2–4 sentence pitch angle explaining why THIS specific business is a good website prospect. Ground every claim in the JSON facts provided — never invent details. Cite specific evidence (review counts, active socials, no website, outdated site, etc). Be direct, no filler, no marketing fluff.",
          },
          { role: "user", content: `Facts:\n${JSON.stringify(facts, null, 2)}` },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || undefined;
  } catch { return undefined; } finally { clearTimeout(timer); }
}

/**
 * Full enrichment: search → optional deep scrape of primary profile → confidence
 * scoring → AI pitch angle. Fails soft: any single step returning nothing still
 * yields a valid, persistable EnrichResult.
 */
export async function enrichLeadFull(
  input: EnrichInput,
  opts: { firecrawlKey: string; aiKey?: string },
): Promise<EnrichResult> {
  const { firecrawlKey, aiKey } = opts;
  const q = `"${input.business}" ${input.city} ${input.state}`;
  const results = await firecrawlSearch(q, firecrawlKey, 10);

  const profiles: LeadProfile[] = [];
  const reviews: LeadReviews[] = [];
  const seen = new Set<string>();
  let recentActivity: string | undefined;

  if (input.website) {
    profiles.push({ type: "website", url: `https://${input.website}`, label: input.website });
    seen.add(`website:${input.website}`);
  }

  for (const r of results) {
    if (!r.url) continue;
    const t = classifyProfile(r.url);
    if (!t) continue;
    const key = `${t}:${r.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({ type: t, url: r.url, label: r.title });

    const snip = `${r.title || ""} ${r.description || ""}`;
    const rv = parseReviewSnippet(snip);
    if (rv.rating || rv.count) {
      const src = t === "google-business" ? "Google" : t === "yelp" ? "Yelp" : t === "facebook" ? "Facebook" : t;
      if (!reviews.some((x) => x.source === src)) reviews.push({ source: src, rating: rv.rating, count: rv.count });
    }
    if (!recentActivity) {
      const ra = parseRecentActivity(snip);
      if (ra) recentActivity = `${t}: ${ra}`;
    }
  }

  // ── Deep scrape a primary profile once, GMB then FB. Bounded, best-effort.
  let hours: string | undefined;
  let ownerName: string | undefined;
  let verifiedSummary: string | undefined = results[0]?.description ? results[0].description.slice(0, 220) : undefined;

  const primary =
    profiles.find((p) => p.type === "google-business") ??
    profiles.find((p) => p.type === "facebook");

  if (primary) {
    try {
      const doc = await firecrawlScrape(primary.url, firecrawlKey);
      const md = (doc?.markdown || "").slice(0, 12000);
      if (md) {
        hours = parseHours(md);
        ownerName = parseOwnerName(md);
        const rv = parseRating(md);
        if (rv.rating || rv.count) {
          const src = primary.type === "google-business" ? "Google" : "Facebook";
          const existing = reviews.find((x) => x.source === src);
          if (existing) {
            if (rv.rating && !existing.rating) existing.rating = rv.rating;
            if (rv.count && !existing.count) existing.count = rv.count;
          } else {
            reviews.push({ source: src, ...rv });
          }
        }
        if (primary.type === "facebook") {
          const ra = parseFbLastActivity(md);
          if (ra) recentActivity = `facebook: ${ra}`;
        }
        if (!verifiedSummary && doc?.metadata?.description) {
          verifiedSummary = doc.metadata.description.slice(0, 220);
        }
      }
    } catch { /* best-effort */ }
  }

  const opp = input.websiteOpportunity;
  const websiteStatus: LeadEnrichment["websiteStatus"] =
    opp === "Has Website" ? "good" :
    opp === "Outdated Website" ? "outdated" :
    input.website ? "good" : "none";

  // ── Confidence scoring ──
  let score = 30; // baseline: found in Places
  const evidence: string[] = [];

  if (input.phone) { score += 15; evidence.push("phone listed"); } else evidence.push("no phone");

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
    const chip = [top.rating ? `${top.rating}★` : null, top.count ? `${top.count} reviews` : null].filter(Boolean).join(" · ");
    if (chip) evidence.push(chip);
    score += 10;
  }
  if (recentActivity) { score += 8; evidence.push(recentActivity); }
  if (hours) evidence.push("hours known");
  if (ownerName) evidence.push(`owner: ${ownerName}`);

  if (websiteStatus === "none") { score -= 5; evidence.push("no website found"); }
  if (websiteStatus === "outdated") { score += 5; evidence.push("outdated site"); }
  if (websiteStatus === "good") evidence.push("has website");

  // ── Unverified flags ──
  let unverified = false;
  let unverifiedReason: string | undefined;
  const snippetsAll = results.map((r) => `${r.title || ""} ${r.description || ""}`).join(" ").toLowerCase();
  if (/permanently closed|closed permanently|out of business|no longer in business/.test(snippetsAll)) {
    unverified = true; unverifiedReason = "likely closed"; evidence.push("closed?"); score -= 40;
  } else if (!input.phone && profileCount === 0 && !input.website) {
    unverified = true; unverifiedReason = "could not verify business exists"; score -= 30;
  } else if (websiteStatus === "good" && profileCount >= 2 && reviews.length && (reviews[0].count ?? 0) > 50) {
    unverified = true; unverifiedReason = "already has strong modern presence — poor prospect";
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
  };

  if (aiKey) {
    const pitch = await generatePitchAngle(input, enrichment, unverified, unverifiedReason, aiKey);
    if (pitch) enrichment.pitchAngle = pitch;
  }

  return { enrichment, confidenceScore: score, confidenceEvidence: evidence, unverified, unverifiedReason };
}

export async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx]); } catch { /* swallow */ }
    }
  });
  await Promise.all(workers);
}