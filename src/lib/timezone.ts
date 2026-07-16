// Lead timezone resolution + call-answerability windows.
//
// Best source: the exact `utcOffsetMinutes` Google Places returns per business
// (stored on verification.business at discovery). Fallback: a city/state map —
// coarse but reliable for US small businesses, including split states like
// Tennessee (Knoxville/Chattanooga are Eastern; Nashville/Memphis Central).
//
// All window math is done in minutes-of-local-day, derived from either the
// stored offset or an IANA zone via Intl — no date libraries.

import type { Lead } from "./types";

export type USZone = "ET" | "CT" | "MT" | "PT" | "AKT" | "HAT";

export const ZONE_LABEL: Record<USZone, string> = {
  ET: "EASTERN",
  CT: "CENTRAL",
  MT: "MOUNTAIN",
  PT: "PACIFIC",
  AKT: "ALASKA",
  HAT: "HAWAII",
};

export const ZONE_IANA: Record<USZone, string> = {
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
  AKT: "America/Anchorage",
  HAT: "Pacific/Honolulu",
};

/** East → West calling order. */
export const ZONE_ORDER: USZone[] = ["ET", "CT", "MT", "PT", "AKT", "HAT"];

// Primary zone per state (split states get the zone covering most businesses;
// city overrides below handle the important exceptions).
const STATE_ZONE: Record<string, USZone> = {
  CT: "ET",
  DE: "ET",
  FL: "ET",
  GA: "ET",
  IN: "ET",
  KY: "ET",
  ME: "ET",
  MD: "ET",
  MA: "ET",
  MI: "ET",
  NH: "ET",
  NJ: "ET",
  NY: "ET",
  NC: "ET",
  OH: "ET",
  PA: "ET",
  RI: "ET",
  SC: "ET",
  VT: "ET",
  VA: "ET",
  WV: "ET",
  DC: "ET",
  AL: "CT",
  AR: "CT",
  IL: "CT",
  IA: "CT",
  KS: "CT",
  LA: "CT",
  MN: "CT",
  MS: "CT",
  MO: "CT",
  NE: "CT",
  ND: "CT",
  OK: "CT",
  SD: "CT",
  TN: "CT",
  TX: "CT",
  WI: "CT",
  AZ: "MT",
  CO: "MT",
  ID: "MT",
  MT: "MT",
  NM: "MT",
  UT: "MT",
  WY: "MT",
  CA: "PT",
  NV: "PT",
  OR: "PT",
  WA: "PT",
  AK: "AKT",
  HI: "HAT",
};

// City-level overrides for split states we actually work (east TN is Eastern).
const CITY_ZONE: Record<string, USZone> = {
  "knoxville|TN": "ET",
  "chattanooga|TN": "ET",
  "johnson city|TN": "ET",
  "kingsport|TN": "ET",
  "bristol|TN": "ET",
  "cleveland|TN": "ET",
  "maryville|TN": "ET",
  "morristown|TN": "ET",
  "oak ridge|TN": "ET",
  "sevierville|TN": "ET",
  "corryton|TN": "ET",
  "el paso|TX": "MT",
  "pensacola|FL": "CT",
  "panama city|FL": "CT",
  "tallahassee|FL": "ET",
  "evansville|IN": "CT",
  "gary|IN": "CT",
};

// Standard-time UTC offsets per zone (minutes). Used to map a Places
// utcOffsetMinutes (which reflects DST at fetch time) back to a zone.
const ZONE_STD_OFFSET: Record<USZone, number> = {
  ET: -300,
  CT: -360,
  MT: -420,
  PT: -480,
  AKT: -540,
  HAT: -600,
};

function zoneFromOffset(utcOffsetMinutes: number): USZone | null {
  for (const z of ZONE_ORDER) {
    const std = ZONE_STD_OFFSET[z];
    // Accept standard or DST (+60) variants. Hawaii/most-of-Arizona don't
    // observe DST, but the exact match still lands.
    if (utcOffsetMinutes === std || utcOffsetMinutes === std + 60) return z;
  }
  return null;
}

/** Resolve a lead's US timezone: Places offset first, then city/state map. */
export function leadZone(lead: Pick<Lead, "city" | "state" | "verification">): USZone {
  const off = lead.verification?.business?.utcOffsetMinutes;
  if (typeof off === "number") {
    const z = zoneFromOffset(off);
    if (z) return z;
  }
  const cityKey = `${(lead.city || "").toLowerCase().trim()}|${(lead.state || "").toUpperCase().trim()}`;
  if (CITY_ZONE[cityKey]) return CITY_ZONE[cityKey];
  return STATE_ZONE[(lead.state || "").toUpperCase().trim()] ?? "ET";
}

/** Minutes past local midnight in `zone` at instant `at`. */
export function localMinutes(zone: USZone, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE_IANA[zone],
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

// Golden calling windows for local businesses (minutes past local midnight):
// mid-morning after opening rush, and early afternoon after lunch.
const WINDOWS: Array<{ from: number; to: number; score: number }> = [
  { from: 9 * 60, to: 11 * 60 + 30, score: 3 }, // 9:00–11:30 — best
  { from: 13 * 60 + 30, to: 16 * 60 + 30, score: 2 }, // 1:30–4:30 — good
  { from: 11 * 60 + 30, to: 12 * 60, score: 1 }, // 11:30–12:00 — okay
  { from: 16 * 60 + 30, to: 17 * 60, score: 1 }, // 4:30–5:00 — okay
];

/**
 * 0–3 answerability for calling `zone` at instant `at`.
 * 0 = outside business likelihood (closed, lunch, early/late).
 */
export function answerability(zone: USZone, at: Date): number {
  const lm = localMinutes(zone, at);
  for (const w of WINDOWS) {
    if (lm >= w.from && lm < w.to) return w.score;
  }
  return 0;
}

/** Best answerability a zone reaches anywhere inside [start, end). */
export function answerabilityInRange(zone: USZone, start: Date, end: Date): number {
  let best = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    best = Math.max(best, answerability(zone, cursor));
    if (best === 3) break;
    cursor.setMinutes(cursor.getMinutes() + 15);
  }
  return best;
}
