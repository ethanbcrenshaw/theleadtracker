import { useEffect, useMemo, useState } from "react";
import type { Lead, LeadStatus } from "@/lib/types";
import { isValidContactDate } from "@/lib/crm-utils";
import { Botanical } from "./Botanical";

const STALE_DAYS = 14;
const HOT_FLOOR = 5;
const PATTERN_MIN_CONTACTED = 5;

type Props = {
  leads: Lead[];
  queuedToday: number;
  overdue: number;
  todayScheduled: number;
  hotUncalled: number;
  onOpenAIGenerate: (prefill?: { industry?: string; city?: string }) => void;
  onOpenLead: (l: Lead) => void;
  onJumpToPipeline: () => void;
};

type Nudge = {
  id: string;
  label: string;
  body: React.ReactNode;
  action?: { label: string; onClick: () => void };
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeCache(key: string, val: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore
  }
}

const CONTACTED_STATUSES: LeadStatus[] = [
  "Called",
  "Voicemail",
  "Callback Scheduled",
  "Zoom Booked",
  "Sold",
  "Not Interested",
];

const BOOKED_STATUSES: LeadStatus[] = ["Callback Scheduled", "Zoom Booked", "Sold"];

function pickSegment(l: Lead): string | null {
  // Prefer a meaningful tag; fall back to a business-name keyword heuristic.
  const skip = new Set(["ai-found", "hot", "cold", "warm", "vip", "important"]);
  const tag = l.tags.find((t) => !skip.has(t.toLowerCase().trim()));
  if (tag) return tag.toLowerCase().trim();
  // Heuristic: last word of business name if it looks like a trade
  const words = l.business.toLowerCase().split(/[\s&,-]+/).filter(Boolean);
  const trade = words.find((w) =>
    /(roof|paint|plumb|electric|hvac|landscap|upholster|clean|salon|barber|dental|law|photog|bak|floor|remodel|carpent|tile|window|garage|lock|tow|auto|repair)/.test(
      w,
    ),
  );
  return trade ?? null;
}

