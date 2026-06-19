import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CallRecord, Lead, LeadStatus, Quality } from "./types";
import { seedLeads } from "@/data/seed";
import { qualityFromOpportunity } from "./crm-utils";

function cleanDate(iso?: string): string | undefined {
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

interface LeadStore {
  leads: Lead[];
  hydrate: () => void;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  addNote: (id: string, note: string) => void;
  setStatus: (id: string, status: LeadStatus, note?: string) => void;
  bulkSetStatus: (ids: string[], status: LeadStatus) => void;
  bulkDelete: (ids: string[]) => void;
  addLead: (lead: Lead) => void;
  addLeads: (leads: Lead[]) => void;
  addCallRecord: (id: string, record: CallRecord) => void;
}

export const useLeads = create<LeadStore>()(
  persist(
    (set) => ({
      leads: seedLeads,
      hydrate: () => {},
      updateLead: (id, patch) =>
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== id) return l;
            const merged = { ...l, ...patch };
            // Quality is always derived from websiteOpportunity — never set by hand.
            merged.quality = qualityFromOpportunity(merged.websiteOpportunity);
            return merged;
          }),
        })),
      addNote: (id, note) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id
              ? { ...l, notes: l.notes ? `${l.notes}\n\n${note}` : note }
              : l
          ),
        })),
      setStatus: (id, status, note) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  status,
                  lastContacted: new Date().toISOString(),
                  history: [
                    ...l.history,
                    {
                      id: crypto.randomUUID(),
                      date: new Date().toISOString(),
                      status,
                      note,
                    },
                  ],
                }
              : l
          ),
        })),
      bulkSetStatus: (ids, status) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            ids.includes(l.id)
              ? {
                  ...l,
                  status,
                  lastContacted: new Date().toISOString(),
                  history: [
                    ...l.history,
                    { id: crypto.randomUUID(), date: new Date().toISOString(), status },
                  ],
                }
              : l
          ),
        })),
      bulkDelete: (ids) =>
        set((s) => ({ leads: s.leads.filter((l) => !ids.includes(l.id)) })),
      addLead: (lead) => set((s) => ({ leads: [sanitizeLead(lead), ...s.leads] })),
      addLeads: (leads) => set((s) => ({ leads: [...leads.map(sanitizeLead), ...s.leads] })),
      addCallRecord: (id, record) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id
              ? { ...l, callRecords: [...(l.callRecords ?? []), record] }
              : l
          ),
        })),
    }),
    {
      name: "lead-mgmt-v1",
      onRehydrateStorage: () => (state) => {
        if (state) state.leads = state.leads.map(sanitizeLead);
      },
    }
  )
);
