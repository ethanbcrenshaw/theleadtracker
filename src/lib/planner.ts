// Weekly call planner — pure client-side math shared by the Today view, the
// briefing, and the assistant's planning tools.
//
// A schedule is a set of weekly slots ("Tuesday 13:00–15:00") in the user's
// home zone. Capacity = slot minutes / minutes-per-call. Each slot is matched
// against US timezones' answerability windows (see timezone.ts) so the plan
// dials businesses when they're most likely to pick up, East → West.

import type { Lead } from "./types";
import { ZONE_ORDER, ZONE_LABEL, type USZone, leadZone, answerabilityInRange } from "./timezone";
import { isValidContactDate } from "./crm-utils";

export interface CallSlot {
  /** 0 = Sunday … 6 = Saturday (JS getDay convention). */
  day: number;
  /** "13:00" 24h, user's local time. */
  start: string;
  /** "15:00" 24h. */
  end: string;
}

export interface CallSchedule {
  slots: CallSlot[];
  /** Minutes budgeted per dial incl. logging. Default 5. */
  minutesPerCall: number;
  /** ISO date (Monday) of the week this was confirmed for. */
  weekOf: string;
}

export const SCHEDULE_KEY = "call_schedule";
export const DEFAULT_MINUTES_PER_CALL = 5;

export const DAY_LABEL = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function mondayOf(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const shift = (x.getDay() + 6) % 7; // days since Monday
  x.setDate(x.getDate() - shift);
  return x.toISOString().slice(0, 10);
}

/** A schedule is stale when it wasn't confirmed for the current week. */
export function scheduleIsStale(s: CallSchedule | null, now = new Date()): boolean {
  if (!s || !s.slots.length) return true;
  return s.weekOf !== mondayOf(now);
}

function parseHM(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return NaN;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 1440 ? mins : NaN;
}

export function slotMinutes(s: CallSlot): number {
  const a = parseHM(s.start);
  const b = parseHM(s.end);
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  return b - a;
}

export function slotCapacity(s: CallSlot, minutesPerCall: number): number {
  return Math.max(0, Math.floor(slotMinutes(s) / Math.max(1, minutesPerCall)));
}

/** Concrete Date range for a slot within the week starting at `weekOf`. */
export function slotDates(s: CallSlot, weekOf: string): { start: Date; end: Date } {
  const monday = new Date(`${weekOf}T00:00:00`);
  const date = new Date(monday);
  // weekOf is a Monday; JS day 1 = Monday. Offset from Monday:
  const offset = (s.day + 6) % 7;
  date.setDate(monday.getDate() + offset);
  const start = new Date(date);
  start.setMinutes(parseHM(s.start) || 0);
  const end = new Date(date);
  end.setMinutes(parseHM(s.end) || 0);
  return { start, end };
}

export interface SlotPlan {
  slot: CallSlot;
  start: Date;
  end: Date;
  capacity: number;
  /** Zones ranked best-first for this slot (answerability, then East→West). */
  zones: Array<{ zone: USZone; label: string; answerability: number; stock: number }>;
  /** Callable stock across zones with answerability > 0. */
  callableStock: number;
  /** capacity − callableStock when positive — how many leads are missing. */
  shortfall: number;
}

export interface WeekPlan {
  weekOf: string;
  totalCapacity: number;
  slots: SlotPlan[];
  /** Zone → leads needed beyond current stock, summed over slots (greedy). */
  gaps: Array<{ zone: USZone; label: string; needed: number }>;
}

/** New-lead pool the planner draws from (mirrors the Today hot-fill gate). */
export function plannablePool(leads: Lead[]): Lead[] {
  const placesVouched = (l: Lead) =>
    (l.leadScore ?? 0) >= 70 &&
    l.verification?.business?.businessStatus === "OPERATIONAL" &&
    (l.verification?.business?.reviewCount ?? 0) >= 1;
  return leads.filter(
    (l) =>
      l.quality === "High" &&
      l.status === "Not Called" &&
      !isValidContactDate(l.lastContacted) &&
      !l.unverified &&
      ((l.verificationTier ?? "partial") === "verified" || placesVouched(l)),
  );
}

