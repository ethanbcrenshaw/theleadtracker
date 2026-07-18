import { create } from "zustand";
import type {
  CallRecord,
  CallScript,
  Lead,
  LeadEnrichment,
  LeadStatus,
  LeadVerification,
  VerificationTier,
} from "./types";
import { seedLeads } from "@/data/seed";
import { qualityFromOpportunity } from "./crm-utils";
import { supabase } from "@/integrations/supabase/client";

const LOCAL_KEY = "lead-mgmt-v1";
const TABLE = "leads";

function cleanDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return undefined;
  return iso;
}

function sanitizeLead(l: Lead): Lead {
  return {
    ...l,
    lastContacted: cleanDate(l.lastContacted),
    nextFollowUp: cleanDate(l.nextFollowUp),
    quality: qualityFromOpportunity(l.websiteOpportunity),
  };
}

// ── Row <-> Lead mapping ────────────────────────────────────────────────────
// DB column names mirror the Lead field names exactly (quoted camelCase),
// so mapping is mostly pass-through plus a nullable→undefined fix-up.

type LeadRow = {
  id: string;
  priority: number;
  business: string;
  owner: string | null;
  ownerSource: string | null;
  city: string;
  state: string;
  phone: string;
  onlinePresence: string;
  websiteOpportunity: Lead["websiteOpportunity"];
  quality: Lead["quality"];
  status: LeadStatus;
  sources: Lead["sources"];
  lastContacted: string | null;
  nextFollowUp: string | null;
  notes: string;
  tags: string[];
  ownerNote: string | null;
  history: Lead["history"];
  callRecords: CallRecord[] | null;
  aiSummary: string | null;
  aiNextAction: string | null;
  zoomBooked: boolean | null;
  zoomDate: string | null;
  confidenceScore: number | null;
  confidenceEvidence: string[] | null;
  unverified: boolean | null;
  unverifiedReason: string | null;
  enrichment: LeadEnrichment | null;
  callScript: CallScript | null;
  verificationTier: VerificationTier | null;
  verificationReasons: string[] | null;
  leadScore: number | null;
  verification: LeadVerification | null;
  foundVia: string[] | null;
  created_at?: string;
};

function rowToLead(r: LeadRow): Lead {
  const l: Lead = {
    id: r.id,
    priority: r.priority,
    business: r.business,
    city: r.city,
    state: r.state,
    phone: r.phone,
    onlinePresence: r.onlinePresence,
    websiteOpportunity: r.websiteOpportunity,
    quality: r.quality,
    status: r.status,
    sources: r.sources ?? [],
    notes: r.notes ?? "",
    tags: r.tags ?? [],
    history: r.history ?? [],
  };
  if (r.owner != null) l.owner = r.owner;
  if (r.ownerSource != null) l.ownerSource = r.ownerSource;
  if (r.lastContacted != null) l.lastContacted = r.lastContacted;
  if (r.nextFollowUp != null) l.nextFollowUp = r.nextFollowUp;
  if (r.ownerNote != null) l.ownerNote = r.ownerNote;
  if (r.callRecords != null) l.callRecords = r.callRecords;
  if (r.aiSummary != null) l.aiSummary = r.aiSummary;
  if (r.aiNextAction != null) l.aiNextAction = r.aiNextAction;
  if (r.zoomBooked != null) l.zoomBooked = r.zoomBooked;
  if (r.zoomDate != null) l.zoomDate = r.zoomDate;
  if (r.confidenceScore != null) l.confidenceScore = r.confidenceScore;
  if (r.confidenceEvidence != null) l.confidenceEvidence = r.confidenceEvidence;
  if (r.unverified != null) l.unverified = r.unverified;
  if (r.unverifiedReason != null) l.unverifiedReason = r.unverifiedReason;
  if (r.enrichment != null) l.enrichment = r.enrichment;
  if (r.callScript != null) l.callScript = r.callScript;
  if (r.verificationTier != null) l.verificationTier = r.verificationTier;
  if (r.verificationReasons != null) l.verificationReasons = r.verificationReasons;
  if (r.leadScore != null) l.leadScore = r.leadScore;
  if (r.verification != null) l.verification = r.verification;
  if (r.foundVia != null) l.foundVia = r.foundVia;
  return sanitizeLead(l);
}

