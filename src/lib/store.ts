import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CallRecord, Lead, LeadStatus, Quality } from "./types";
import { seedLeads } from "@/data/seed";

interface LeadStore {
  leads: Lead[];
  hydrate: () => void;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  addNote: (id: string, note: string) => void;
  setStatus: (id: string, status: LeadStatus, note?: string) => void;
  bulkSetStatus: (ids: string[], status: LeadStatus) => void;
  bulkSetQuality: (ids: string[], quality: Quality) => void;
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
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
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
      bulkSetQuality: (ids, quality) =>
        set((s) => ({
          leads: s.leads.map((l) => (ids.includes(l.id) ? { ...l, quality } : l)),
        })),
      bulkDelete: (ids) =>
        set((s) => ({ leads: s.leads.filter((l) => !ids.includes(l.id)) })),
      addLead: (lead) => set((s) => ({ leads: [lead, ...s.leads] })),
      addLeads: (leads) => set((s) => ({ leads: [...leads, ...s.leads] })),
      addCallRecord: (id, record) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id
              ? { ...l, callRecords: [...(l.callRecords ?? []), record] }
              : l
          ),
        })),
    }),
    { name: "lead-mgmt-v1" }
  )
);
