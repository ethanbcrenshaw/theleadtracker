import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/start-client-core/dist/esm/serverRoute";

const FC = "https://api.firecrawl.dev/v2";
const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

type SearchItem = {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
};

async function fcSearch(query: string, fcKey: string): Promise<SearchItem[]> {
  const res = await fetch(`${FC}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      limit: 8,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
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
Lead type wanted: ${type}
Want up to ${count} businesses.

From the search excerpts below, identify distinct LOCAL businesses (not directories, not national chains). For each one, return what you can find:
- business name (exact, as it appears)
- city and state (2-letter)
- phone in (xxx) xxx-xxxx format if present
- onlinePresence: short human description like "Facebook page only", "Yelp + MapQuest, no website", "Outdated WordPress site"
- websiteOpportunity: one of "No Dedicated Website" | "Facebook Only" | "Yelp/Directory Only" | "Outdated Website" | "Has Website" | "Social-Heavy"
- sources: array from ["Yelp","Facebook","Google Business","Angie's List","MapQuest","Website","Instagram","Houzz","Directory","Other"]
- owner: full name if clearly stated, otherwise null
- sourceUrl: the URL the business info came from

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
          const items = await fcSearch(query, fcKey);
          if (!items.length) return Response.json({ leads: [] });

          const snippets = items
            .map((r) => `URL: ${r.url}\nTITLE: ${r.title || ""}\n${(r.markdown || r.description || "").slice(0, 2000)}`)
            .join("\n---\n");

          const extracted = await aiExtract(industry, city, type, count, snippets, lovableKey);
          return Response.json({ leads: extracted.leads ?? [] });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 502 });
        }
      },
    },
  },
});