function leadToRow(l: Lead): LeadRow {
  return {
    id: l.id,
    priority: l.priority ?? 0,
    business: l.business ?? "",
    owner: l.owner ?? null,
    ownerSource: l.ownerSource ?? null,
    city: l.city ?? "",
    state: l.state ?? "",
    phone: l.phone ?? "",
    onlinePresence: l.onlinePresence ?? "",
    websiteOpportunity: l.websiteOpportunity,
    quality: l.quality,
    status: l.status,
    sources: l.sources ?? [],
    lastContacted: l.lastContacted ?? null,
    nextFollowUp: l.nextFollowUp ?? null,
    notes: l.notes ?? "",
    tags: l.tags ?? [],
    ownerNote: l.ownerNote ?? null,
    history: l.history ?? [],
    callRecords: l.callRecords ?? null,
    aiSummary: l.aiSummary ?? null,
    aiNextAction: l.aiNextAction ?? null,
    zoomBooked: l.zoomBooked ?? null,
    zoomDate: l.zoomDate ?? null,
    confidenceScore: l.confidenceScore ?? null,
    confidenceEvidence: l.confidenceEvidence ?? null,
    unverified: l.unverified ?? null,
    unverifiedReason: l.unverifiedReason ?? null,
    enrichment: l.enrichment ?? null,
    callScript: l.callScript ?? null,
    verificationTier: l.verificationTier ?? null,
    verificationReasons: l.verificationReasons ?? null,
    leadScore: l.leadScore ?? null,
    verification: l.verification ?? null,
    foundVia: l.foundVia ?? null,
  };
}

// ── DB helpers (fire-and-forget; errors log but never throw to UI) ───────────
function logErr(scope: string, err: unknown) {
  if (err) console.error(`[leads] ${scope}:`, err);
}

// Supabase's generated `Database` type doesn't yet know about `leads`, so the
// table is referenced through a loosely-typed alias. Schema is enforced by the
// row mappers above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from(TABLE);

// The DB may not have the newest optional columns yet (migrations are applied
// by hand). If a write bounces off a missing column, retry once without it so
// a pending migration never blocks saving leads.
function isMissingColumnError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.code === "42703" ||
    e.code === "PGRST204" ||
    /column .* does not exist|foundVia/i.test(e.message ?? "")
  );
}

const OPTIONAL_COLUMNS = ["foundVia"] as const;

function stripOptionalColumns(rows: LeadRow[]): Omit<LeadRow, "foundVia">[] {
  return rows.map((r) => {
    const copy: Record<string, unknown> = { ...r };
    for (const c of OPTIONAL_COLUMNS) delete copy[c];
    return copy as Omit<LeadRow, "foundVia">;
  });
}

async function dbInsertMany(leads: Lead[]) {
  if (!leads.length) return;
  const rows = leads.map(leadToRow);
  const { error } = await db().insert(rows);
  if (error && isMissingColumnError(error)) {
    logErr("insert (retrying without optional columns — run the foundVia migration)", error);
    const { error: retryErr } = await db().insert(stripOptionalColumns(rows));
    logErr("insert-retry", retryErr);
    return;
  }
  logErr("insert", error);
}

async function dbUpsertMany(leads: Lead[]) {
  if (!leads.length) return;
  const rows = leads.map(leadToRow);
  const { error } = await db().upsert(rows);
  if (error && isMissingColumnError(error)) {
    logErr("upsert (retrying without optional columns — run the foundVia migration)", error);
    const { error: retryErr } = await db().upsert(stripOptionalColumns(rows));
    logErr("upsert-retry", retryErr);
    return;
  }
  logErr("upsert", error);
}

async function dbUpdateOne(id: string, patch: Partial<Lead>) {
  const rowPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    rowPatch[k] = v === undefined ? null : v;
  }
  const { error } = await db().update(rowPatch).eq("id", id);
  logErr("update", error);
}

async function dbDeleteMany(ids: string[]) {
  if (!ids.length) return;
  const { error } = await db().delete().in("id", ids);
  logErr("delete", error);
}

function readLocalLeads(): Lead[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { leads?: Lead[] }; leads?: Lead[] };
    const leads = parsed?.state?.leads ?? parsed?.leads;
    if (!Array.isArray(leads) || leads.length === 0) return null;
    return leads.map(sanitizeLead);
  } catch {
    return null;
  }
}

