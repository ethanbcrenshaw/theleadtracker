// Shared contracts for the multi-source discovery engine.
//
// Every source (Google Places, Firecrawl web search, Foursquare, CSV import,
// Knox County registry) produces the same DiscoveredCandidate currency; the
// orchestrator in index.ts merges/dedupes them. Sources must degrade
// gracefully: isConfigured() false (missing key) means "skip me", and any
// runtime failure should log + return [] rather than throw.

import type { PlacesSignals } from "../verification.server";

export type DiscoverySourceId =
  | "places"
  | "firecrawl-search"
  | "foursquare"
  | "csv-import"
  | "knox-registry";

export interface DiscoveryQuery {
  industry: string;
  city: string;
  count: number;
  type: string;
  /** Fan queries across the Knoxville metro towns (market.ts). */
  expandMetro?: boolean;
}

/**
 * Per-source spend tracker. Call take() before each external API request;
 * false means the budget is exhausted (or the run already has enough
 * candidates) and the source must return what it has.
 */
export class SourceBudget {
  used = 0;
  constructor(
    readonly maxCalls: number,
    private readonly isSatisfied: () => boolean = () => false,
  ) {}
  take(): boolean {
    if (this.used >= this.maxCalls || this.isSatisfied()) return false;
    this.used++;
    return true;
  }
  get satisfied(): boolean {
    return this.isSatisfied();
  }
}

export interface DiscoveredCandidate {
  business: string;
  city: string;
  state: string;
  phone: string;
  owner: string | null;
  sourceUrl: string | null;
  website: string | null;
  sources: string[];
  onlinePresence: string;
  websiteOpportunity: string;
  matchesFilter: boolean;
  placesSignals: PlacesSignals;
  /** Which discovery sources found this business (source ids, unioned on merge). */
  foundVia: string[];
  /** Cross-checked against Google Places and NOT found there — prime prospect. */
  offGoogle?: boolean;
  /** ISO date a registry source saw the business registered (new-filing finds). */
  registeredAt?: string;
  /** Phone failed US validation during merge — surfaced, not dropped. */
  phoneInvalid?: boolean;
}

export interface DiscoverySource {
  readonly id: DiscoverySourceId;
  isConfigured(): boolean;
  discover(q: DiscoveryQuery, budget: SourceBudget): Promise<DiscoveredCandidate[]>;
}
