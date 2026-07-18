// Merge + dedupe engine for multi-source discovery.
//
// Canonical identity: normalized 10-digit US phone. Fallback: fuzzy business
// name (lowercased, punctuation/legal-suffix stripped) + city. On merge the
// richest record wins as the base, Places data is preferred for address
// fields/signals, and sources/foundVia are unioned. Also filters candidates
// against ALL saved leads (including soft-deleted ones, so scrapped leads
// don't resurrect on the next generate).

import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { DiscoveredCandidate } from "./types";

/**
 * Canonical dedupe key for a phone: E.164 when it validates as a US number,
 * else the last 10 digits (so typo'd duplicates still merge), else null.
 */
export function phoneKeyOf(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const p = parsePhoneNumberFromString(s, "US");
  if (p?.isValid()) return p.number;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Validate + normalize a candidate's phone in place. Valid numbers get the
 * national display format (matches Places' style); invalid non-empty ones
 * are kept but flagged phoneInvalid — registries have typos the user can fix
 * by eye, so we surface rather than drop.
 */
export function normalizeCandidatePhone(c: DiscoveredCandidate): void {
  const raw = (c.phone || "").trim();
  if (!raw) return;
  const p = parsePhoneNumberFromString(raw, "US");
  if (p?.isValid()) {
    c.phone = p.formatNational();
    c.phoneInvalid = undefined;
  } else {
    c.phoneInvalid = true;
  }
}

const LEGAL_SUFFIX =
  /\b(llc|inc|incorporated|co|corp|corporation|company|ltd|llp|pllc|pc|enterprises?|group|services?)\b/g;

/** Lowercase, strip punctuation and legal suffixes; "" when nothing is left. */
export function nameKeyOf(name: string | null | undefined): string {
  return (name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(LEGAL_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameCityKeyOf(c: { business: string; city: string }): string | null {
  const n = nameKeyOf(c.business);
  if (n.length < 3) return null;
  return `${n}|${(c.city || "").toLowerCase().trim()}`;
}

function richness(c: DiscoveredCandidate): number {
  let n = 0;
  if (c.phone) n++;
  if (c.website) n++;
  if (c.sourceUrl) n++;
  if (c.city) n++;
  if (c.state) n++;
  if (c.registeredAt) n++;
  if (c.placesSignals && Object.values(c.placesSignals).some((v) => v !== undefined)) n += 2;
  return n;
}

function isFromPlaces(c: DiscoveredCandidate): boolean {
  return c.foundVia.includes("places");
}

/** Merge two records for the same business. */
function mergeTwo(a: DiscoveredCandidate, b: DiscoveredCandidate): DiscoveredCandidate {
  const [rich, poor] = richness(a) >= richness(b) ? [a, b] : [b, a];
  const places = isFromPlaces(a) ? a : isFromPlaces(b) ? b : null;

  // Prefer a valid phone over an invalid one regardless of richness.
  const richPhoneOk = Boolean(rich.phone) && !rich.phoneInvalid;
  const poorPhoneOk = Boolean(poor.phone) && !poor.phoneInvalid;
  const phonePick = richPhoneOk ? rich : poorPhoneOk ? poor : rich.phone ? rich : poor;

  const merged: DiscoveredCandidate = {
    ...rich,
    phone: phonePick.phone,
    phoneInvalid: phonePick.phoneInvalid,
    owner: rich.owner || poor.owner,
    website: rich.website || poor.website,
    sourceUrl: rich.sourceUrl || poor.sourceUrl,
    onlinePresence: rich.onlinePresence || poor.onlinePresence,
    sources: Array.from(new Set([...rich.sources, ...poor.sources])),
    foundVia: Array.from(new Set([...rich.foundVia, ...poor.foundVia])),
    matchesFilter: rich.matchesFilter || poor.matchesFilter,
    registeredAt: rich.registeredAt || poor.registeredAt,
  };

  // Places is authoritative for address fields + business signals.
  if (places) {
    merged.city = places.city || merged.city;
    merged.state = places.state || merged.state;
    merged.placesSignals = places.placesSignals;
    // A record corroborated by Places is, by definition, on Google.
    merged.offGoogle = false;
  } else {
    merged.offGoogle = a.offGoogle || b.offGoogle;
  }
  return merged;
}

/**
 * Merge candidate lists from multiple sources into unique businesses.
 * Pass lists in source-priority order (Places first) — first-seen wins ties.
 */
export function mergeCandidates(lists: DiscoveredCandidate[][]): DiscoveredCandidate[] {
  const byKey = new Map<string, DiscoveredCandidate>();
  const order: string[] = []; // stable output order
  // Secondary index so a phone-keyed record can still be found by name.
  const aliasKey = new Map<string, string>();

  for (const list of lists) {
    for (const cand of list) {
      normalizeCandidatePhone(cand);
      const pk = phoneKeyOf(cand.phone);
      const nk = nameCityKeyOf(cand);
      const primary = pk ?? nk;
      if (!primary) continue; // nothing to identify it by

      const hit =
        (pk && (byKey.has(pk) ? pk : aliasKey.get(pk))) ||
        (nk && (byKey.has(nk) ? nk : aliasKey.get(nk))) ||
        null;

      if (hit && byKey.has(hit)) {
        byKey.set(hit, mergeTwo(byKey.get(hit)!, cand));
      } else {
        byKey.set(primary, cand);
        order.push(primary);
      }
      // Register both identities against whichever key holds the record.
      const holder = hit && byKey.has(hit) ? hit : primary;
      if (pk) aliasKey.set(pk, holder);
      if (nk) aliasKey.set(nk, holder);
    }
  }
  return order.map((k) => byKey.get(k)!).filter(Boolean);
}

/**
 * Drop candidates that match an already-saved lead (by phone, else name+city).
 * Queries ALL rows — soft-deleted included — so deliberately scrapped leads
 * stay gone. Fails open: on DB error, returns candidates unfiltered.
 */
export async function filterAgainstSavedLeads(
  candidates: DiscoveredCandidate[],
): Promise<{ fresh: DiscoveredCandidate[]; droppedExisting: number }> {
  if (!candidates.length) return { fresh: [], droppedExisting: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("leads").select("business,city,phone");
    if (error) throw error;
    const savedPhones = new Set<string>();
    const savedNames = new Set<string>();
    for (const row of (data ?? []) as Array<{ business: string; city: string; phone: string }>) {
      const pk = phoneKeyOf(row.phone);
      if (pk) savedPhones.add(pk);
      const nk = nameCityKeyOf(row);
      if (nk) savedNames.add(nk);
    }
    const fresh = candidates.filter((c) => {
      const pk = phoneKeyOf(c.phone);
      if (pk && savedPhones.has(pk)) return false;
      const nk = nameCityKeyOf(c);
      if (nk && savedNames.has(nk)) return false;
      return true;
    });
    return { fresh, droppedExisting: candidates.length - fresh.length };
  } catch (err) {
    console.error("[discovery] saved-lead dedupe failed (continuing unfiltered):", err);
    return { fresh: candidates, droppedExisting: 0 };
  }
}
