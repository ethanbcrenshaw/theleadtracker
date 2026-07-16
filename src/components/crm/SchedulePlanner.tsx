// Weekly calling-schedule card for the Today view.
//
// When the week's schedule is missing or stale it asks for it (the weekly
// check-in); otherwise it shows this week's plan: slots, capacity, which
// timezones each slot should dial, and stock gaps with a one-click
// [ STOCK UP ] that pre-fills the AI generate modal with a city in the
// needed timezone.

import { useEffect, useMemo, useState } from "react";
import type { Lead } from "@/lib/types";
import {
  computeWeekPlan,
  mondayOf,
  scheduleIsStale,
  slotCapacity,
  todaysSlots,
  DAY_LABEL,
  DEFAULT_MINUTES_PER_CALL,
  SCHEDULE_KEY,
  type CallSchedule,
  type CallSlot,
} from "@/lib/planner";
import type { USZone } from "@/lib/timezone";
import { getSetting, setSetting } from "@/lib/settings";

// Where to stock up per zone — the user's working niche geography.
const ZONE_CITY_SUGGESTION: Partial<Record<USZone, string>> = {
  ET: "Knoxville, TN",
  CT: "Nashville, TN",
  MT: "Denver, CO",
  PT: "Sacramento, CA",
};

type Props = {
  leads: Lead[];
  onSchedule: (s: CallSchedule | null) => void;
  onOpenAIGenerate: (prefill?: { industry?: string; city?: string }) => void;
};

const EMPTY_SLOT: CallSlot = { day: 2, start: "13:00", end: "15:00" };

