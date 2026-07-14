// Server-only helper: Google Places textSearch discovery.
// Extracted so both /api/generate-leads and the in-app assistant can share it.

import type { PlacesSignals } from "./verification.server";

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";

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
  "nextPageToken",
].join(",");

type Place = {
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
};
type PlacesResponse = { places?: Place[]; nextPageToken?: string; error?: { message?: string } };

const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook Only",
  "instagram.com": "Social-Heavy",
  "linktr.ee": "Social-Heavy",
  "linktree.com": "Social-Heavy",
};
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

function hostFromUrl(u: string): string | null {
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

export type DiscoveredCandidate = {
  business: string;
  city: string;
  state: string;
  phone: string;
  owner: null;
  sourceUrl: string | null;
  website: string | null;
  sources: string[];
  onlinePresence: string;
  websiteOpportunity: string;
  matchesFilter: boolean;
  placesSignals: PlacesSignals;
};

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
  };
}

/** CLOSED businesses are discarded entirely — never worth a call. */
export function isClosed(p: Place): boolean {
  return typeof p.businessStatus === "string" && p.businessStatus.startsWith("CLOSED");
}

function classify(websiteUri: string | undefined) {
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

function matchesRequest(opp: string, want: string): boolean {
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

function parseCityState(
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
  });
  const data = (await res.json()) as PlacesResponse;
  if (!res.ok) throw new Error(data.error?.message || `Places ${res.status}`);
  return data;
}

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
  const places: Place[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page++) {
    const data = await placesSearch(query, apiKey, pageToken);
    if (data.places?.length) places.push(...data.places);
    pageToken = data.nextPageToken;
    if (!pageToken || places.length >= target) break;
  }
  return places
    .filter((p) => !isClosed(p))
    .map((p) => {
      const business = p.displayName?.text?.trim() || "";
      const { city: c, state } = parseCityState(p.formattedAddress, city);
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
      };
    })
    .filter((l) => l.business);
}
