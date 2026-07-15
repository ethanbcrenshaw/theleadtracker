import { useState } from "react";
import type { CallRecord, Lead } from "@/lib/types";
import { formatDate, isValidContactDate } from "@/lib/crm-utils";
import { useLeads } from "@/lib/store";
import { StatusBadge } from "./Badges";

interface Props {
  leads: Lead[];
  onView: (l: Lead) => void;
  onCall: (l: Lead) => void;
}

type Due = { label: string; overdueDays: number; tone: "overdue" | "today" | "later" };

function dueOf(l: Lead): Due {
  if (!isValidContactDate(l.nextFollowUp)) {
    return { label: "NO DATE", overdueDays: -1, tone: "later" };
  }
  const days = Math.ceil((new Date(l.nextFollowUp!).getTime() - Date.now()) / 86_400_000);
  if (days < 0) {
    const n = Math.abs(days);
    return { label: `OVERDUE — ${n} DAY${n === 1 ? "" : "S"}`, overdueDays: n, tone: "overdue" };
  }
  if (days === 0) return { label: "DUE TODAY", overdueDays: 0, tone: "today" };
  return { label: formatDate(l.nextFollowUp).toUpperCase(), overdueDays: -days, tone: "later" };
}

function latestCall(l: Lead): CallRecord | null {
  const rs = l.callRecords;
  return rs && rs.length ? rs[rs.length - 1] : null;
}

export function FollowUpView({ leads, onView, onCall }: Props) {
  const sorted = [...leads].sort((a, b) => {
    const da = dueOf(a);
    const db = dueOf(b);
    // Most overdue first, then due-today, then soonest upcoming.
    return db.overdueDays - da.overdueDays;
  });

  if (sorted.length === 0) {
    return (
      <div className="border border-border p-12 text-center mono text-muted-foreground bg-card">
        — no follow-ups due — you're caught up —
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sorted.map((l) => (
        <FollowUpCard key={l.id} lead={l} onView={onView} onCall={onCall} />
      ))}
    </div>
  );
}

function FollowUpCard({
  lead,
  onView,
  onCall,
}: {
  lead: Lead;
  onView: (l: Lead) => void;
  onCall: (l: Lead) => void;
}) {
  const updateLead = useLeads((s) => s.updateLead);
  const addNote = useLeads((s) => s.addNote);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const due = dueOf(lead);
  const call = latestCall(lead);
  const callCount = lead.callRecords?.length ?? 0;

  const spokeName = call?.contactName || lead.owner || null;
  const spokeRole = call?.contactName ? call.contactRole : lead.owner ? lead.ownerNote : null;
  const whereAt = call?.summary || lead.aiSummary || null;
  const whyThis = call?.followUpReason || lead.aiNextAction || call?.nextAction || null;
  const objections = call?.objections?.filter(Boolean) ?? [];

  function copyPhone() {
    if (!lead.phone) return;
    void navigator.clipboard?.writeText(lead.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function snooze(days: number, label: string) {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    d.setDate(d.getDate() + days);
    updateLead(lead.id, { nextFollowUp: d.toISOString() });
    addNote(lead.id, `⏱ SNOOZED → ${label} (${formatDate(d.toISOString())})`);
    setSnoozeOpen(false);
  }

  return (
    <div className="border border-border bg-card">
      {/* Top strip: due chip + business + meta */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4">
        <div className="min-w-0">
          <div
            className={`mono ${
              due.tone === "overdue"
                ? "text-[color:var(--sienna)]"
                : due.tone === "today"
                  ? "text-foreground"
                  : "text-muted-foreground"
            }`}
          >
            {due.label}
          </div>
          <button
            onClick={() => onView(lead)}
            className="font-display text-2xl text-foreground text-left hover:underline underline-offset-4 mt-1 block truncate"
          >
            {lead.business}
          </button>
          <div className="mono text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span>
              {lead.city}, {lead.state}
            </span>
            {lead.phone && (
              <>
                <span className="opacity-40">·</span>
                <span>{lead.phone}</span>
                <button onClick={copyPhone} className="ink-link">
                  {copied ? "[ COPIED ]" : "[ COPY ]"}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mono text-muted-foreground text-right shrink-0">
          {callCount > 0 && <div>CALL #{callCount}</div>}
          <div className="mt-1">
            LAST —{" "}
            {isValidContactDate(lead.lastContacted) ? formatDate(lead.lastContacted) : "NEVER"}
          </div>
        </div>
      </div>

      {/* Body: who / where / why */}
      <div className="px-5 py-4 space-y-3 border-t border-border mt-4">
        {spokeName && (
          <div className="mono text-muted-foreground">
            SPOKE WITH — <span className="text-foreground">{spokeName.toUpperCase()}</span>
            {spokeRole ? ` (${spokeRole.toUpperCase()})` : ""}
          </div>
        )}

        <div>
          <div className="mono text-muted-foreground mb-1 flex items-center gap-2">
            WHERE THEY'RE AT <StatusBadge s={lead.status} />
          </div>
          {whereAt ? (
            <p
              className="font-serif text-foreground leading-snug line-clamp-3"
              style={{ fontSize: "0.98rem" }}
            >
              {whereAt}
            </p>
          ) : lead.notes ? (
            <p className="mono text-muted-foreground line-clamp-2">{lead.notes}</p>
          ) : (
            <p className="mono text-muted-foreground italic">— no call notes yet —</p>
          )}
        </div>

        {whyThis && (
          <div>
            <div className="mono text-muted-foreground mb-1">WHY THIS CALL</div>
            <p
              className="font-serif text-[color:var(--sienna)] leading-snug"
              style={{ fontSize: "1.05rem" }}
            >
              {whyThis}
            </p>
          </div>
        )}

        {objections.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {objections.map((o, i) => (
              <span
                key={i}
                className="mono border border-border px-1.5 py-0.5 text-muted-foreground"
              >
                {o}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 py-3 border-t border-border flex items-center gap-4 relative">
        <button
          onClick={() => onCall(lead)}
          className="mono px-3 py-1.5 bg-foreground text-background"
        >
          [ CALL ]
        </button>
        <button onClick={() => onView(lead)} className="mono ink-link">
          [ DOSSIER ]
        </button>
        <div className="relative ml-auto">
          <button onClick={() => setSnoozeOpen((o) => !o)} className="mono ink-link">
            [ SNOOZE ]
          </button>
          {snoozeOpen && (
            <div className="absolute right-0 bottom-full mb-2 bg-background border border-border z-10 min-w-[10rem]">
              <button
                onClick={() => snooze(1, "tomorrow")}
                className="mono block w-full text-left px-3 py-2 text-foreground hover:bg-foreground/[0.05]"
              >
                TOMORROW
              </button>
              <button
                onClick={() => snooze(3, "+3 days")}
                className="mono block w-full text-left px-3 py-2 text-foreground hover:bg-foreground/[0.05] border-t border-border"
              >
                + 3 DAYS
              </button>
              <button
                onClick={() => snooze(7, "next week")}
                className="mono block w-full text-left px-3 py-2 text-foreground hover:bg-foreground/[0.05] border-t border-border"
              >
                NEXT WEEK
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
