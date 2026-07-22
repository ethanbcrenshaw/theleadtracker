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

/** A zone's actual UTC offset (minutes) right now, DST included, via Intl. */
function zoneCurrentOffset(zone: USZone, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE_IANA[zone],
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/**
 * Map a Places utcOffsetMinutes back to a US zone. The offset alone is
 * ambiguous across DST (MDT −360 == CST, PDT −420 == MST), so a static
 * standard-time table misclassifies every western lead by one zone all
 * summer. Instead we match against each zone's ACTUAL current offset — which
 * is distinct per zone in any given season. Cross-season data falls back to
 * a ±60 match (best-effort), then the caller's city/state map.
 */
function zoneFromOffset(utcOffsetMinutes: number, now = new Date()): USZone | null {
  for (const z of ZONE_ORDER) {
    if (zoneCurrentOffset(z, now) === utcOffsetMinutes) return z;
  }
  for (const z of ZONE_ORDER) {
    const o = zoneCurrentOffset(z, now);
    if (utcOffsetMinutes === o + 60 || utcOffsetMinutes === o - 60) return z;
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
