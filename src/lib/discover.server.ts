// Thin compatibility re-export. The Places discovery implementation moved to
// src/lib/discovery/places.ts as part of the multi-source discovery engine
// (see src/lib/discovery/index.ts for the orchestrator). Existing importers
// (/api/generate-leads, the assistant) keep working unchanged through here.

export { discoverCandidates, isClosed, signalsFromPlace } from "./discovery/places";
export type { DiscoveredCandidate } from "./discovery/types";
