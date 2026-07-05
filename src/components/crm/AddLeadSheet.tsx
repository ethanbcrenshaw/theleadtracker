import { useEffect, useState } from "react";
import type { Lead, LeadSource, LeadStatus, WebsiteOpportunity } from "@/lib/types";
import { useLeads } from "@/lib/store";
import { qualityFromOpportunity, STATUSES, OPPORTUNITIES, SOURCES } from "@/lib/crm-utils";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode?: "add" | "edit";
  lead?: Lead;
}

type Draft = {
  business: string;
  city: string;
  state: string;
  phone: string;
  onlinePresence: string;
  websiteOpportunity: WebsiteOpportunity;
  status: LeadStatus;
  source: LeadSource;
  notes: string;
  nextFollowUp: string; // yyyy-mm-dd
};

function draftFromLead(lead?: Lead): Draft {
  return {
    business: lead?.business ?? "",
    city: lead?.city ?? "",
    state: lead?.state ?? "",
    phone: lead?.phone ?? "",
    onlinePresence: lead?.onlinePresence ?? "",
    websiteOpportunity: lead?.websiteOpportunity ?? "No Dedicated Website",
    status: lead?.status ?? "Not Called",
    source: (lead?.sources?.[0] as LeadSource) ?? "Other",
    notes: lead?.notes ?? "",
    nextFollowUp: lead?.nextFollowUp ? lead.nextFollowUp.slice(0, 10) : "",
  };
}

export function AddLeadSheet({ open, onOpenChange, mode = "add", lead }: Props) {
  const addLead = useLeads((s) => s.addLead);
  const updateLead = useLeads((s) => s.updateLead);
  const leads = useLeads((s) => s.leads);
  const [d, setD] = useState<Draft>(() => draftFromLead(lead));

  useEffect(() => {
    if (open) setD(draftFromLead(lead));
  }, [open, lead]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const canSave = d.business.trim().length > 0;

  function save() {
    if (!canSave) return;
    const iso = d.nextFollowUp ? new Date(`${d.nextFollowUp}T12:00:00`).toISOString() : undefined;
    const q = qualityFromOpportunity(d.websiteOpportunity);
    if (mode === "edit" && lead) {
      updateLead(lead.id, {
        business: d.business.trim(),
        city: d.city.trim(),
        state: d.state.trim(),
        phone: d.phone.trim(),
        onlinePresence: d.onlinePresence.trim(),
        websiteOpportunity: d.websiteOpportunity,
        quality: q,
        status: d.status,
        sources: [d.source],
        notes: d.notes,
        nextFollowUp: iso,
      });
    } else {
      const basePriority = (leads.reduce((m, l) => Math.max(m, l.priority), 0) || 0) + 1;
      const newLead: Lead = {
        id: crypto.randomUUID(),
        priority: basePriority,
        business: d.business.trim(),
        city: d.city.trim(),
        state: d.state.trim(),
        phone: d.phone.trim(),
        onlinePresence: d.onlinePresence.trim() || "Added manually",
        websiteOpportunity: d.websiteOpportunity,
        quality: q,
        status: d.status,
        sources: [d.source],
        notes: d.notes,
        tags: [],
        history: [],
        nextFollowUp: iso,
      };
      addLead(newLead);
    }
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg border-l border-foreground bg-background p-0 overflow-y-auto"
      >
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <SheetHeader className="text-left">
            <span className="mono text-muted-foreground block">
              — {mode === "edit" ? "Edit Lead" : "Add Lead"}
            </span>
            <SheetTitle className="font-display text-3xl font-normal mt-1 lowercase">
              {mode === "edit" ? "edit entry" : "new entry"}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Enter or update lead information.
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="p-6 space-y-5">
          <Field label="Business">
            <TextInput value={d.business} onChange={(v) => set("business", v)} placeholder="Business name" autoFocus />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" className="col-span-2">
              <TextInput value={d.city} onChange={(v) => set("city", v)} />
            </Field>
            <Field label="State">
              <TextInput value={d.state} onChange={(v) => set("state", v)} placeholder="TN" />
            </Field>
          </div>
          <Field label="Phone">
            <TextInput value={d.phone} onChange={(v) => set("phone", v)} placeholder="(555) 555-1234" />
          </Field>
          <Field label="Website / Online Presence">
            <TextInput
              value={d.onlinePresence}
              onChange={(v) => set("onlinePresence", v)}
              placeholder="e.g. Facebook page only"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opportunity">
              <SelectInput
                value={d.websiteOpportunity}
                onChange={(v) => set("websiteOpportunity", v as WebsiteOpportunity)}
                options={OPPORTUNITIES as unknown as string[]}
              />
            </Field>
            <Field label="Status">
              <SelectInput
                value={d.status}
                onChange={(v) => set("status", v as LeadStatus)}
                options={STATUSES as unknown as string[]}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <SelectInput
                value={d.source}
                onChange={(v) => set("source", v as LeadSource)}
                options={SOURCES as unknown as string[]}
              />
            </Field>
            <Field label="Next Follow-up">
              <input
                type="date"
                value={d.nextFollowUp}
                onChange={(e) => set("nextFollowUp", e.target.value)}
                className="w-full px-3 py-2 border border-border bg-transparent text-sm focus:outline-none focus:border-foreground"
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={d.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-border bg-transparent text-sm resize-none focus:outline-none focus:border-foreground"
            />
          </Field>

          <div className="mono text-muted-foreground">
            Quality auto-derives from opportunity — currently{" "}
            <span className="text-foreground">{qualityFromOpportunity(d.websiteOpportunity)}</span>.
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button onClick={() => onOpenChange(false)} className="mono px-4 py-2 border border-border hover:border-foreground">
              [ CANCEL ]
            </button>
            <button
              onClick={save}
              disabled={!canSave}
              className="mono px-5 py-2 bg-foreground text-background hover:opacity-90 disabled:opacity-40"
            >
              [ {mode === "edit" ? "SAVE" : "ADD"} ]
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mono text-muted-foreground">— {label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function TextInput({
  value, onChange, placeholder, autoFocus,
}: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="w-full px-3 py-2 border border-border bg-transparent text-sm focus:outline-none focus:border-foreground"
    />
  );
}

function SelectInput({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-border bg-transparent text-sm focus:outline-none focus:border-foreground"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}