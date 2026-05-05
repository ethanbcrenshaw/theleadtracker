import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Loader2, AlertCircle, Check, ExternalLink, Globe, Phone, MapPin } from "lucide-react";
import { useLeads } from "@/lib/store";
import type { Lead, LeadSource, WebsiteOpportunity } from "@/lib/types";

interface Props { open: boolean; onClose: () => void }

const ALLOWED_SOURCES: LeadSource[] = [
  "Yelp","Facebook","Google Business","Angie's List","MapQuest","Website","Instagram","Houzz","Directory","Other",
];
const ALLOWED_OPP: WebsiteOpportunity[] = [
  "No Dedicated Website","Facebook Only","Yelp/Directory Only","Outdated Website","Has Website","Social-Heavy",
];

type Candidate = {
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
  _id: string;
  _selected: boolean;
};

export function AIGenerateModal({ open, onClose }: Props) {
  const addLeads = useLeads((s) => s.addLeads);
  const existing = useLeads((s) => s.leads);
  const [industry, setIndustry] = useState("Upholstery");
  const [city, setCity] = useState("Nashville, TN");
  const [count, setCount] = useState(5);
  const [type, setType] = useState<WebsiteOpportunity>("No Dedicated Website");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  function reset() {
    setCandidates(null);
    setError(null);
    setStatus("");
    setLoading(false);
  }

  function close() { reset(); onClose(); }

  async function search() {
    setLoading(true);
    setError(null);
    setStatus("Searching the web & verifying each business…");
    try {
      const res = await fetch("/api/generate-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, city, count, type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      const seenNames = new Set(existing.map((l) => l.business.toLowerCase().trim()));
      const seenPhones = new Set(existing.map((l) => l.phone?.replace(/\D/g, "")).filter(Boolean));

      const raw: Candidate[] = (Array.isArray(data.leads) ? data.leads : [])
        .filter((r: Candidate) => {
          const key = (r.business || "").toLowerCase().trim();
          if (!key || seenNames.has(key)) return false;
          const ph = (r.phone || "").replace(/\D/g, "");
          if (ph && seenPhones.has(ph)) return false;
          return true;
        })
        .map((r: Candidate, i: number) => ({
          ...r,
          _id: `${i}-${r.business}`,
          _selected: r.matchesFilter, // pre-select exact matches
        }));

      if (!raw.length) {
        setError("No new leads found. Try a different city or lead type.");
        setLoading(false);
        return;
      }
      setCandidates(raw);
      setLoading(false);
      setStatus("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
      setStatus("");
    }
  }

  function toggle(id: string) {
    setCandidates((cs) => cs?.map((c) => (c._id === id ? { ...c, _selected: !c._selected } : c)) ?? null);
  }

  function importSelected() {
    if (!candidates) return;
    const picked = candidates.filter((c) => c._selected);
    if (!picked.length) return;
    const basePriority = (existing.reduce((m, l) => Math.max(m, l.priority), 0) || 0) + 1;

    const leads: Lead[] = picked.map((r, i) => {
      const sources = (r.sources || [])
        .filter((s) => (ALLOWED_SOURCES as string[]).includes(s)) as LeadSource[];
      const opp = (ALLOWED_OPP as string[]).includes(r.websiteOpportunity)
        ? (r.websiteOpportunity as WebsiteOpportunity)
        : type;
      return {
        id: crypto.randomUUID(),
        priority: basePriority + i,
        business: r.business,
        city: r.city,
        state: r.state,
        phone: r.phone,
        owner: r.owner || undefined,
        ownerSource: r.sourceUrl || undefined,
        onlinePresence: r.onlinePresence || "Discovered via web search",
        websiteOpportunity: opp,
        quality: "High",
        status: "Not Called",
        sources: sources.length ? sources : ["Other"],
        notes: r.sourceUrl ? `Discovered via: ${r.sourceUrl}` : "Discovered via web search.",
        tags: ["ai-found"],
        history: [],
      };
    });

    addLeads(leads);
    close();
  }

  const exactMatches = candidates?.filter((c) => c.matchesFilter) ?? [];
  const closeMatches = candidates?.filter((c) => !c.matchesFilter) ?? [];
  const selectedCount = candidates?.filter((c) => c._selected).length ?? 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 bg-foreground/30 backdrop-blur-sm z-40" onClick={close} />
          <motion.div
            initial={{opacity:0, y:20, scale:0.96}} animate={{opacity:1, y:0, scale:1}} exit={{opacity:0, y:20, scale:0.96}}
            className="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none"
          >
            <div className={`bg-card border border-border rounded-3xl shadow-elev w-full pointer-events-auto ${candidates ? "max-w-3xl" : "max-w-md"} max-h-[90vh] flex flex-col`}>
              <div className="flex items-center justify-between p-6 pb-4 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className="h-9 w-9 grid place-items-center rounded-full bg-gradient-to-br from-tan/40 to-gold/40">
                    <Sparkles className="h-4 w-4 text-tan-foreground" />
                  </span>
                  <h2 className="font-display text-xl">
                    {candidates ? "Review found leads" : "Generate Leads with AI"}
                  </h2>
                </div>
                <button onClick={close} className="p-1.5 rounded-lg hover:bg-secondary"><X className="h-4 w-4" /></button>
              </div>

              {!candidates ? (
                <div className="p-6 overflow-y-auto">
                  <p className="text-xs text-muted-foreground mb-4">
                    Searches the live web, then verifies each business's actual online presence before importing.
                  </p>
                  <div className="space-y-3">
                    <Field label="Industry"><input value={industry} onChange={(e) => setIndustry(e.target.value)} className="input" /></Field>
                    <Field label="City, State"><input value={city} onChange={(e) => setCity(e.target.value)} className="input" placeholder="Nashville, TN" /></Field>
                    <Field label="Number of leads">
                      <input type="number" min={1} max={15} value={count} onChange={(e) => setCount(+e.target.value)} className="input" />
                    </Field>
                    <Field label="Lead type">
                      <select value={type} onChange={(e) => setType(e.target.value as WebsiteOpportunity)} className="input">
                        <option>No Dedicated Website</option>
                        <option>Facebook Only</option>
                        <option>Yelp/Directory Only</option>
                        <option>Outdated Website</option>
                        <option>Social-Heavy</option>
                      </select>
                    </Field>
                  </div>
                  {error && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
                    </div>
                  )}
                  <button
                    onClick={search}
                    disabled={loading}
                    className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-navy-foreground font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {status || "Working…"}</> : <><Sparkles className="h-4 w-4" /> Find leads</>}
                  </button>
                </div>
              ) : (
                <>
                  <div className="p-6 pt-4 overflow-y-auto flex-1 space-y-6">
                    {exactMatches.length > 0 && (
                      <Section title={`Matches your filter (${exactMatches.length})`} subtitle={`These match "${type}".`}>
                        {exactMatches.map((c) => <CandidateRow key={c._id} c={c} onToggle={toggle} />)}
                      </Section>
                    )}
                    {closeMatches.length > 0 && (
                      <Section
                        title={`Close matches (${closeMatches.length})`}
                        subtitle={`Don't strictly match "${type}" but were found in your search. Review before adding.`}
                      >
                        {closeMatches.map((c) => <CandidateRow key={c._id} c={c} onToggle={toggle} />)}
                      </Section>
                    )}
                    {!exactMatches.length && !closeMatches.length && (
                      <p className="text-sm text-muted-foreground">No leads to review.</p>
                    )}
                  </div>
                  <div className="p-4 border-t border-border/50 flex items-center justify-between gap-3">
                    <button onClick={() => setCandidates(null)} className="text-xs text-muted-foreground hover:text-foreground">
                      ← Back to search
                    </button>
                    <button
                      onClick={importSelected}
                      disabled={!selectedCount}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-navy text-navy-foreground font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" /> Import {selectedCount} {selectedCount === 1 ? "lead" : "leads"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
          <style>{`.input{width:100%;padding:.55rem .75rem;border-radius:.75rem;background:var(--secondary);border:1px solid var(--border);font-size:.875rem}`}</style>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CandidateRow({ c, onToggle }: { c: Candidate; onToggle: (id: string) => void }) {
  return (
    <label
      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
        c._selected ? "border-navy/40 bg-navy/5" : "border-border hover:bg-secondary/40"
      }`}
    >
      <input
        type="checkbox"
        checked={c._selected}
        onChange={() => onToggle(c._id)}
        className="mt-1 h-4 w-4 rounded accent-navy"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium text-sm truncate">{c.business}</p>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{c.websiteOpportunity}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{c.onlinePresence}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-muted-foreground">
          {(c.city || c.state) && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}{c.state ? `, ${c.state}` : ""}</span>}
          {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
          {c.website && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{c.website}</span>}
          {c.sourceUrl && (
            <a href={c.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
               className="inline-flex items-center gap-1 hover:text-foreground">
              source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}