export function DailyBriefing({
  leads,
  queuedToday,
  overdue,
  todayScheduled,
  hotUncalled,
  onOpenAIGenerate,
  onOpenLead,
  onJumpToPipeline,
}: Props) {
  const day = todayKey();
  const briefingCacheKey = "leadbloom.briefing";
  const dismissKey = `leadbloom.nudge.dismiss.${day}`;

  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const inPipeline = leads.filter((l) =>
      ["Called", "Callback Scheduled", "Zoom Booked"].includes(l.status),
    ).length;
    const zoomBooked = leads.filter((l) => l.status === "Zoom Booked" || l.zoomBooked).length;
    const sold = leads.filter((l) => l.status === "Sold").length;
    let contactedYesterday = 0;
    let movedYesterday = 0;
    for (const l of leads) {
      for (const h of l.history) {
        const t = new Date(h.date).getTime();
        if (Number.isFinite(t) && now - t <= dayMs) movedYesterday += 1;
      }
      if (isValidContactDate(l.lastContacted)) {
        const t = new Date(l.lastContacted!).getTime();
        if (Number.isFinite(t) && now - t <= dayMs) contactedYesterday += 1;
      }
    }
    const weekday = new Date().toLocaleDateString(undefined, { weekday: "long" });
    return {
      total: leads.length,
      queuedToday,
      overdue,
      todayScheduled,
      hotUncalled,
      inPipeline,
      zoomBooked,
      sold,
      contactedYesterday,
      movedYesterday,
      weekday,
    };
  }, [leads, queuedToday, overdue, todayScheduled, hotUncalled]);

  // Briefing cache: { date, text }
  const [briefing, setBriefing] = useState<string | null>(() => {
    const c = readCache<{ date: string; text: string }>(briefingCacheKey);
    return c && c.date === day ? c.text : null;
  });
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingErr, setBriefingErr] = useState(false);

  async function fetchBriefing(force = false) {
    if (briefingLoading) return;
    if (!force && briefing) return;
    setBriefingLoading(true);
    setBriefingErr(false);
    try {
      const res = await fetch("/api/daily-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "briefing", stats }),
      });
      const data = await res.json();
      if (!res.ok || !data.text) throw new Error(data.error || "no text");
      setBriefing(data.text);
      writeCache(briefingCacheKey, { date: day, text: data.text });
    } catch {
      setBriefingErr(true);
    } finally {
      setBriefingLoading(false);
    }
  }

  useEffect(() => {
    void fetchBriefing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fallbackBriefing = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      `${stats.queuedToday} call${stats.queuedToday === 1 ? "" : "s"} queued for ${stats.weekday.toLowerCase()}` +
        (stats.overdue > 0 ? ` (${stats.overdue} overdue)` : "") + ".",
    );
    if (stats.inPipeline)
      parts.push(`${stats.inPipeline} lead${stats.inPipeline === 1 ? "" : "s"} in active pipeline.`);
    if (stats.contactedYesterday)
      parts.push(`${stats.contactedYesterday} touched in the last 24 hours.`);
    return parts.join(" ");
  }, [stats]);

  // Dismissed nudge ids for today
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const raw = readCache<string[]>(dismissKey);
    return new Set(raw ?? []);
  });
  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeCache(dismissKey, Array.from(next));
      return next;
    });
  }

  // Pattern insight — cache per day
  const patternCacheKey = `leadbloom.pattern.${day}`;
  const [patternText, setPatternText] = useState<string | null>(() => {
    const c = readCache<{ date: string; text: string }>(patternCacheKey);
    return c && c.date === day ? c.text : null;
  });

  // Compute segment/city conversion groups
  const patternGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; kind: "segment" | "city"; contacted: number; booked: number; dead: number }
    >();
    for (const l of leads) {
      if (!CONTACTED_STATUSES.includes(l.status)) continue;
      const seg = pickSegment(l);
      const buckets: Array<{ k: string; kind: "segment" | "city" }> = [];
      if (seg) buckets.push({ k: seg, kind: "segment" });
      if (l.city) buckets.push({ k: l.city, kind: "city" });
      for (const { k, kind } of buckets) {
        const id = `${kind}:${k}`;
        const g = groups.get(id) ?? { key: k, kind, contacted: 0, booked: 0, dead: 0 };
        g.contacted += 1;
        if (BOOKED_STATUSES.includes(l.status)) g.booked += 1;
        if (l.status === "Not Interested") g.dead += 1;
        groups.set(id, g);
      }
    }
    return Array.from(groups.values()).filter((g) => g.contacted >= PATTERN_MIN_CONTACTED);
  }, [leads]);

  useEffect(() => {
    if (patternText) return;
    if (patternGroups.length < 1) return;
    // Only fetch if there's enough signal — need at least one group with dead+booked >= 3
    const hasSignal = patternGroups.some((g) => g.booked + g.dead >= 3);
    if (!hasSignal) return;
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/daily-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "pattern", groups: patternGroups }),
        });
        const data = await res.json();
        if (cancel || !res.ok || !data.text) return;
        setPatternText(data.text);
        writeCache(patternCacheKey, { date: day, text: data.text });
      } catch {
        // silent
      }
    })();
    return () => {
      cancel = true;
    };
  }, [patternGroups, patternText, patternCacheKey, day]);

  // Stale leads
  const staleLeads = useMemo(() => {
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    return leads
      .filter((l) => {
        if (!["Called", "Voicemail", "Callback Scheduled"].includes(l.status)) return false;
        if (!isValidContactDate(l.lastContacted)) return true;
        const t = new Date(l.lastContacted!).getTime();
        return t <= cutoff;
      })
      .sort((a, b) => {
        const at = isValidContactDate(a.lastContacted) ? new Date(a.lastContacted!).getTime() : 0;
        const bt = isValidContactDate(b.lastContacted) ? new Date(b.lastContacted!).getTime() : 0;
        return at - bt;
      });
  }, [leads]);

  // Best converting segment (for prefill)
  const bestSegment = useMemo(() => {
    const segs = patternGroups.filter((g) => g.kind === "segment");
    if (!segs.length) return null;
    return segs.slice().sort((a, b) => b.booked / b.contacted - a.booked / a.contacted)[0];
  }, [patternGroups]);

  const bestCity = useMemo(() => {
    const cs = patternGroups.filter((g) => g.kind === "city");
    if (!cs.length) return null;
    return cs.slice().sort((a, b) => b.booked / b.contacted - a.booked / a.contacted)[0];
  }, [patternGroups]);

  const nudges: Nudge[] = [];

  if (staleLeads.length > 0) {
    const oldest = staleLeads[0];
    nudges.push({
      id: "stale",
      label: "STALE LEADS",
      body: (
        <>
          {staleLeads.length} active lead{staleLeads.length === 1 ? "" : "s"} untouched for {STALE_DAYS}+ days — oldest is{" "}
          <span className="italic">{oldest.business}</span>.
        </>
      ),
      action: { label: "[ OPEN OLDEST ]", onClick: () => onOpenLead(oldest) },
    });
  }

  if (hotUncalled < HOT_FLOOR) {
    nudges.push({
      id: "hot-low",
      label: "HOT PILE LOW",
      body: (
        <>
          Only {hotUncalled} high-quality uncalled lead{hotUncalled === 1 ? "" : "s"} left
          {bestSegment ? `. ${bestSegment.key} has been converting best` : ""}
          {bestCity ? ` in ${bestCity.key}` : ""}.
        </>
      ),
      action: {
        label: "[ GENERATE MORE ]",
        onClick: () =>
          onOpenAIGenerate({
            industry: bestSegment?.key ? capitalize(bestSegment.key) : undefined,
            city: bestCity?.key,
          }),
      },
    });
  }

  if (patternText) {
    nudges.push({
      id: "pattern",
      label: "PATTERN INSIGHT",
      body: <>{patternText}</>,
      action: { label: "[ REVIEW PIPELINE ]", onClick: onJumpToPipeline },
    });
  }

  const visibleNudges = nudges.filter((n) => !dismissed.has(n.id));
  const briefingText = briefing ?? (briefingErr ? fallbackBriefing : null);

  return (
    <div className="border border-border p-6 relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-6 -right-4 w-40 opacity-40 hidden md:block"
      >
        <Botanical variant="sprig" opacity={0.35} />
      </div>

      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2 mb-3">
        <div className="mono text-foreground">— DAILY BRIEFING</div>
        <button
          onClick={() => void fetchBriefing(true)}
          disabled={briefingLoading}
          className="mono ink-link disabled:opacity-50"
        >
          {briefingLoading ? "[ REFRESHING… ]" : "[ REFRESH ]"}
        </button>
      </div>

      <p className="font-display text-lg lowercase leading-relaxed text-foreground max-w-3xl min-h-[3rem]">
        {briefingText ? (
          briefingText
        ) : briefingLoading ? (
          <span className="text-muted-foreground italic">reading the board…</span>
        ) : (
          <span className="text-muted-foreground italic">{fallbackBriefing}</span>
        )}
      </p>

      {visibleNudges.length > 0 && (
        <div className="mt-6 space-y-3 max-w-3xl">
          {visibleNudges.map((n) => (
            <div
              key={n.id}
              className="border border-border p-4 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="mono text-muted-foreground mb-1">— {n.label}</div>
                <div className="text-sm text-foreground leading-relaxed">{n.body}</div>
                {n.action && (
                  <button onClick={n.action.onClick} className="mono ink-link mt-2 inline-block">
                    {n.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(n.id)}
                aria-label={`Dismiss ${n.label}`}
                className="mono text-muted-foreground hover:text-foreground shrink-0"
              >
                [ × ]
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}