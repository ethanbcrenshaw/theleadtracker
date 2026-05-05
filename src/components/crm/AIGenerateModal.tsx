import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Loader2, AlertCircle } from "lucide-react";
import { useLeads } from "@/lib/store";
import type { Lead, LeadSource, WebsiteOpportunity } from "@/lib/types";

interface Props { open: boolean; onClose: () => void }

const ALLOWED_SOURCES: LeadSource[] = [
  "Yelp","Facebook","Google Business","Angie's List","MapQuest","Website","Instagram","Houzz","Directory","Other",
];
const ALLOWED_OPP: WebsiteOpportunity[] = [
  "No Dedicated Website","Facebook Only","Yelp/Directory Only","Outdated Website","Has Website","Social-Heavy",
];

export function AIGenerateModal({ open, onClose }: Props) {
  const addLeads = useLeads((s) => s.addLeads);
  const existing = useLeads((s) => s.leads);
  const [industry, setIndustry] = useState("Upholstery");
  const [city, setCity] = useState("Nashville, TN");
  const [radius, setRadius] = useState(25);
  const [count, setCount] = useState(5);
  const [type, setType] = useState<WebsiteOpportunity>("No Dedicated Website");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function generate() {
    setLoading(true);
    setError(null);
    setStatus("Searching the web for real businesses…");
    try {
      const res = await fetch("/api/generate-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, city, count, type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      const raw: any[] = Array.isArray(data.leads) ? data.leads : [];
      const seenNames = new Set(existing.map((l) => l.business.toLowerCase().trim()));
      const seenPhones = new Set(existing.map((l) => l.phone?.replace(/\D/g, "")).filter(Boolean));
      const basePriority = (existing.reduce((m, l) => Math.max(m, l.priority), 0) || 0) + 1;

      const cleaned: Lead[] = [];
      for (const r of raw) {
        const business = String(r.business || "").trim();
        if (!business) continue;
        const key = business.toLowerCase();
        const phoneDigits = String(r.phone || "").replace(/\D/g, "");
        if (seenNames.has(key)) continue;
        if (phoneDigits && seenPhones.has(phoneDigits)) continue;
        seenNames.add(key);
        if (phoneDigits) seenPhones.add(phoneDigits);

        const sources = (Array.isArray(r.sources) ? r.sources : [])
          .filter((s: string) => (ALLOWED_SOURCES as string[]).includes(s)) as LeadSource[];
        const opp = (ALLOWED_OPP as string[]).includes(r.websiteOpportunity) ? r.websiteOpportunity : type;

        cleaned.push({
          id: crypto.randomUUID(),
          priority: basePriority + cleaned.length,
          business,
          city: String(r.city || city.split(",")[0]).trim(),
          state: String(r.state || (city.split(",")[1] || "TN")).trim().slice(0, 2).toUpperCase(),
          phone: String(r.phone || "").trim(),
          owner: r.owner || undefined,
          ownerSource: r.sourceUrl || undefined,
          onlinePresence: String(r.onlinePresence || "").trim() || "Discovered via web search",
          websiteOpportunity: opp,
          quality: "High",
          status: "Not Called",
          sources: sources.length ? sources : ["Other"],
          notes: r.sourceUrl ? `Discovered via: ${r.sourceUrl}` : "Discovered via web search — verify details before calling.",
          tags: ["ai-found"],
          history: [],
        });
        if (cleaned.length >= count) break;
      }

      if (!cleaned.length) {
        setError("No new leads found. Try a different city or lead type.");
        setLoading(false);
        return;
      }

      addLeads(cleaned);
      setLoading(false);
      setStatus("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
      setStatus("");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 bg-foreground/30 backdrop-blur-sm z-40" onClick={onClose} />
          <motion.div
            initial={{opacity:0, y:20, scale:0.96}} animate={{opacity:1, y:0, scale:1}} exit={{opacity:0, y:20, scale:0.96}}
            className="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none"
          >
            <div className="bg-card border border-border rounded-3xl shadow-elev w-full max-w-md p-6 pointer-events-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="h-9 w-9 grid place-items-center rounded-full bg-gradient-to-br from-tan/40 to-gold/40">
                    <Sparkles className="h-4 w-4 text-tan-foreground" />
                  </span>
                  <h2 className="font-display text-xl">Generate Leads with AI</h2>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary"><X className="h-4 w-4" /></button>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Searches the live web (Firecrawl + AI) and imports real businesses matching your filters.
              </p>
              <div className="space-y-3">
                <Field label="Industry"><input value={industry} onChange={(e) => setIndustry(e.target.value)} className="input" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City, State"><input value={city} onChange={(e) => setCity(e.target.value)} className="input" placeholder="Nashville, TN" /></Field>
                  <Field label="Radius (mi)"><input type="number" value={radius} onChange={(e) => setRadius(+e.target.value)} className="input" /></Field>
                </div>
                <Field label="Number of leads">
                  <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(+e.target.value)} className="input" />
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
                onClick={generate}
                disabled={loading}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-navy-foreground font-medium hover:opacity-90 disabled:opacity-60"
              >
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {status || "Working…"}</> : <><Sparkles className="h-4 w-4" /> Find {count} real leads</>}
              </button>
            </div>
          </motion.div>
          <style>{`.input{width:100%;padding:.55rem .75rem;border-radius:.75rem;background:var(--secondary);border:1px solid var(--border);font-size:.875rem}`}</style>
        </>
      )}
    </AnimatePresence>
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
