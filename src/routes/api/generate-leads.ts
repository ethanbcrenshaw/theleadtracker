import { createFileRoute } from "@tanstack/react-router";
// Side-effect import to activate `server` route option augmentation
import "@tanstack/react-start";
// NOTE: Enrichment is intentionally NOT done here. The client (AIGenerateModal)
// enriches each candidate one-by-one via /api/enrich-candidate so it can show
// per-lead progress. This route only discovers candidates.

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
};

type PlacesResponse = { places?: Place[]; nextPageToken?: string; error?: { message?: string } };

const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook Only",
  "instagram.com": "Social-Heavy",
  "linktr.ee": "Social-Heavy",
  "linktree.com": "Social-Heavy",
};

const DIRECTORY_HOSTS = [
  "yelp.com", "yellowpages.com", "mapquest.com", "angi.com", "houzz.com",
  "bbb.org", "manta.com", "foursquare.com", "tripadvisor.com", "porch.com",
  "homeadvisor.com", "thumbtack.com", "nextdoor.com", "alignable.com",
];

function hostFromUrl(u: string): string | null {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`)
      .hostname.toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOneOf(host: string, list: string[]): boolean {
  return list.some((d) => host === d || host.endsWith("." + d));
}

function classify(websiteUri: string | undefined): {
  opp: string;
  presence: string;
  website: string | null;
  sources: string[];
} {
  const sources = ["Google Business"];

  if (!websiteUri) {
    return { opp: "No Dedicated Website", presence: "No website listed on Google", website: null, sources };
  }

  const host = hostFromUrl(websiteUri);
  if (!host) {
    return { opp: "No Dedicated Website", presence: "No usable website found", website: null, sources };
  }

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
    case "No Dedicated Website": return opp === "No Dedicated Website";
    case "Facebook Only": return opp === "Facebook Only";
    case "Yelp/Directory Only": return opp === "Yelp/Directory Only";
    case "Social-Heavy": return opp === "Social-Heavy" || opp === "Facebook Only";
    case "Outdated Website": return opp === "Has Website";
    case "Has Website": return opp === "Has Website";
    default: return true;
  }
}

function parseCityState(addr: string | undefined, fallbackCity: string): { city: string; state: string } {
  const fb = fallbackCity.split(",");
  const fbCity = (fb[0] || "").trim();
  const fbState = (fb[1] || "").trim().slice(0, 2).toUpperCase();
  if (!addr) return { city: fbCity, state: fbState };

  const parts = addr.split(",").map((p) => p.trim());
  let city = fbCity;
  let state = fbState;
  if (parts.length >= 3) {
    city = parts[parts.length - 3] || fbCity;
    const stZip = parts[parts.length - 2] || "";
    const m = stZip.match(/\b([A-Z]{2})\b/);
    if (m) state = m[1];
  }
  return { city, state };
}

async function placesSearch(query: string, apiKey: string, pageToken?: string): Promise<PlacesResponse> {
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

export const Route = createFileRoute("/api/generate-leads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;
        if (!apiKey) return Response.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 500 });

        let body: { industry?: string; city?: string; count?: number; type?: string };
        try { body = await request.json(); } catch { body = {}; }
        const industry = (body.industry || "upholstery").trim();
        const city = (body.city || "Nashville, TN").trim();
        const count = Math.max(1, Math.min(15, body.count || 5));
        const type = body.type || "No Dedicated Website";

        const query = `${industry} in ${city}`;
        const target = count * 3;

        try {
          const places: Place[] = [];
          let pageToken: string | undefined;

          for (let page = 0; page < 3; page++) {
            const data = await placesSearch(query, apiKey, pageToken);
            if (data.places?.length) places.push(...data.places);
            pageToken = data.nextPageToken;
            if (!pageToken || places.length >= target) break;
          }

          if (!places.length) return Response.json({ leads: [] });

          const leads = places
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
              };
            })
            .filter((l) => l.business);

          // Enrichment/verification happens per-lead on the client via
          // /api/enrich-candidate so we can show progress. Return raw
          // candidates fast.
          return Response.json({ leads, requestedType: type });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 502 });
        }
      },
    },
  },
});
