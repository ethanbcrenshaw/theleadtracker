import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Loader2 } from "lucide-react";
import { useLeads } from "@/lib/store";
import type { Lead, WebsiteOpportunity } from "@/lib/types";

interface Props { open: boolean; onClose: () => void }

const SAMPLE_NAMES = [
  "Heritage Stitchworks", "Cypress Upholstery", "Drayton Custom Furniture",
  "Magnolia Reupholstery", "Ironwood Furniture Repair", "Saddle & Thread Co.",
  "Reverie Upholstery Studio", "Foxgrove Furniture Restoration",
  "Wren & Oak Upholstery", "Pinecrest Canvas Works",
];

export function AIGenerateModal({ open, onClose }: Props) {
  const addLeads = useLeads((s) => s.addLeads);
  const [industry, setIndustry] = useState("Upholstery");
  const [city, setCity] = useState("Nashville");
  const [radius, setRadius] = useState(25);
  const [count, setCount] = useState(5);
  const [type, setType] = useState<WebsiteOpportunity>("No Dedicated Website");
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1400));
    const phones = () => `(${Math.floor(200 + Math.random() * 700)}) ${Math.floor(200 + Math.random() * 700)}-${Math.floor(1000 + Math.random() * 8999)}`;
    const newLeads: Lead[] = Array.from({ length: count }, (_, i) => {
      const name = SAMPLE_NAMES[Math.floor(Math.random() * SAMPLE_NAMES.length)] + ` ${Math.floor(Math.random()*99)}`;
      return {
        id: crypto.randomUUID(),
        priority: 100 + i,
        business: name,
        city,
        state: "TN",
        phone: phones(),
        onlinePresence: type === "Facebook Only" ? "Facebook page only" :
                        type === "No Dedicated Website" ? "Google Business + Yelp; no website found" :
                        type === "Outdated Website" ? "Outdated site, mobile broken" :
                        "Social presence, no central hub",
        websiteOpportunity: type,
        quality: "High",
        status: "Not Called",
        sources: ["Facebook", "Google Business"],
        notes: "AI-generated lead — verify before calling.",
        tags: ["ai-generated"],
        history: [],
      };
    });
    addLeads(newLeads);
    setLoading(false);
    onClose();
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
                Prototype mode — generates realistic mock leads. Wire to a real lead API later.
              </p>
              <div className="space-y-3">
                <Field label="Industry"><input value={industry} onChange={(e) => setIndustry(e.target.value)} className="input" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City"><input value={city} onChange={(e) => setCity(e.target.value)} className="input" /></Field>
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
              <button
                onClick={generate}
                disabled={loading}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-navy-foreground font-medium hover:opacity-90 disabled:opacity-60"
              >
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching local businesses…</> : <><Sparkles className="h-4 w-4" /> Generate {count} leads</>}
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