export function SchedulePlanner({ leads, onSchedule, onOpenAIGenerate }: Props) {
  const [schedule, setScheduleState] = useState<CallSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CallSlot[]>([EMPTY_SLOT]);
  const [minutesPerCall, setMinutesPerCall] = useState(DEFAULT_MINUTES_PER_CALL);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSetting<CallSchedule>(SCHEDULE_KEY).then((s) => {
      if (cancelled) return;
      setScheduleState(s);
      onSchedule(s);
      setLoaded(true);
      if (s?.slots.length) {
        setDraft(s.slots);
        setMinutesPerCall(s.minutesPerCall || DEFAULT_MINUTES_PER_CALL);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = scheduleIsStale(schedule);
  const plan = useMemo(
    () => (schedule && !stale ? computeWeekPlan(leads, schedule) : null),
    [leads, schedule, stale],
  );

  async function save(slots: CallSlot[]) {
    const valid = slots.filter((s) => slotCapacity(s, minutesPerCall) > 0);
    if (!valid.length) return;
    setSaving(true);
    const next: CallSchedule = { slots: valid, minutesPerCall, weekOf: mondayOf(new Date()) };
    await setSetting(SCHEDULE_KEY, next);
    setScheduleState(next);
    onSchedule(next);
    setEditing(false);
    setSaving(false);
  }

  /** Re-confirm last week's slots for this week in one click. */
  function keepSameSchedule() {
    if (!schedule) return;
    void save(schedule.slots);
  }

  if (!loaded) return null;

  // ── Weekly ask (missing or stale) ─────────────────────────────────────────
  if ((stale || editing) && !plan) {
    return (
      <div className="border border-border p-5 space-y-4">
        <div className="flex items-baseline justify-between border-b border-border pb-2">
          <div className="mono text-foreground">— THIS WEEK'S CALLING SCHEDULE —</div>
          <div className="mono text-[color:var(--sienna)]">
            {schedule?.slots.length ? "CONFIRM FOR THIS WEEK" : "NOT SET"}
          </div>
        </div>
        <p className="font-serif text-foreground" style={{ fontSize: "0.98rem" }}>
          When are you sitting down to cold call this week? I'll size each session and queue leads
          in the timezones most likely to answer.
        </p>

        <SlotEditor slots={draft} onChange={setDraft} />

        <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
          <div className="mono text-muted-foreground flex items-center gap-2">
            <span>MINUTES / CALL</span>
            <button
              onClick={() => setMinutesPerCall((m) => Math.max(2, m - 1))}
              className="mono ink-link px-1"
            >
              [ − ]
            </button>
            <span className="text-foreground w-5 text-center">{minutesPerCall}</span>
            <button
              onClick={() => setMinutesPerCall((m) => Math.min(30, m + 1))}
              className="mono ink-link px-1"
            >
              [ + ]
            </button>
          </div>
          <div className="flex items-center gap-4">
            {schedule?.slots.length ? (
              <button onClick={keepSameSchedule} disabled={saving} className="mono ink-link">
                [ SAME AS LAST WEEK ]
              </button>
            ) : null}
            <button
              onClick={() => save(draft)}
              disabled={saving || !draft.some((s) => slotCapacity(s, minutesPerCall) > 0)}
              className="mono px-4 py-2 bg-foreground text-background disabled:opacity-40"
            >
              {saving ? "[ SAVING… ]" : "[ SET SCHEDULE ]"}
            </button>
          </div>
        </div>
        <div className="mono text-muted-foreground">
          OR JUST TELL THE ASSISTANT — “TUESDAY 1–3 AND THURSDAY MORNINGS”
        </div>
      </div>
    );
  }

  if (!plan) return null;

  // ── Week plan ──────────────────────────────────────────────────────────────
  const totalShortfall = plan.gaps.reduce((s, g) => s + g.needed, 0);
  const today = todaysSlots(schedule, new Date());

  return (
    <div className="border border-border p-5 space-y-4">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <div className="mono text-foreground">— THE WEEK'S PLAN —</div>
        <div className="flex items-center gap-4">
          <span className="mono text-muted-foreground">
            {String(plan.totalCapacity).padStart(2, "0")} DIALS PLANNED
          </span>
          <button onClick={() => setEditing(true)} className="mono ink-link">
            [ EDIT ]
          </button>
        </div>
      </div>

      <div className="divide-y divide-border border-y border-border">
        {plan.slots.map((p, i) => {
          const isToday = today.some(
            (t) =>
              t.slot === p.slot || (t.slot.day === p.slot.day && t.slot.start === p.slot.start),
          );
          const zoneline = p.zones
            .slice(0, 3)
            .map((z) => `${z.label}${z.answerability === 3 ? " ●" : ""}`)
            .join(" · ");
          return (
            <div key={i} className="py-2.5 grid grid-cols-[7.5rem_1fr_auto] gap-3 items-baseline">
              <div className={`mono ${isToday ? "text-[color:var(--sienna)]" : "text-foreground"}`}>
                {isToday ? "▸ " : ""}
                {DAY_LABEL[p.slot.day]} {p.slot.start}–{p.slot.end}
              </div>
              <div className="mono text-muted-foreground truncate">
                {zoneline || "OUTSIDE BUSINESS HOURS"}
              </div>
              <div className="mono text-right">
                <span className="text-foreground">{String(p.capacity).padStart(2, "0")} DIALS</span>
                {p.shortfall > 0 && (
                  <span className="text-[color:var(--sienna)]"> — SHORT {p.shortfall}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalShortfall > 0 ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="mono text-[color:var(--sienna)]">
            ⚠ STOCK GAP — {String(totalShortfall).padStart(2, "0")} MORE LEAD
            {totalShortfall === 1 ? "" : "S"} NEEDED (
            {plan.gaps.map((g) => `${g.needed} ${g.label}`).join(", ")})
          </div>
          <div className="flex gap-3">
            {plan.gaps.slice(0, 2).map((g) => (
              <button
                key={g.zone}
                onClick={() =>
                  onOpenAIGenerate({ city: ZONE_CITY_SUGGESTION[g.zone] ?? undefined })
                }
                className="mono border border-foreground px-3 py-1.5 hover:bg-foreground hover:text-background"
              >
                [ STOCK UP {g.label} ]
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mono text-[color:var(--frog-ink)]">✓ FULLY STOCKED FOR THE WEEK</div>
      )}
    </div>
  );
}

function SlotEditor({ slots, onChange }: { slots: CallSlot[]; onChange: (s: CallSlot[]) => void }) {
  const set = (i: number, patch: Partial<CallSlot>) => {
    const next = slots.map((s, j) => (j === i ? { ...s, ...patch } : s));
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {slots.map((s, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {DAY_LABEL.map((d, day) => (
              <button
                key={d}
                onClick={() => set(i, { day })}
                className={`mono px-1.5 py-1 border ${
                  s.day === day
                    ? "border-foreground text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <input
            type="time"
            value={s.start}
            onChange={(e) => set(i, { start: e.target.value })}
            className="mono bg-transparent border border-border px-2 py-1 text-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
          <span className="mono text-muted-foreground">–</span>
          <input
            type="time"
            value={s.end}
            onChange={(e) => set(i, { end: e.target.value })}
            className="mono bg-transparent border border-border px-2 py-1 text-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
          <button
            onClick={() => onChange(slots.filter((_, j) => j !== i))}
            className="mono border border-border px-2 py-1 text-muted-foreground hover:text-[color:var(--sienna)] hover:border-[color:var(--sienna)]"
          >
            ×
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...slots, { ...EMPTY_SLOT }])} className="mono ink-link">
        [ + ADD SLOT ]
      </button>
    </div>
  );
}
