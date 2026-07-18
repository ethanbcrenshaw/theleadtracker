// Knox County new-business registry source (experimental, no key needed).
//
// The Knox County Clerk business directory (secure.tncountyclerk.com,
// county 47) is searchable by business start date with plain fetches:
//   1. GET  /businesslist/?countylist=47      → session cookie + CSRF token
//   2. POST /businesslist/searchResults.php   → server-rendered <table> rows
//      (dates MUST be yyyy-mm-dd — the page's datepicker format; mm/dd/yyyy
//      silently returns zero rows)
// Rows: Business Name | Product | Address | Owner | Start Date. No phone
// numbers — these are brand-new registrations with zero online presence,
// which is exactly the point. Industry filtering is deliberately loose
// (registry categories are coarse); the review modal is where the user culls.

import { isKnoxMetro, KNOX_METRO } from "./market";
import { matchesRequest } from "./places";
import type { DiscoveredCandidate, DiscoveryQuery, DiscoverySource, SourceBudget } from "./types";

const BASE = "https://secure.tncountyclerk.com/businesslist";
const REGISTRY_TIMEOUT_MS = 12_000;
const LOOKBACK_DAYS = 60;
/** Cap on rows converted to candidates per run (541 filings/60 days is typical). */
const MAX_REGISTRY_CANDIDATES = 60;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REGISTRY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** "1031 FORD PLACE KNOXVILLE TN 37920" → metro town if one appears. */
function cityFromAddress(addr: string, fallback: string): string {
  const upper = addr.toUpperCase();
  for (const town of KNOX_METRO) {
    if (upper.includes(town.toUpperCase())) return town;
  }
  return fallback;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bLlp\b/g, "LLP");
}

/** Loose stem match: any industry word (first 5 chars) appears in the text. */
function looseIndustryMatch(industry: string, text: string): boolean {
  const hay = text.toLowerCase();
  return industry
    .toLowerCase()
    .split(/[\s,/&]+/)
    .filter((w) => w.length > 3)
    .some((w) => hay.includes(w.slice(0, 5)));
}

type RegistryRow = {
  business: string;
  product: string;
  address: string;
  owner: string;
  startDate: string;
};

function parseRows(html: string): RegistryRow[] {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  if (!tbody) return [];
  const out: RegistryRow[] = [];
  for (const tr of tbody.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (tr.match(/<td[\s\S]*?<\/td>/g) ?? []).map((td) =>
      td
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length < 5) continue;
    out.push({
      business: cells[0],
      product: cells[1],
      address: cells[2],
      owner: cells[3],
      startDate: cells[4],
    });
  }
  return out;
}

export const knoxRegistrySource: DiscoverySource = {
  id: "knox-registry",
  // No API key needed — but the data is Knox County only.
  isConfigured: () => true,
  async discover(q: DiscoveryQuery, budget: SourceBudget): Promise<DiscoveredCandidate[]> {
    if (!isKnoxMetro(q.city)) return [];
    try {
      if (!budget.take()) return [];
      const search = await fetchWithTimeout(`${BASE}/?countylist=47`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBloom/1.0)" },
      });
      if (!search.ok) throw new Error(`registry search page ${search.status}`);
      const cookie = (search.headers.get("set-cookie") || "").split(";")[0];
      const token = (await search.text()).match(/name="token" value="([^"]+)"/)?.[1];
      if (!token) throw new Error("registry token not found — page layout changed?");

      if (!budget.take()) return [];
      const body = new URLSearchParams({
        token,
        BmStartDateSTART_DATE: isoDaysAgo(LOOKBACK_DAYS),
        BmStartDateALIAS: "a",
        BmStartDateEND_DATE: isoDaysAgo(0),
        orderby: "a.bmBusName",
        orderbyvalue: "ASC",
        countylist: "47",
      });
      const res = await fetchWithTimeout(`${BASE}/searchResults.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; LeadBloom/1.0)",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(`registry search ${res.status}`);
      const rows = parseRows(await res.text());

      const town = q.city.split(",")[0].trim();
      const relevant = rows.filter((r) =>
        looseIndustryMatch(q.industry, `${r.business} ${r.product}`),
      );
      // Newest filings first — nobody else is calling these yet.
      relevant.sort((a, b) => b.startDate.localeCompare(a.startDate));

      return relevant.slice(0, MAX_REGISTRY_CANDIDATES).map((r) => ({
        business: titleCase(r.business),
        city: cityFromAddress(r.address, town),
        state: "TN",
        phone: "",
        owner: r.owner ? titleCase(r.owner) : null,
        sourceUrl: null,
        website: null,
        sources: ["Other"],
        onlinePresence: `New business registration — Knox County (${r.product.toLowerCase() || "unspecified"})`,
        websiteOpportunity: "No Dedicated Website",
        matchesFilter: matchesRequest("No Dedicated Website", q.type),
        placesSignals: {},
        foundVia: ["knox-registry"],
        registeredAt: r.startDate,
      }));
    } catch (err) {
      console.error("[discovery] knox-registry failed:", err);
      return [];
    }
  },
};
