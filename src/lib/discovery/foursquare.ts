// Foursquare Places discovery source (optional — needs FOURSQUARE_API_KEY).
//
// Independent POI base from Google's, so businesses found here but not on
// Google go through the orchestrator's offGoogle cross-check like any other
// non-Places find. Uses the 2026 Places API (places-api.foursquare.com,
// SERVICE key via `Authorization: Bearer`, X-Places-Api-Version header —
// legacy v3 endpoints were deprecated May 2026). Requests only base fields
// (name/location/tel/website/categories); Premium fields (photos, tips,
// hours) bill differently and are deliberately not requested.

import { isKnoxMetro, metroTowns } from "./market";
import { classify, matchesRequest } from "./places";
import type { DiscoveredCandidate, DiscoveryQuery, DiscoverySource, SourceBudget } from "./types";

const FSQ_SEARCH = "https://places-api.foursquare.com/places/search";
const FSQ_API_VERSION = "2025-06-17";
const FSQ_TIMEOUT_MS = 8000;
const FSQ_LIMIT = 50;
/** Max metro towns to fan across beyond the requested city (free tier is tight). */
const FSQ_MAX_EXTRA_TOWNS = 4;

type FsqPlace = {
  name?: string;
  tel?: string;
  website?: string;
  location?: { locality?: string; region?: string; formatted_address?: string };
  categories?: Array<{ name?: string }>;
};

async function fsqSearch(query: string, near: string, apiKey: string): Promise<FsqPlace[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FSQ_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      query,
      near,
      limit: String(FSQ_LIMIT),
      fields: "name,location,tel,website,categories",
    });
    const res = await fetch(`${FSQ_SEARCH}?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Places-Api-Version": FSQ_API_VERSION,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`[discovery] foursquare ${res.status} for "${query}" near "${near}"`);
      return [];
    }
    const json = (await res.json()) as { results?: FsqPlace[] };
    return json.results ?? [];
  } catch (err) {
    console.error("[discovery] foursquare search failed:", err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toCandidate(p: FsqPlace, q: DiscoveryQuery, near: string): DiscoveredCandidate | null {
  const business = (p.name || "").trim();
  if (!business) return null;
  const { opp, website } = classify(p.website || undefined);
  const town = near.split(",")[0].trim();
  const st = (near.split(",")[1] || "").trim().slice(0, 2).toUpperCase() || "TN";
  const category = p.categories?.[0]?.name;
  return {
    business,
    city: (p.location?.locality || town).trim(),
    state: (p.location?.region || st).trim().slice(0, 2).toUpperCase(),
    phone: (p.tel || "").trim(),
    owner: null,
    sourceUrl: website ? `https://${website}` : null,
    website,
    sources: ["Directory"],
    onlinePresence: website
      ? `Foursquare listing${category ? ` (${category})` : ""} — has a website (${website})`
      : `Foursquare listing${category ? ` (${category})` : ""} — no website on file`,
    websiteOpportunity: opp,
    matchesFilter: matchesRequest(opp, q.type),
    placesSignals: {},
    foundVia: ["foursquare"],
  };
}

export const foursquareSource: DiscoverySource = {
  id: "foursquare",
  isConfigured: () => Boolean(process.env.FOURSQUARE_API_KEY),
  async discover(q: DiscoveryQuery, budget: SourceBudget): Promise<DiscoveredCandidate[]> {
    const apiKey = process.env.FOURSQUARE_API_KEY;
    if (!apiKey) return [];
    const nears = [q.city];
    if (q.expandMetro && isKnoxMetro(q.city)) {
      nears.push(...metroTowns(q.city).slice(0, FSQ_MAX_EXTRA_TOWNS));
    }
    const out: DiscoveredCandidate[] = [];
    for (const near of nears) {
      if (!budget.take()) break;
      const places = await fsqSearch(q.industry, near, apiKey);
      for (const p of places) {
        const cand = toCandidate(p, q, near);
        if (cand) out.push(cand);
      }
    }
    return out;
  },
};
