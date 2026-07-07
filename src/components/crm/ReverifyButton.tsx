import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLeads } from "@/lib/store";
import type { Lead, LeadEnrichment, VerificationTier } from "@/lib/types";

const CONCURRENCY = 3;

type Summary = {
  checked: number;
  newlyFlagged: number;
  closed: number;
  deadSites: number;
  wrongBusiness: number;
  errors: number;
};

/**
 * Bulk re-run the hardened enrichment over every existing lead. Uses
 * /api/enrich-lead sequentially with concurrency, so partial failures don't
 * poison the whole book. Reports what changed at the end.
 */
export function ReverifyButton() {
  const leads = useLeads((s) => s.leads);
  const updateLead = useLeads((s) => s.updateLead);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [current, setCurrent] = useState<string>("");

  async function run() {
    if (running) return;
    const list = [...leads];
    if (!list.length) return;
    setRunning(true);
    setSummary(null);
    setDone(0);
    setTotal(list.length);

    const s: Summary = { checked: 0, newlyFlagged: 0, closed: 0, deadSites: 0, wrongBusiness: 0, errors: 0 };

    let i = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
      while (i < list.length) {
        const idx = i++;
        const lead = list[idx];
        setCurrent(lead.business);
        const beforeTier: VerificationTier = lead.verificationTier ?? "partial";
        try {
          const res = await fetch("/api/enrich-lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId: lead.id }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error || `status ${res.status}`);
          const u = j.updates as {
            enrichment?: LeadEnrichment;
            confidenceScore?: number;
            confidenceEvidence?: string[];
            unverified?: boolean;
            unverifiedReason?: string | null;
            verificationTier?: VerificationTier;
            verificationReasons?: string[];
          };
          updateLead(lead.id, {
            enrichment: u.enrichment,
            confidenceScore: u.confidenceScore,
            confidenceEvidence: u.confidenceEvidence,
            unverified: u.unverified,
            unverifiedReason: u.unverifiedReason ?? undefined,
            verificationTier: u.verificationTier,
            verificationReasons: u.verificationReasons,
          });
          s.checked++;
          const nextTier = u.verificationTier ?? "partial";
          const reasons = (u.verificationReasons ?? []).join(" ").toLowerCase();
          const reasonUnv = (u.unverifiedReason ?? "").toLowerCase();
          const becameWorse = beforeTier === "verified" && nextTier !== "verified";
          const flaggedFresh = beforeTier !== "unverified" && nextTier === "unverified";
          if (becameWorse || flaggedFresh) s.newlyFlagged++;
          if (/closed/.test(reasonUnv)) s.closed++;
          else if (/unreachable/.test(reasons)) s.deadSites++;
          else if (/didn't match/.test(reasons)) s.wrongBusiness++;
        } catch {
          s.errors++;
        }
        setDone((n) => n + 1);
      }
    });
    await Promise.all(workers);
    setCurrent("");
    setSummary(s);
    setRunning(false);
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={run}
        disabled={running || leads.length === 0}
        className="mono border border-foreground px-3 py-1 hover:bg-foreground hover:text-background disabled:opacity-50 inline-flex items-center gap-2"
      >
        {running ? <><Loader2 className="h-3 w-3 animate-spin" /> RE-VERIFYING…</> : "[ RE-VERIFY BOOK ]"}
      </button>
      {running && (
        <span className="mono text-muted-foreground">
          {String(done).padStart(3, "0")} / {String(total).padStart(3, "0")}
          {current ? ` — ${current}` : ""}
        </span>
      )}
      {summary && !running && (
        <span className="mono text-muted-foreground">
          — {summary.checked} CHECKED,{" "}
          <span className={summary.newlyFlagged > 0 ? "text-[color:var(--sienna)]" : ""}>
            {summary.newlyFlagged} NEWLY FLAGGED
          </span>
          {summary.closed || summary.deadSites || summary.wrongBusiness
            ? ` (${[
                summary.closed ? `${summary.closed} closed` : null,
                summary.deadSites ? `${summary.deadSites} dead sites` : null,
                summary.wrongBusiness ? `${summary.wrongBusiness} wrong-business` : null,
              ].filter(Boolean).join(", ")})`
            : ""}
          {summary.errors ? ` · ${summary.errors} errors` : ""}
        </span>
      )}
    </div>
  );
}
