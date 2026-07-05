import { createFileRoute } from "@tanstack/react-router";
// Side-effect import to activate `server` route option augmentation
import "@tanstack/react-start";
import { enrichLeadFull, runWithConcurrency as runWithConcurrencyShared, type EnrichResult } from "@/lib/enrichment.server";

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

const ENRICH_MAX = 12;
const ENRICH_CONCURRENCY = 3;

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

const OUTDATED_MAX_CHECKS = 10;
const OUTDATED_CONCURRENCY = 3;
const OUTDATED_TIMEOUT_MS = 6000;
const CURRENT_YEAR = new Date().getFullYear();

async function firecrawlScrape(url: string, apiKey: string): Promise<{ html?: string; markdown?: string; metadata?: { sourceURL?: string; url?: string; statusCode?: number } } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OUTDATED_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["html", "markdown"],
        onlyMainContent: false,
        timeout: OUTDATED_TIMEOUT_MS,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: unknown };
    if (!json?.success) return null;
    return (json.data ?? null) as { html?: string; markdown?: string; metadata?: { sourceURL?: string; url?: string; statusCode?: number } } | null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isOutdated(url: string, doc: { html?: string; markdown?: string; metadata?: { sourceURL?: string; url?: string; statusCode?: number } } | null): boolean {
  // Fetch failed / unreachable
  if (!doc) return true;

  const finalUrl = doc.metadata?.sourceURL || doc.metadata?.url || url;
  const finalHost = hostFromUrl(finalUrl);
  if (finalHost) {
    for (const social of Object.keys(SOCIAL_HOSTS)) {
      if (finalHost === social || finalHost.endsWith("." + social)) return true;
    }
    if (isOneOf(finalHost, DIRECTORY_HOSTS)) return true;
  }

  const html = doc.html || "";
  const text = `${html}\n${doc.markdown || ""}`;

  // No mobile viewport meta tag
  if (html && !/<meta[^>]+name=["']viewport["']/i.test(html)) return true;

  // Very small page → likely parked/empty
  if (html && html.length < 500) return true;

  // Parked-domain markers
  if (/domain (is )?for sale|buy this domain|parked( free)? by|godaddy\.com\/domains|sedoparking|hugedomains/i.test(text)) return true;

  // Outdated visible copyright year
  const years = Array.from(text.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}(20\d{2})/gi)).map((m) => parseInt(m[1], 10));
  if (years.length) {
    const latest = Math.max(...years);
    if (CURRENT_YEAR - latest > 5) return true;
  }

  return false;
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx]); } catch { /* swallow */ }
    }
  });
  await Promise.all(workers);
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

          // Outdated-website detection pass (bounded, non-blocking on failure).
          const firecrawlKey = process.env.FIRECRAWL_API_KEY;
          if (firecrawlKey) {
            const candidates = leads
              .filter((l) => l.websiteOpportunity === "Has Website" && l.website)
              .slice(0, OUTDATED_MAX_CHECKS);
            try {
              await runWithConcurrency(candidates, OUTDATED_CONCURRENCY, async (lead) => {
                const url = `https://${lead.website}`;
                const doc = await firecrawlScrape(url, firecrawlKey);
                if (isOutdated(url, doc)) {
                  lead.websiteOpportunity = "Outdated Website";
                  lead.onlinePresence = `Has a website (${lead.website}) — looks outdated or unreachable`;
                  if (!lead.sources.includes("Outdated-Check")) lead.sources.push("Outdated-Check");
                  lead.matchesFilter = matchesRequest(lead.websiteOpportunity, type);
                }
              });
            } catch {
              // Never let this pass break generation.
            }
          }

          // Enrichment pass — never blocks the batch on failure.
          const aiKey = process.env.LOVABLE_API_KEY;
          const enrichedLeads = leads as (typeof leads[number] & Partial<EnrichResult>)[];
          if (firecrawlKey) {
            const toEnrich = enrichedLeads.slice(0, ENRICH_MAX);
            try {
              await runWithConcurrencyShared(toEnrich, ENRICH_CONCURRENCY, async (lead) => {
                try {
                  const e = await enrichLeadFull(
                    { business: lead.business, city: lead.city, state: lead.state, phone: lead.phone, website: lead.website, websiteOpportunity: lead.websiteOpportunity },
                    { firecrawlKey, aiKey },
                  );
                  lead.enrichment = e.enrichment;
                  lead.confidenceScore = e.confidenceScore;
                  lead.confidenceEvidence = e.confidenceEvidence;
                  lead.unverified = e.unverified;
                  lead.unverifiedReason = e.unverifiedReason;
                } catch {
                  lead.confidenceScore = 25;
                  lead.confidenceEvidence = ["enrichment failed"];
                }
              });
            } catch { /* never block on enrichment */ }
          }

          return Response.json({ leads, requestedType: type });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 502 });
        }
      },
    },
  },
});
