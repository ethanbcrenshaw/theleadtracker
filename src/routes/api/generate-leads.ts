import { createFileRoute } from "@tanstack/react-router";
// Side-effect import to activate `server` route option augmentation
import "@tanstack/react-start";

const FC = "https://api.firecrawl.dev/v2";
const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

type SearchItem = {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
};

async function fcSearch(query: string, fcKey: string, limit = 8, scrape = true): Promise<SearchItem[]> {
  const res = await fetch(`${FC}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      limit,
      ...(scrape ? { scrapeOptions: { formats: ["markdown"], onlyMainContent: true } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data?: { web?: SearchItem[] } | SearchItem[]; web?: SearchItem[] };
  // SDK v2 shape
  if (Array.isArray((data as { data?: SearchItem[] }).data)) return (data as { data: SearchItem[] }).data;
  const web = (data as { data?: { web?: SearchItem[] } }).data?.web ?? (data as { web?: SearchItem[] }).web;
  return web ?? [];
}

async function aiExtract(industry: string, city: string, type: string, count: number, snippets: string, lovableKey: string) {
  const prompt = `You are extracting REAL local business leads from web search results.

Industry: ${industry}
City / area: ${city}
Lead type wanted (preferred, but include all): ${type}
Want up to ${count * 3} candidate businesses (we will filter later).

From the search excerpts below, identify distinct LOCAL businesses (not directories, not national chains). For each one, return what you can find:
- business name (exact, as it appears)
- city and state (2-letter)
- phone in (xxx) xxx-xxxx format if present
- owner: full name if clearly stated, otherwise null
- sourceUrl: the URL the business info came from
- candidateDomain: if you see a likely business website domain (NOT facebook.com, yelp.com, yellowpages.com, mapquest.com, angi.com, houzz.com, bbb.org, instagram.com, google.com), include it as just the hostname (e.g. "acmeupholstery.com"). Otherwise null.

Skip entries that are clearly directories themselves (yellowpages.com, yelp.com top-level), national franchises, or anything where you can't get at least a business name + city.

Return strict JSON: {"leads": [ { ...fields above } ]}.

Search excerpts:
${snippets.slice(0, 16000)}`;

  const res = await fetch(AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  try {
    return JSON.parse(data.choices[0].message.content) as { leads: unknown[] };
  } catch {
    return { leads: [] };
  }
}

const DIRECTORY_HOSTS = [
  "facebook.com", "yelp.com", "yellowpages.com", "mapquest.com", "angi.com",
  "houzz.com", "bbb.org", "instagram.com", "google.com", "linkedin.com",
  "nextdoor.com", "thumbtack.com", "manta.com", "foursquare.com", "tripadvisor.com",
  "porch.com", "homeadvisor.com", "alignable.com",
];

function isDirectory(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return DIRECTORY_HOSTS.some((d) => h === d || h.endsWith("." + d));
}

function hostFromUrl(u: string): string | null {
  try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname; } catch { return null; }
}

/** Returns { website, sources } discovered for a business name + city. */
async function verifyPresence(business: string, city: string, candidateDomain: string | null, fcKey: string) {
  const sources = new Set<string>();
  let website: string | null = null;

  // 1. If AI suggested a domain, verify it's reachable & not a directory.
  if (candidateDomain && !isDirectory(candidateDomain)) {
    website = candidateDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  // 2. Search the web for this exact business — see what platforms surface.
  try {
    const q = `"${business}" ${city}`;
    const items = await fcSearch(q, fcKey, 6, false);
    for (const it of items) {
      const host = hostFromUrl(it.url);
      if (!host) continue;
      const h = host.toLowerCase().replace(/^www\./, "");
      if (h.includes("facebook.com")) sources.add("Facebook");
      else if (h.includes("yelp.com")) sources.add("Yelp");
      else if (h.includes("instagram.com")) sources.add("Instagram");
      else if (h.includes("houzz.com")) sources.add("Houzz");
      else if (h.includes("angi.com") || h.includes("angieslist")) sources.add("Angie's List");
      else if (h.includes("mapquest.com")) sources.add("MapQuest");
      else if (h.includes("google.com/maps") || h.includes("business.google")) sources.add("Google Business");
      else if (isDirectory(h)) sources.add("Directory");
      else if (!website) {
        // First non-directory hit — likely their own site.
        website = h;
      }
    }
  } catch { /* ignore search failures, fall through */ }

  if (website) sources.add("Website");
  return { website, sources: Array.from(sources) };
}

function classify(website: string | null, sources: string[]): { opp: string; presence: string } {
  const s = new Set(sources);
  if (website) {
    return { opp: "Has Website", presence: `Active site (${website})${s.size > 1 ? ` + ${[...s].filter(x => x !== "Website").join(", ")}` : ""}` };
  }
  if (s.has("Facebook") && s.size === 1) return { opp: "Facebook Only", presence: "Facebook page only — no website" };
  if (s.has("Facebook") && (s.has("Instagram") || s.has("Yelp"))) return { opp: "Social-Heavy", presence: `Social presence (${[...s].join(", ")}) — no website` };
  if (s.has("Yelp") || s.has("Directory") || s.has("MapQuest")) return { opp: "Yelp/Directory Only", presence: `Listed on ${[...s].join(", ")} — no website` };
  return { opp: "No Dedicated Website", presence: "No clear web presence found" };
}

function matchesRequest(opp: string, want: string): boolean {
  if (want === "No Dedicated Website") return opp !== "Has Website" && opp !== "Outdated Website";
  if (want === "Facebook Only") return opp === "Facebook Only";
  if (want === "Yelp/Directory Only") return opp === "Yelp/Directory Only" || opp === "No Dedicated Website";
  if (want === "Social-Heavy") return opp === "Social-Heavy" || opp === "Facebook Only";
  return true;
}

export const Route = createFileRoute("/api/generate-leads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const fcKey = process.env.FIRECRAWL_API_KEY;
        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!fcKey) return Response.json({ error: "FIRECRAWL_API_KEY not configured" }, { status: 500 });
        if (!lovableKey) return Response.json({ error: "LOVABLE_API_KEY not configured" }, { status: 500 });

        let body: { industry?: string; city?: string; count?: number; type?: string };
        try { body = await request.json(); } catch { body = {}; }
        const industry = (body.industry || "upholstery").trim();
        const city = (body.city || "Nashville TN").trim();
        const count = Math.max(1, Math.min(15, body.count || 5));
        const type = body.type || "No Dedicated Website";

        const queryByType: Record<string, string> = {
          "No Dedicated Website": `${industry} ${city} -site:yelp.com -site:yellowpages.com small business`,
          "Facebook Only": `${industry} ${city} site:facebook.com`,
          "Yelp/Directory Only": `${industry} ${city} site:yelp.com`,
          "Outdated Website": `${industry} ${city} small business`,
          "Social-Heavy": `${industry} ${city} instagram OR facebook`,
          "Has Website": `${industry} ${city}`,
        };
        const query = queryByType[type] || `${industry} ${city}`;

        try {
          const items = await fcSearch(query, fcKey, 10, true);
          if (!items.length) return Response.json({ leads: [] });

          const snippets = items
            .map((r) => `URL: ${r.url}\nTITLE: ${r.title || ""}\n${(r.markdown || r.description || "").slice(0, 2000)}`)
            .join("\n---\n");

          const extracted = await aiExtract(industry, city, type, count, snippets, lovableKey);
          const candidates = (extracted.leads ?? []) as Array<Record<string, unknown>>;

          // Verify each candidate's actual web presence (in parallel, capped).
          const verified = await Promise.all(
            candidates.slice(0, 12).map(async (c) => {
              const business = String(c.business || c.business_name || c.name || "").trim();
              if (!business) return null;
              const cityStr = String(c.city || city.split(",")[0]).trim();
              const candDomain = c.candidateDomain ? String(c.candidateDomain) : null;
              const { website, sources } = await verifyPresence(business, cityStr, candDomain, fcKey);
              const { opp, presence } = classify(website, sources);
              return {
                business,
                city: cityStr,
                state: String(c.state || (city.split(",")[1] || "TN")).trim().slice(0, 2).toUpperCase(),
                phone: String(c.phone || "").trim(),
                owner: c.owner || null,
                sourceUrl: c.sourceUrl || (website ? `https://${website}` : null),
                website,
                sources: sources.length ? sources : ["Other"],
                onlinePresence: presence,
                websiteOpportunity: opp,
                matchesFilter: matchesRequest(opp, type),
              };
            })
          );

          const leads = verified.filter((x): x is NonNullable<typeof x> => !!x);
          return Response.json({ leads, requestedType: type });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 502 });
        }
      },
    },
  },
});