export function computeWeekPlan(leads: Lead[], schedule: CallSchedule): WeekPlan {
  const pool = plannablePool(leads);
  const stockByZone = new Map<USZone, number>();
  for (const z of ZONE_ORDER) stockByZone.set(z, 0);
  for (const l of pool) {
    const z = leadZone(l);
    stockByZone.set(z, (stockByZone.get(z) ?? 0) + 1);
  }

  // Greedy simulation: walk slots chronologically, draw stock from the best
  // zones first, record shortfalls per zone.
  const remaining = new Map(stockByZone);
  const gaps = new Map<USZone, number>();
  const slotPlans: SlotPlan[] = [];

  const ordered = [...schedule.slots].sort((a, b) => {
    const da = slotDates(a, schedule.weekOf).start.getTime();
    const db = slotDates(b, schedule.weekOf).start.getTime();
    return da - db;
  });

  for (const slot of ordered) {
    const { start, end } = slotDates(slot, schedule.weekOf);
    const capacity = slotCapacity(slot, schedule.minutesPerCall);
    const zones = ZONE_ORDER.map((zone) => ({
      zone,
      label: ZONE_LABEL[zone],
      answerability: answerabilityInRange(zone, start, end),
      stock: remaining.get(zone) ?? 0,
    }))
      .filter((z) => z.answerability > 0)
      .sort((a, b) => b.answerability - a.answerability);

    let need = capacity;
    for (const z of zones) {
      if (need <= 0) break;
      const take = Math.min(need, remaining.get(z.zone) ?? 0);
      remaining.set(z.zone, (remaining.get(z.zone) ?? 0) - take);
      need -= take;
    }
    const callableStock = zones.reduce((sum, z) => sum + z.stock, 0);
    const shortfall = Math.max(0, need);
    if (shortfall > 0 && zones.length) {
      // Attribute the gap to the best-answerability zone of the slot.
      const best = zones[0].zone;
      gaps.set(best, (gaps.get(best) ?? 0) + shortfall);
    }
    slotPlans.push({ slot, start, end, capacity, zones, callableStock, shortfall });
  }

  return {
    weekOf: schedule.weekOf,
    totalCapacity: slotPlans.reduce((s, p) => s + p.capacity, 0),
    slots: slotPlans,
    gaps: Array.from(gaps.entries()).map(([zone, needed]) => ({
      zone,
      label: ZONE_LABEL[zone],
      needed,
    })),
  };
}

/** Today's slots (if any) from a schedule, as concrete date ranges. */
export function todaysSlots(
  schedule: CallSchedule | null,
  now = new Date(),
): Array<{ slot: CallSlot; start: Date; end: Date; capacity: number }> {
  if (!schedule) return [];
  return schedule.slots
    .filter((s) => s.day === now.getDay())
    .map((s) => {
      const { start, end } = slotDates(s, mondayOf(now));
      return { slot: s, start, end, capacity: slotCapacity(s, schedule.minutesPerCall) };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Order the new-lead pool for a specific calling moment: answerability of the
 * lead's zone now (East→West on ties), then leadScore.
 */
export function orderForMoment(pool: Lead[], at: Date, rangeEnd?: Date): Lead[] {
  const zoneScore = new Map<USZone, number>();
  for (const z of ZONE_ORDER) {
    zoneScore.set(
      z,
      rangeEnd
        ? answerabilityInRange(z, at, rangeEnd)
        : answerabilityInRange(z, at, new Date(at.getTime() + 15 * 60000)),
    );
  }
  return [...pool].sort((a, b) => {
    const za = leadZone(a);
    const zb = leadZone(b);
    const sa = zoneScore.get(za) ?? 0;
    const sb = zoneScore.get(zb) ?? 0;
    if (sa !== sb) return sb - sa;
    const ea = ZONE_ORDER.indexOf(za);
    const eb = ZONE_ORDER.indexOf(zb);
    if (ea !== eb) return ea - eb; // East first on ties
    const la = a.leadScore ?? a.confidenceScore ?? -1;
    const lb = b.leadScore ?? b.confidenceScore ?? -1;
    if (la !== lb) return lb - la;
    return a.priority - b.priority;
  });
}
