// Firecrawl web-search discovery source — the off-Google net.
//
// Searches places Google Business doesn't cover: Facebook pages, Nextdoor,
// directory listings (YellowPages/Yelp/BBB), Craigslist services ads, and the
// Knoxville Chamber member directory. Hits are AI-extracted into candidates;
// the orchestrator's Places cross-check then decides which are truly
// off-Google. Degrades gracefully: no FIRECRAWL_API_KEY → source skipped; no
// AI key → cheap regex extraction (phone-bearing hits only).

import { aiExtract, getAI } from "../ai.server";
import { firecrawlSearch } from "../enrichment.server";
import { isKnoxMetro } from "./market";
import { DIRECTORY_HOSTS, hostFromUrl, matchesRequest } from "./places";
import type { DiscoveredCandidate, DiscoveryQuery, DiscoverySource, SourceBudget } from "./types";

/** ~2 engine results-pages per query. */
const RESULTS_PER_QUERY = 20;
/** Cap on hits fed to one AI extraction call. */
const MAX_HITS_FOR_EXTRACTION = 100;
const AI_EXTRACT_TIMEOUT_MS = 25_000;

type Hit = { title: string; description: string; url: string };

function stateOf(city: string): string {
  const st = (city.split(",")[1] || "").trim().slice(0, 2).toUpperCase();
  return st || "TN";
}

function buildQueries(q: DiscoveryQuery): string[] {
  const town = q.city.split(",")[0].trim();
  const st = stateOf(q.city);
  const queries = [
    `site:facebook.com "${q.industry}" "${town}" phone`,
    `site:nextdoor.com "${q.industry}" "${town}"`,
    `site:yellowpages.com "${q.industry}" "${town}"`,
    `site:yelp.com "${q.industry}" "${town}"`,
    `"${q.industry}" "${town}" ${st} phone -site:google.com`,
  ];
  if (isKnoxMetro(q.city)) {
    queries.push(
      `site:knoxville.craigslist.org "${q.industry}"`,
      `site:bbb.org "${q.industry}" "Knoxville"`,
      `site:web.knoxvillechamber.com "${q.industry}"`,
    );
  } else {
    queries.push(`site:bbb.org "${q.industry}" "${town}"`);
  }
  return queries;
}

/** Classify a candidate by the host it was found on (no Google data here). */
function classifyHit(sourceUrl: string): {
  opp: string;
  presence: string;
  website: string | null;
  sources: string[];
} {
  const host = hostFromUrl(sourceUrl) || "";
  if (host.endsWith("facebook.com"))
    return {
      opp: "Facebook Only",
      presence: "Facebook page found via web search — no website surfaced",
      website: null,
      sources: ["Facebook"],
    };
  if (host.endsWith("instagram.com"))
    return {
      opp: "Social-Heavy",
      presence: "Instagram presence found via web search",
      website: null,
      sources: ["Instagram"],
    };
  if (host.endsWith("craigslist.org"))
    return {
      opp: "No Dedicated Website",
      presence: "Advertises on Craigslist services — likely phone-only operation",
      website: null,
      sources: ["Other"],
    };
  if (host.includes("knoxvillechamber"))
    return {
      opp: "Yelp/Directory Only",
      presence: "Knoxville Chamber member listing",
      website: null,
      sources: ["Directory"],
    };
  if (DIRECTORY_HOSTS.some((d) => host === d || host.endsWith("." + d)))
    return {
      opp: "Yelp/Directory Only",
      presence: `Listed on ${host} — found via web search`,
      website: null,
      sources: ["Directory"],
    };
  // Unknown host — plausibly the business's own site; enrichment verifies it.
  return {
    opp: "Has Website",
    presence: `Found on ${host} via web search`,
    website: host || null,
    sources: ["Website"],
  };
}

type Extracted = { business: string; phone?: string; city?: string; sourceUrl: string };

async function aiExtractBusinesses(hits: Hit[], q: DiscoveryQuery): Promise<Extracted[] | null> {
  const ai = getAI();
  if (!ai) return null;
  try {
    const res = await aiExtract<{ businesses: Extracted[] }>(ai, {
      system:
        "You extract individual local businesses from web search results (title, snippet, url). For each distinct business: its exact name, a phone number if one appears in the title/snippet, its city if evident, and the url of the hit it came from. Skip results that are not a specific local business (articles, category/list pages with no single business, government pages). Never invent phone numbers — only report digits present in the text.",
      user: `Industry sought: ${q.industry}. Area: ${q.city}.\n\nSearch hits:\n${JSON.stringify(hits, null, 1)}`,
      toolName: "report_businesses",
      toolDescription: "Report each distinct local business found in the search hits",
      schema: {
        type: "object",
        properties: {
          businesses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                business: { type: "string" },
                phone: { type: "string" },
                city: { type: "string" },
                sourceUrl: { type: "string" },
              },
              required: ["business", "sourceUrl"],
            },
          },
        },
        required: ["businesses"],
      },
      timeoutMs: AI_EXTRACT_TIMEOUT_MS,
    });
    return res?.businesses ?? [];
  } catch (err) {
    console.error("[discovery] firecrawl-search AI extraction failed:", err);
    return null;
  }
}

const PHONE_RE = /\(?\d{3}\)?[\s.–-]?\d{3}[\s.–-]?\d{4}/;

/** No-AI fallback: keep only hits with a phone in the snippet; title = name. */
function cheapExtract(hits: Hit[]): Extracted[] {
  const out: Extracted[] = [];
  for (const h of hits) {
    const m = `${h.title} ${h.description}`.match(PHONE_RE);
    if (!m) continue;
    const business = h.title
      .split(/[|–—-]/)[0]
      .replace(/\b(yelp|facebook|yellowpages|bbb|nextdoor)\b.*$/i, "")
      .trim();
    if (business.length < 3) continue;
    out.push({ business, phone: m[0], sourceUrl: h.url });
  }
  return out;
}

export const firecrawlSearchSource: DiscoverySource = {
  id: "firecrawl-search",
  isConfigured: () => Boolean(process.env.FIRECRAWL_API_KEY),
  async discover(q: DiscoveryQuery, budget: SourceBudget): Promise<DiscoveredCandidate[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return [];

    const hits: Hit[] = [];
    const seenUrls = new Set<string>();
    for (const query of buildQueries(q)) {
      if (!budget.take()) break;
      const results = await firecrawlSearch(query, apiKey, RESULTS_PER_QUERY);
      for (const r of results) {
        if (!r.url || seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        hits.push({ title: r.title || "", description: r.description || "", url: r.url });
      }
    }
    if (!hits.length) return [];

    const extracted =
      (await aiExtractBusinesses(hits.slice(0, MAX_HITS_FOR_EXTRACTION), q)) ?? cheapExtract(hits);

    const town = q.city.split(",")[0].trim();
    const st = stateOf(q.city);
    const out: DiscoveredCandidate[] = [];
    for (const e of extracted) {
      const business = (e.business || "").trim();
      const phone = (e.phone || "").trim();
      // No phone AND no usable name → not a lead.
      if (business.length < 3 && !phone) continue;
      if (!business) continue;
      const { opp, presence, website, sources } = classifyHit(e.sourceUrl || "");
      out.push({
        business,
        city: (e.city || town).trim(),
        state: st,
        phone,
        owner: null,
        sourceUrl: e.sourceUrl || null,
        website,
        sources,
        onlinePresence: presence,
        websiteOpportunity: opp,
        matchesFilter: matchesRequest(opp, q.type),
        placesSignals: {},
        foundVia: ["firecrawl-search"],
      });
    }
    return out;
  },
};