interface LeadStore {
  leads: Lead[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  addNote: (id: string, note: string) => void;
  setStatus: (id: string, status: LeadStatus, note?: string) => void;
  bulkSetStatus: (ids: string[], status: LeadStatus) => void;
  bulkDelete: (ids: string[]) => void;
  addLead: (lead: Lead) => void;
  addLeads: (leads: Lead[]) => void;
  addCallRecord: (id: string, record: CallRecord) => void;
}

let hydratePromise: Promise<void> | null = null;

export const useLeads = create<LeadStore>()((set) => ({
  leads: [],
  hydrated: false,

  hydrate: () => {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      try {
        const { data, error } = await db()
          .select("*")
          .is("deleted_at", null)
          .order("priority", { ascending: true });
        if (error) throw error;
        const rows = (data ?? []) as LeadRow[];

        if (rows.length === 0) {
          // Empty DB on first run. Migrate from localStorage if present,
          // otherwise fall back to the bundled seed so the app isn't empty.
          const local = readLocalLeads();
          const initial = local ?? seedLeads.map(sanitizeLead);
          set({ leads: initial, hydrated: true });
          await dbUpsertMany(initial);
          if (local && typeof window !== "undefined") {
            try {
              window.localStorage.removeItem(LOCAL_KEY);
            } catch {
              /* ignore */
            }
          }
          return;
        }

        set({ leads: rows.map(rowToLead), hydrated: true });
      } catch (err) {
        console.error("[leads] hydrate failed, using local fallback:", err);
        const local = readLocalLeads();
        set({ leads: local ?? seedLeads.map(sanitizeLead), hydrated: true });
      }
    })();
    return hydratePromise;
  },

  refresh: async () => {
    try {
      const { data, error } = await db()
        .select("*")
        .is("deleted_at", null)
        .order("priority", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as LeadRow[];
      set({ leads: rows.map(rowToLead), hydrated: true });
    } catch (err) {
      console.error("[leads] refresh failed:", err);
    }
  },

  updateLead: (id, patch) => {
    let dbPatch: Partial<Lead> = patch;
    set((s) => ({
      leads: s.leads.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...patch };
        merged.quality = qualityFromOpportunity(merged.websiteOpportunity);
        if (patch.websiteOpportunity !== undefined && patch.quality === undefined) {
          dbPatch = { ...patch, quality: merged.quality };
        }
        return merged;
      }),
    }));
    void dbUpdateOne(id, dbPatch);
  },

  addNote: (id, note) => {
    let nextNotes = "";
    set((s) => ({
      leads: s.leads.map((l) => {
        if (l.id !== id) return l;
        nextNotes = l.notes ? `${l.notes}\n\n${note}` : note;
        return { ...l, notes: nextNotes };
      }),
    }));
    void dbUpdateOne(id, { notes: nextNotes });
  },

  setStatus: (id, status, note) => {
    const now = new Date().toISOString();
    let nextHistory: Lead["history"] = [];
    set((s) => ({
      leads: s.leads.map((l) => {
        if (l.id !== id) return l;
        nextHistory = [...l.history, { id: crypto.randomUUID(), date: now, status, note }];
        return { ...l, status, lastContacted: now, history: nextHistory };
      }),
    }));
    void dbUpdateOne(id, { status, lastContacted: now, history: nextHistory });
  },

  bulkSetStatus: (ids, status) => {
    const now = new Date().toISOString();
    const idSet = new Set(ids);
    const updated: Lead[] = [];
    set((s) => ({
      leads: s.leads.map((l) => {
        if (!idSet.has(l.id)) return l;
        const next: Lead = {
          ...l,
          status,
          lastContacted: now,
          history: [...l.history, { id: crypto.randomUUID(), date: now, status }],
        };
        updated.push(next);
        return next;
      }),
    }));
    void dbUpsertMany(updated);
  },

  bulkDelete: (ids) => {
    set((s) => ({ leads: s.leads.filter((l) => !ids.includes(l.id)) }));
    void dbDeleteMany(ids);
  },

  addLead: (lead) => {
    const clean = sanitizeLead(lead);
    set((s) => ({ leads: [clean, ...s.leads] }));
    void dbInsertMany([clean]);
  },

  addLeads: (leads) => {
    const clean = leads.map(sanitizeLead);
    set((s) => ({ leads: [...clean, ...s.leads] }));
    void dbInsertMany(clean);
  },

  addCallRecord: (id, record) => {
    let nextRecords: CallRecord[] = [];
    set((s) => ({
      leads: s.leads.map((l) => {
        if (l.id !== id) return l;
        nextRecords = [...(l.callRecords ?? []), record];
        return { ...l, callRecords: nextRecords };
      }),
    }));
    void dbUpdateOne(id, { callRecords: nextRecords });
  },
}));

// Auto-hydrate on the client as soon as the store module loads.
if (typeof window !== "undefined") {
  void useLeads.getState().hydrate();
}
