// Google Places textSearch discovery source. The original single-query logic
// from discover.server.ts lives here (behavior preserved for the legacy
// discoverCandidates() entry point used by the assistant); the DiscoverySource
// wrapper adds budgeted multi-query fan-out for the orchestrator.

import { aiExtract, getAI } from "../ai.server";
import type { PlacesSignals } from "../verification.server";
import { isKnoxMetro, metroTowns } from "./market";
import { SourceBudget } from "./types";
import type { DiscoveredCandidate, DiscoveryQuery, DiscoverySource } from "./types";

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const PLACES_TIMEOUT_MS = 10_000;

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.reviews",
  "places.utcOffsetMinutes",
  "nextPageToken",
].join(",");

export type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  reviews?: Array<{ publishTime?: string }>;
  utcOffsetMinutes?: number;
};
type PlacesResponse = { places?: Place[]; nextPageToken?: string; error?: { message?: string } };

const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook Only",
  "instagram.com": "Social-Heavy",
  "linktr.ee": "Social-Heavy",
  "linktree.com": "Social-Heavy",
};
export const DIRECTORY_HOSTS = [
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

export function hostFromUrl(u: string): string | null {
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

export function signalsFromPlace(p: Place): PlacesSignals {
  const reviewTimes = (p.reviews ?? [])
    .map((r) => r.publishTime)
    .filter((t): t is string => Boolean(t))
    .sort();
  return {
    businessStatus: p.businessStatus,
    rating: p.rating,
    reviewCount: p.userRatingCount,
    lastReviewAt: reviewTimes.length ? reviewTimes[reviewTimes.length - 1] : undefined,
    utcOffsetMinutes: p.utcOffsetMinutes,
  };
}

/** CLOSED businesses are discarded entirely — never worth a call. */
export function isClosed(p: Place): boolean {
  return typeof p.businessStatus === "string" && p.businessStatus.startsWith("CLOSED");
}

/** Classify a website URL into the WebsiteOpportunity buckets. Shared by all sources. */
export function classify(websiteUri: string | undefined | null) {
  const sources = ["Google Business"];
  if (!websiteUri)
    return {
      opp: "No Dedicated Website",
      presence: "No website listed on Google",
      website: null,
      sources,
    };
  const host = hostFromUrl(websiteUri);
  if (!host)
    return {
      opp: "No Dedicated Website",
      presence: "No usable website found",
      website: null,
      sources,
    };
  for (const social of Object.keys(SOCIAL_HOSTS)) {
    if (host === social || host.endsWith("." + social)) {
      const label = social.split(".")[0];
      const src = label === "facebook" ? "Facebook" : label === "instagram" ? "Instagram" : "Other";
      return {
        opp: SOCIAL_HOSTS[social],
        presence: `Uses a ${label} page instead of a website`,
        website: null,
        sources: [...sources, src],
      };
    }
  }
  if (isOneOf(host, DIRECTORY_HOSTS)) {
    return {
      opp: "Yelp/Directory Only",
      presence: `Listed on ${host} — no dedicated website`,
      website: null,
      sources: [...sources, "Directory"],
    };
  }
  return {
    opp: "Has Website",
    presence: `Has a website (${host})`,
    website: host,
    sources: [...sources, "Website"],
  };
}

export function matchesRequest(opp: string, want: string): boolean {
  switch (want) {
    case "No Dedicated Website":
      return opp === "No Dedicated Website";
    case "Facebook Only":
      return opp === "Facebook Only";
    case "Yelp/Directory Only":
      return opp === "Yelp/Directory Only";
    case "Social-Heavy":
      return opp === "Social-Heavy" || opp === "Facebook Only";
    case "Outdated Website":
      return opp === "Has Website";
    case "Has Website":
      return opp === "Has Website";
    default:
      return true;
  }
}

export function parseCityState(
  addr: string | undefined,
  fallbackCity: string,
): { city: string; state: string } {
  const fb = fallbackCity.split(",");
  const fbCity = (fb[0] || "").trim();
  const fbState = (fb[1] || "").trim().slice(0, 2).toUpperCase();
  if (!addr) return { city: fbCity, state: fbState };
  const parts = addr.split(",").map((p) => p.trim());
  let city = fbCity;
  let state = fbState;
  if (parts.length >= 3) {
    city = parts[parts.length - 3] || fbCity;
    const m = (parts[parts.length - 2] || "").match(/\b([A-Z]{2})\b/);
    if (m) state = m[1];
  }
  return { city, state };
}

async function placesSearch(
  query: string,
  apiKey: string,
  pageToken?: string,
): Promise<PlacesResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PLACES_TIMEOUT_MS);
  try {
    const res = await fetch(PLACES_SEARCH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 20,
        ...(pageToken ? { pageToken } : {}),
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as PlacesResponse;
    if (!res.ok) throw new Error(data.error?.message || `Places ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function placeToCandidate(
  p: Place,
  fallbackCity: string,
  type: string,
): DiscoveredCandidate {
  const business = p.displayName?.text?.trim() || "";
  const { city: c, state } = parseCityState(p.formattedAddress, fallbackCity);
  const { opp, presence, website, sources } = classify(p.websiteUri);
  return {
    business,
    city: c,
    state,
    phone: (p.nationalPhoneNumber || "").trim(),
    owner: null,
    sourceUrl: website ? `https://${website}` : p.googleMapsUri || null,
    website,
    sources,
    onlinePresence: presence,
    websiteOpportunity: opp,
    matchesFilter: matchesRequest(opp, type),
    placesSignals: signalsFromPlace(p),
    foundVia: ["places"],
  };
}

/** One budgeted textSearch, paging up to `maxPages`. Returns raw places. */
async function searchQuery(
  query: string,
  apiKey: string,
  budget: SourceBudget,
  maxPages: number,
  target: number,
): Promise<Place[]> {
  const places: Place[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    if (!budget.take()) break;
    const data = await placesSearch(query, apiKey, pageToken);
    if (data.places?.length) places.push(...data.places);
    pageToken = data.nextPageToken;
    if (!pageToken || places.length >= target) break;
  }
  return places;
}

/**
 * Legacy single-query entry point — behavior identical to the original
 * discover.server.ts implementation. Still used by the assistant's
 * generate_leads tool.
 */
export async function discoverCandidates(opts: {
  industry: string;
  city: string;
  count: number;
  type: string;
  apiKey: string;
}): Promise<DiscoveredCandidate[]> {
  const { industry, city, count, type, apiKey } = opts;
  const query = `${industry} in ${city}`;
  const target = Math.max(count * 3, count);
  const budget = new SourceBudget(3);
  const places = await searchQuery(query, apiKey, budget, 3, target);
  return places
    .filter((p) => !isClosed(p))
    .map((p) => placeToCandidate(p, city, type))
    .filter((l) => l.business);
}

/**
 * Cross-check helper: one budgeted textSearch for a specific business.
 * Used by the orchestrator to decide offGoogle for non-Places finds.
 * Returns null when the budget is exhausted (unknown ≠ off-Google).
 */
export async function placesLookup(query: string, budget: SourceBudget): Promise<Place[] | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !budget.take()) return null;
  try {
    const data = await placesSearch(query, apiKey);
    return data.places ?? [];
  } catch (err) {
    console.error("[discovery] places cross-check failed:", err);
    return null;
  }
}

