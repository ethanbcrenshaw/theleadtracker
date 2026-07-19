// Multi-source discovery orchestrator.
//
// Runs the requested sources concurrently (each with its own call budget),
// merges/dedupes their candidates, cross-checks non-Google finds against
// Places to flag offGoogle, filters out already-saved leads, and returns the
// list sorted: off-Google finds first, then filter matches, then the rest.
// A missing key or a failing source never fails the run — it degrades with a
// note in the result.

import { runWithConcurrency } from "../enrichment.server";
import { firecrawlSearchSource } from "./firecrawl-search";
import { foursquareSource } from "./foursquare";
import { knoxRegistrySource } from "./knox-registry";
import { filterAgainstSavedLeads, mergeCandidates, nameKeyOf, phoneKeyOf } from "./merge";
import { placesLookup, placesSource } from "./places";
import { SourceBudget } from "./types";
import type {
  DiscoveredCandidate,
  DiscoveryQuery,
  DiscoverySource,
  DiscoverySourceId,
} from "./types";

// Per-run external-call caps, per source.
export const SOURCE_CALL_BUDGETS: Record<DiscoverySourceId, number> = {
  places: 10,
  "firecrawl-search": 8,
  foursquare: 10,
  "csv-import": 0, // rows come from the user; no discovery-time calls
  "knox-registry": 4,
};
/** Max Places lookups per run spent deciding offGoogle for non-Google finds. */
export const CROSSCHECK_CALL_BUDGET = 15;
/** Stop discovering once unique candidates reach count × OVERSHOOT_FACTOR. */
export const OVERSHOOT_FACTOR = 3;

const REGISTRY: Partial<Record<DiscoverySourceId, DiscoverySource>> = {
  places: placesSource,
  "firecrawl-search": firecrawlSearchSource,
  foursquare: foursquareSource,
  "knox-registry": knoxRegistrySource,
};

export function availableSources(): Array<{ id: DiscoverySourceId; configured: boolean }> {
  return (Object.keys(REGISTRY) as DiscoverySourceId[]).map((id) => ({
    id,
    configured: REGISTRY[id]!.isConfigured(),
  }));
}

export interface DiscoveryRunResult {
  candidates: DiscoveredCandidate[];
  /** Raw (pre-merge) candidate count per source id that ran. */
  perSource: Record<string, number>;
  /** Candidates dropped because they matched an already-saved lead. */
  droppedExisting: number;
  /** Human-readable degradation notes (skipped sources, failures). */
  notes: string[];
}

/** Does this Places result plausibly match the candidate? Phone first, then fuzzy name. */
function placesMatchesCandidate(
  cand: DiscoveredCandidate,
  places: Array<{ nationalPhoneNumber?: string; displayName?: { text?: string } }>,
): boolean {
  const pk = phoneKeyOf(cand.phone);
  const nk = nameKeyOf(cand.business);
  for (const p of places) {
    const ppk = phoneKeyOf(p.nationalPhoneNumber);
    if (pk && ppk && pk === ppk) return true;
    const pn = nameKeyOf(p.displayName?.text);
    if (nk.length >= 4 && pn.length >= 4 && (pn.includes(nk) || nk.includes(pn))) return true;
  }
  return false;
}

/** Flag merged non-Places candidates that Google can't find. Mutates in place. */
async function crossCheckOffGoogle(
  candidates: DiscoveredCandidate[],
  notes: string[],
  outOfTime: () => boolean,
): Promise<void> {
  // Spend the capped lookups on the likeliest gold first: filter matches,
  // then phone-bearing candidates, then the rest.
  const targets = candidates
    .filter((c) => !c.foundVia.includes("places") && c.offGoogle === undefined)
    .sort(
      (a, b) =>
        Number(b.matchesFilter) - Number(a.matchesFilter) ||
        Number(Boolean(b.phone)) - Number(Boolean(a.phone)),
    );
  if (!targets.length) return;
  if (!placesSource.isConfigured()) {
    notes.push("off-Google cross-check skipped — GOOGLE_PLACES_API_KEY missing");
    return;
  }
  const budget = new SourceBudget(CROSSCHECK_CALL_BUDGET, outOfTime);
  await runWithConcurrency(targets, 3, async (cand) => {
    const results = await placesLookup(`"${cand.business}" ${cand.city}`, budget);
    if (results === null) return; // budget exhausted or error — unknown, not off-Google
    cand.offGoogle = !placesMatchesCandidate(cand, results);
  });
  if (budget.used >= CROSSCHECK_CALL_BUDGET) {
    notes.push(`off-Google cross-check budget hit (${CROSSCHECK_CALL_BUDGET} lookups)`);
  }
}

