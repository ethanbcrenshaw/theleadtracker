// CSV import source (Data Axle exports, or any business list).
//
// Not a query-driven source: rows arrive from the user via /api/import-csv.
// This module holds the hand-rolled RFC-4180-ish parser, the AI column
// mapping (heuristic fallback), and the row → DiscoveredCandidate conversion.
// Imported rows then flow through the exact same merge/dedupe/cross-check
// path as discovered candidates (runDiscovery extraCandidates).

import { aiExtract, getAI } from "../ai.server";
import { classify, matchesRequest } from "./places";
import type { DiscoveredCandidate } from "./types";

export const CSV_FIELDS = ["business", "phone", "city", "state", "website"] as const;
export type CsvField = (typeof CSV_FIELDS)[number];
/** header name (exact) per candidate field; null = not present in this CSV. */
export type CsvMapping = Record<CsvField, string | null>;

const MAX_CSV_ROWS = 2000;

/** Minimal RFC-4180 parser: quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > MAX_CSV_ROWS) break;
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

// Heuristic header matching — handles Data Axle's typical export shape
// (Company Name / Address parts / Phone Number / Web Address) without AI.
const HEADER_PATTERNS: Record<CsvField, RegExp> = {
  business: /company|business|firm|organization|^name$|dba/i,
  phone: /phone|tel(ephone)?/i,
  city: /city|locality|town/i,
  state: /^state|province|region|^st$/i,
  website: /web\s?(site|\s?address)?|url|domain|www/i,
};

export function heuristicMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {
    business: null,
    phone: null,
    city: null,
    state: null,
    website: null,
  };
  for (const field of CSV_FIELDS) {
    const hit = headers.find((h) => HEADER_PATTERNS[field].test(h.trim()));
    if (hit !== undefined) mapping[field] = hit;
  }
  return mapping;
}

/**
 * Propose a column mapping from the header row + a few sample rows.
 * AI first (understands odd export shapes), heuristics as fallback.
 */
export async function proposeMapping(
  headers: string[],
  sampleRows: string[][],
): Promise<CsvMapping> {
  const heuristic = heuristicMapping(headers);
  const ai = getAI();
  if (!ai) return heuristic;
  try {
    const res = await aiExtract<Partial<Record<CsvField, string | null>>>(ai, {
      system:
        "You map CSV columns from a business-list export (e.g. Data Axle) to lead fields. Given the header row and sample rows, return for each target field the EXACT header name of the column holding it, or null if absent. Fields: business (company name), phone, city, state, website (web address — often blank in these exports). Never map a SIC/NAICS description or an address street line to business.",
      user: `Headers: ${JSON.stringify(headers)}\nSample rows: ${JSON.stringify(sampleRows.slice(0, 3))}`,
      toolName: "report_mapping",
      toolDescription: "Report the column mapping",
      schema: {
        type: "object",
        properties: Object.fromEntries(CSV_FIELDS.map((f) => [f, { type: ["string", "null"] }])),
        required: [...CSV_FIELDS],
      },
      timeoutMs: 15_000,
    });
    if (!res) return heuristic;
    const mapping = { ...heuristic };
    for (const field of CSV_FIELDS) {
      const h = res[field];
      // AI names a real header → take it; otherwise keep the heuristic guess.
      if (typeof h === "string" && headers.includes(h)) mapping[field] = h;
    }
    return mapping;
  } catch (err) {
    console.error("[discovery] csv mapping AI failed (using heuristics):", err);
    return heuristic;
  }
}

/** Convert parsed rows to candidates using a confirmed mapping. */
export function rowsToCandidates(
  headers: string[],
  rows: string[][],
  mapping: CsvMapping,
  requestedType: string,
): DiscoveredCandidate[] {
  const idx: Partial<Record<CsvField, number>> = {};
  for (const field of CSV_FIELDS) {
    const h = mapping[field];
    if (h) {
      const i = headers.indexOf(h);
      if (i >= 0) idx[field] = i;
    }
  }
  if (idx.business === undefined) return [];

  const out: DiscoveredCandidate[] = [];
  for (const row of rows) {
    const cell = (f: CsvField) => (idx[f] !== undefined ? (row[idx[f]!] || "").trim() : "");
    const business = cell("business");
    const phone = cell("phone");
    if (!business && !phone) continue;
    if (!business) continue;
    const websiteRaw = cell("website");
    // Data Axle's web-address column is often blank — blank means the list
    // itself says they have no site.
    const { opp, website } = websiteRaw
      ? classify(websiteRaw)
      : { opp: "No Dedicated Website", website: null };
    out.push({
      business,
      city: cell("city"),
      state: cell("state").slice(0, 2).toUpperCase(),
      phone,
      owner: null,
      sourceUrl: website ? `https://${website}` : null,
      website,
      sources: ["Directory"],
      onlinePresence: websiteRaw
        ? `Imported list row — website on file (${websiteRaw})`
        : "Imported list row — no website on file",
      websiteOpportunity: opp,
      matchesFilter: matchesRequest(opp, requestedType),
      placesSignals: {},
      foundVia: ["csv-import"],
    });
  }
  return out;
}