export const placesSource: DiscoverySource = {
  id: "places",
  isConfigured: () => Boolean(process.env.GOOGLE_PLACES_API_KEY),
  async discover(q: DiscoveryQuery, budget: SourceBudget): Promise<DiscoveredCandidate[]> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return [];
    const target = Math.max(q.count * 3, q.count);
    const out: DiscoveredCandidate[] = [];
    const queries = await buildQueries(q);
    for (const query of queries) {
      if (budget.satisfied || out.length >= target * 2) break;
      try {
        const places = await searchQuery(query, apiKey, budget, 2, target);
        out.push(
          ...places
            .filter((p) => !isClosed(p))
            .map((p) => placeToCandidate(p, q.city, q.type))
            .filter((l) => l.business),
        );
      } catch (err) {
        console.error(`[discovery] places query "${query}" failed:`, err);
      }
    }
    return out;
  },
};

// ── Query fan-out: AI industry variants × metro towns ───────────────────────

/** Max distinct query strings per industry (base + AI variants). */
export const MAX_QUERY_VARIANTS = 6;

// Variants cached in-process AND persisted via the settings store, so
// serverless cold starts don't re-pay the AI call for an industry we've
// already expanded. DB failures fall through silently to the AI path.
const variantCache = new Map<string, string[]>();

async function industryVariants(industry: string): Promise<string[]> {
  const key = industry.toLowerCase().trim();
  const hit = variantCache.get(key);
  if (hit) return hit;

  try {
    const { getSettingServer } = await import("../settings.server");
    const stored = await getSettingServer<string[]>(`discovery.variants.${key}`);
    if (Array.isArray(stored) && stored.length) {
      variantCache.set(key, stored);
      return stored;
    }
  } catch {
    /* settings store unavailable — fall through to AI */
  }

  let variants: string[] = [];
  const ai = getAI();
  if (ai) {
    try {
      const res = await aiExtract<{ variants: string[] }>(ai, {
        system:
          "You generate Google Maps search query variants for finding local businesses in an industry. Given an industry, return up to 5 short variants: common synonyms and specific service subtypes a small business might list itself under (e.g. plumber → drain cleaning, water heater repair, septic service). No city names, no explanations, just the service terms.",
        user: industry,
        toolName: "report_variants",
        toolDescription: "Report the search query variants",
        schema: {
          type: "object",
          properties: {
            variants: { type: "array", items: { type: "string" }, maxItems: 5 },
          },
          required: ["variants"],
        },
        timeoutMs: 12_000,
      });
      variants = (res?.variants ?? [])
        .map((v) => v.trim())
        .filter((v) => v && v.toLowerCase() !== key)
        .slice(0, MAX_QUERY_VARIANTS - 1);
    } catch (err) {
      console.error("[discovery] variant generation failed (using base query):", err);
    }
  }
  const all = [industry, ...variants].slice(0, MAX_QUERY_VARIANTS);
  variantCache.set(key, all);
  if (variants.length) {
    try {
      const { setSettingServer } = await import("../settings.server");
      await setSettingServer(`discovery.variants.${key}`, all);
    } catch {
      /* persistence is best-effort */
    }
  }
  return all;
}

/**
 * Build the fan-out query list, best-first: every industry variant in the
 * requested city, then (with expandMetro in the Knox metro) the base industry
 * across surrounding towns, then remaining variant×town combos. The source
 * budget caps how many actually run.
 */
async function buildQueries(q: DiscoveryQuery): Promise<string[]> {
  const variants = await industryVariants(q.industry);
  const queries = variants.map((v) => `${v} in ${q.city}`);
  if (q.expandMetro && isKnoxMetro(q.city)) {
    const towns = metroTowns(q.city);
    for (const t of towns) queries.push(`${variants[0]} in ${t}`);
    for (const t of towns) {
      for (const v of variants.slice(1)) queries.push(`${v} in ${t}`);
    }
  }
  return queries;
}