export function sortForReview(candidates: DiscoveredCandidate[]): DiscoveredCandidate[] {
  const rank = (c: DiscoveredCandidate) => {
    if (c.phoneInvalid) return 3; // bad phones sink to the bottom
    if (c.offGoogle) return 0; // the gold
    if (c.matchesFilter) return 1;
    return 2;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b));
}

export async function runDiscovery(
  query: DiscoveryQuery,
  opts?: {
    sources?: DiscoverySourceId[];
    /** Extra candidate lists to merge in (e.g. parsed CSV rows). */
    extraCandidates?: DiscoveredCandidate[][];
    /**
     * Soft wall-clock budget for the whole run. Once exceeded, no NEW
     * external calls start (in-flight ones finish) — the run returns what it
     * has instead of blowing a serverless window. Omit for no limit.
     */
    timeBudgetMs?: number;
  },
): Promise<DiscoveryRunResult> {
  // Explicit [] means "no discovery sources" (e.g. CSV-only import runs);
  // omitting the option keeps the legacy Places-only default.
  const requested = opts?.sources ?? (["places"] as DiscoverySourceId[]);
  const notes: string[] = [];
  const perSource: Record<string, number> = {};
  const resultsBySource = new Map<DiscoverySourceId, DiscoveredCandidate[]>();

  const runnable: DiscoverySource[] = [];
  for (const id of requested) {
    const src = REGISTRY[id];
    if (!src) {
      notes.push(`source "${id}" not available`);
      continue;
    }
    if (!src.isConfigured()) {
      notes.push(`source "${id}" skipped — not configured`);
      continue;
    }
    runnable.push(src);
  }

  // Early-stop signals shared by all budgets: enough unique candidates
  // already, or the run's wall-clock budget is spent.
  const deadline = opts?.timeBudgetMs ? Date.now() + opts.timeBudgetMs : Infinity;
  const outOfTime = () => Date.now() > deadline;
  const targetUnique = Math.max(query.count, 1) * OVERSHOOT_FACTOR;
  const enough = () => {
    if (outOfTime()) return true;
    const lists = [...resultsBySource.values(), ...(opts?.extraCandidates ?? [])];
    if (!lists.length) return false;
    return mergeCandidates(lists).length >= targetUnique;
  };

  await runWithConcurrency(runnable, 3, async (src) => {
    const budget = new SourceBudget(SOURCE_CALL_BUDGETS[src.id], enough);
    try {
      const found = await src.discover(query, budget);
      resultsBySource.set(src.id, found);
      perSource[src.id] = found.length;
    } catch (err) {
      notes.push(`source "${src.id}" failed — ${err instanceof Error ? err.message : err}`);
      perSource[src.id] = 0;
    }
  });

  // Merge in source-priority order: Places first (authoritative), then the
  // rest in the order requested, then extras (CSV imports).
  const ordered: DiscoveredCandidate[][] = [];
  if (resultsBySource.has("places")) ordered.push(resultsBySource.get("places")!);
  for (const id of requested) {
    if (id !== "places" && resultsBySource.has(id)) ordered.push(resultsBySource.get(id)!);
  }
  for (const extra of opts?.extraCandidates ?? []) {
    perSource[extra[0]?.foundVia[0] ?? "extra"] = extra.length;
    ordered.push(extra);
  }

  const merged = mergeCandidates(ordered);
  await crossCheckOffGoogle(merged, notes, outOfTime);
  const { fresh, droppedExisting } = await filterAgainstSavedLeads(merged);
  if (outOfTime()) notes.push("time budget reached — returned what was found so far");

  return { candidates: sortForReview(fresh), perSource, droppedExisting, notes };
}

export { SourceBudget } from "./types";
export type {
  DiscoveredCandidate,
  DiscoveryQuery,
  DiscoverySource,
  DiscoverySourceId,
} from "./types";
