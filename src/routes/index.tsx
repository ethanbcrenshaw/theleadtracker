import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLeads } from "@/lib/store";
import { allTags, exportCSV, isValidContactDate } from "@/lib/crm-utils";
import { StatsCards } from "@/components/crm/StatsCards";
import { Filters, EMPTY_FILTERS, type FilterState } from "@/components/crm/Filters";
import { FilterPresets } from "@/components/crm/FilterPresets";
import { useSavedFilters } from "@/lib/savedFilters";
import { LeadTable, qualityRank, statusRank } from "@/components/crm/LeadTable";
import { LeadDetail } from "@/components/crm/LeadDetail";
import { QueueView } from "@/components/crm/QueueView";
import { SavedViewPills, type SavedView } from "@/components/crm/SavedViewPills";
import { AnalyticsView } from "@/components/crm/AnalyticsView";
import { AIGenerateModal } from "@/components/crm/AIGenerateModal";
import { BulkBar } from "@/components/crm/BulkBar";
import { CallAssistant } from "@/components/crm/CallAssistant";
import { AddLeadSheet } from "@/components/crm/AddLeadSheet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Botanical, BotanicalDivider } from "@/components/crm/Botanical";
import { Wordmark } from "@/components/crm/Wordmark";
import { BloomFlower } from "@/components/crm/BloomFlower";
import { TodayView, type TodayItem } from "@/components/crm/TodayView";
import { DailyBriefing } from "@/components/crm/DailyBriefing";
import type { Lead } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "lead bloom — local business CRM" },
      { name: "description", content: "A warm, editorial CRM for solo web designers and small agencies. Track, prioritize, and bloom your leads." },
      { property: "og:title", content: "lead bloom — local business CRM" },
      { property: "og:description", content: "Track, prioritize, and bloom your local business leads." },
    ],
    links: [],
  }),
  component: Dashboard,
});

function Dashboard() {
  const leads = useLeads((s) => s.leads);
  const setStatus = useLeads((s) => s.setStatus);
  const bulkSetStatus = useLeads((s) => s.bulkSetStatus);
  const bulkDelete = useLeads((s) => s.bulkDelete);

  const [search, setSearch] = useState("");
  const [view, setView] = useState<SavedView>("today");
  const [todayCap, setTodayCap] = useState<number>(() => {
    if (typeof window === "undefined") return 10;
    const v = Number(window.localStorage.getItem("leadbloom.todayCap"));
    return Number.isFinite(v) && v >= 3 && v <= 50 ? v : 10;
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("leadbloom.todayCap", String(todayCap));
    }
  }, [todayCap]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () => (activeId ? (leads.find((l) => l.id === activeId) ?? null) : null),
    [leads, activeId]
  );
  const setActive = (l: Lead | null) => setActiveId(l ? l.id : null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState<{ industry?: string; city?: string }>({});
  const [callLead, setCallLead] = useState<Lead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const { presets, save: savePreset, remove: removePreset } = useSavedFilters();

  const cities = useMemo(
    () => Array.from(new Set(leads.map((l) => l.city))).sort(),
    [leads]
  );
  const tags = useMemo(() => allTags(leads), [leads]);

  // Apply search by business or city only (per spec)
  const searched = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return leads;
    return leads.filter((l) => `${l.business} ${l.city}`.toLowerCase().includes(q));
  }, [leads, search]);

  const endOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);

  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  // "Hot, not called": High quality + status Not Called.
  // Sort by quality desc, then never-contacted first, then priority.
  const hotLeads = useMemo(() => {
    return [...searched]
      .filter((l) => l.quality === "High" && l.status === "Not Called")
      .sort((a, b) => {
        const q = qualityRank[b.quality] - qualityRank[a.quality];
        if (q !== 0) return q;
        const aContacted = isValidContactDate(a.lastContacted) ? 1 : 0;
        const bContacted = isValidContactDate(b.lastContacted) ? 1 : 0;
        if (aContacted !== bContacted) return aContacted - bContacted;
        return a.priority - b.priority;
      });
  }, [searched]);

  // "Follow-ups due": follow-up valid and today-or-earlier. Most overdue first.
  const followupLeads = useMemo(() => {
    return [...searched]
      .filter(
        (l) =>
          isValidContactDate(l.nextFollowUp) &&
          new Date(l.nextFollowUp!).getTime() <= endOfToday
      )
      .sort(
        (a, b) =>
          new Date(a.nextFollowUp!).getTime() - new Date(b.nextFollowUp!).getTime()
      );
  }, [searched, endOfToday]);

  // "Pipeline": active outreach in progress. Sort by nextFollowUp asc, nulls last.
  const pipelineLeads = useMemo(() => {
    const inPipeline = (s: Lead["status"]) =>
      s === "Called" || s === "Callback Scheduled" || s === "Zoom Booked";
    return [...searched]
      .filter((l) => inPipeline(l.status))
      .sort((a, b) => {
        const ad = isValidContactDate(a.nextFollowUp)
          ? new Date(a.nextFollowUp!).getTime()
          : Number.POSITIVE_INFINITY;
        const bd = isValidContactDate(b.nextFollowUp)
          ? new Date(b.nextFollowUp!).getTime()
          : Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return statusRank[a.status] - statusRank[b.status];
      });
  }, [searched]);

  // "All leads" honors the existing dropdown filters on top of the search.
  const allFiltered = useMemo(() => {
    return searched.filter((l) => {
      if (filters.city !== "All" && l.city !== filters.city) return false;
      if (filters.quality !== "All" && l.quality !== filters.quality) return false;
      if (filters.status !== "All" && l.status !== filters.status) return false;
      if (filters.opportunity !== "All" && l.websiteOpportunity !== filters.opportunity)
        return false;
      if (filters.source !== "All" && !l.sources.includes(filters.source)) return false;
      if (filters.tags.length > 0 && !filters.tags.some((t) => l.tags.includes(t))) return false;
      return true;
    });
  }, [searched, filters]);

  const counts = {
    hot: hotLeads.length,
    followups: followupLeads.length,
    pipeline: pipelineLeads.length,
    all: allFiltered.length,
  };

  // TODAY — merged prioritized worklist
  const todayItems = useMemo<TodayItem[]>(() => {
    const now = Date.now();
    const items: TodayItem[] = [];
    const usedIds = new Set<string>();

    // 1) Overdue follow-ups (most overdue first)
    for (const l of searched) {
      if (!isValidContactDate(l.nextFollowUp)) continue;
      const t = new Date(l.nextFollowUp!).getTime();
      if (t >= startOfToday) continue;
      const days = Math.max(1, Math.ceil((now - t) / 86400000));
      items.push({
        lead: l,
        reason: `OVERDUE — ${days} DAY${days === 1 ? "" : "S"}`,
        tone: "overdue",
        sortKey: -t, // most overdue = smallest t = largest -t
      });
      usedIds.add(l.id);
    }
    items.sort((a, b) => b.sortKey - a.sortKey);

    // 2) Follow-ups / callbacks scheduled TODAY
    const todayScheduled: TodayItem[] = [];
    for (const l of searched) {
      if (usedIds.has(l.id)) continue;
      if (!isValidContactDate(l.nextFollowUp)) continue;
      const t = new Date(l.nextFollowUp!).getTime();
      if (t < startOfToday || t > endOfToday) continue;
      const reason = l.status === "Callback Scheduled" ? "CALLBACK TODAY" : "FOLLOW-UP TODAY";
      todayScheduled.push({ lead: l, reason, tone: "today", sortKey: t });
      usedIds.add(l.id);
    }
    todayScheduled.sort((a, b) => a.sortKey - b.sortKey);
    items.push(...todayScheduled);

    // 3) Hot untouched leads to fill up to cap. Prefer verified, higher confidence first.
    const hotPool = searched
      .filter(
        (l) =>
          !usedIds.has(l.id) &&
          l.quality === "High" &&
          l.status === "Not Called" &&
          !isValidContactDate(l.lastContacted) &&
          !l.unverified,
      )
      .sort((a, b) => {
        const ac = a.confidenceScore ?? -1;
        const bc = b.confidenceScore ?? -1;
        if (ac !== bc) return bc - ac;
        return a.priority - b.priority;
      });

    for (const l of hotPool) {
      if (items.length >= todayCap) break;
      items.push({
        lead: l,
        reason: "HOT — NEVER CALLED",
        tone: "hot",
        sortKey: 0,
      });
      usedIds.add(l.id);
    }

    return items.slice(0, todayCap);
  }, [searched, startOfToday, endOfToday, todayCap]);

  // Counts used by DailyBriefing's stats block
  const overdueCount = useMemo(
    () => todayItems.filter((i) => i.tone === "overdue").length,
    [todayItems],
  );
  const todayScheduledCount = useMemo(
    () => todayItems.filter((i) => i.tone === "today").length,
    [todayItems],
  );
  const hotFillCount = useMemo(
    () => todayItems.filter((i) => i.tone === "hot").length,
    [todayItems],
  );

  function openAIGenerate(prefill?: { industry?: string; city?: string }) {
    setAiPrefill(prefill ?? {});
    setAiOpen(true);
  }

  const countsWithToday = { ...counts, today: todayItems.length };

  const dateLine = useMemo(() => {
    const d = new Date();
    const weekday = d.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase();
    const month = d.toLocaleDateString(undefined, { month: "long" }).toUpperCase();
    const day = d.getDate();
    const n = todayItems.length;
    const noun = n === 1 ? "CALL" : "CALLS";
    return `${weekday} — ${month} ${day} — ${String(n).padStart(2, "0")} ${noun} QUEUED`;
  }, [todayItems.length]);

  // What's used by bulk actions (only meaningful in the "all" table view).
  const tableLeads = allFiltered;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) =>
      tableLeads.every((l) => prev.has(l.id)) ? new Set() : new Set(tableLeads.map((l) => l.id))
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Editorial masthead */}
      <header>
        {/* top bar */}
        <div className="border-b border-border">
          <div className="max-w-[1500px] mx-auto px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground">
              <Wordmark size={22} />
            </div>
            <div className="flex items-center gap-6">
              <button onClick={() => setAiOpen(true)} className="mono ink-link">[ AI GENERATE ]</button>
              <button onClick={() => exportCSV(allFiltered)} className="mono ink-link">[ EXPORT CSV ]</button>
              <button onClick={() => setAddOpen(true)} className="mono px-3 py-1 bg-foreground text-background hover:opacity-90">
                [ ADD LEAD ]
              </button>
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* masthead */}
        <div className="relative max-w-[1500px] mx-auto px-8 pt-14 pb-16 border-b border-border overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none hidden md:block"
            style={{ position: "absolute", top: 0, bottom: 0, right: "1rem", width: "22rem" }}
          >
            <Botanical variant="masthead" className="h-full w-full" opacity={0.08} />
          </div>
          <div
            aria-hidden
            className="pointer-events-none hidden md:block text-foreground"
            style={{ position: "absolute", top: "0.5rem", bottom: "0.5rem", right: "3.5rem", width: "13rem" }}
          >
            <BloomFlower className="h-full w-full" />
          </div>
          <div className="relative mono text-muted-foreground">CRM — LOCAL BUSINESS OUTREACH — 2026</div>
          <div className="relative mt-6 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-end">
            <h1 className="font-display font-normal lowercase tracking-tight leading-[0.95] text-[clamp(4rem,11vw,7rem)]">
              <span className="text-[color:var(--sienna)]">leads</span>
            </h1>
            <p className="text-muted-foreground max-w-sm lg:text-right leading-relaxed text-sm">
              A working ledger for local businesses. Track, prioritize, and follow up on
              the ones most likely to say yes. Start with the highest-opportunity entries.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-8 py-12 space-y-10">
        <StatsCards leads={leads} />

        <div className="space-y-5">
          <SavedViewPills view={view} setView={setView} counts={countsWithToday} />

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="w-full sm:w-96">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="SEARCH BUSINESS OR CITY"
                className="mono w-full bg-transparent border-0 border-b border-border py-2 focus:outline-none focus:border-foreground text-foreground placeholder:text-muted-foreground"
                style={{ fontSize: "11px" }}
              />
            </div>
            {view !== "analytics" && (
              <div className="mono text-muted-foreground">
                SHOWING{" "}
                <span className="text-foreground">
                  {String(
                    view === "today"
                      ? todayItems.length
                      : view === "hot"
                      ? hotLeads.length
                      : view === "followups"
                        ? followupLeads.length
                        : view === "pipeline"
                          ? pipelineLeads.length
                          : allFiltered.length,
                  ).padStart(3, "0")}
                </span>{" "}
                / {String(leads.length).padStart(3, "0")}
              </div>
            )}
          </div>

          {view === "all" && (
            <div className="space-y-3">
              <FilterPresets
                presets={presets}
                onApply={setFilters}
                onSave={(name) => savePreset(name, filters)}
                onDelete={removePreset}
              />
              <Filters filters={filters} setFilters={setFilters} cities={cities} tags={tags} />
            </div>
          )}
        </div>

        {view === "today" && (
          <div className="space-y-3">
            <div className="border-b-2 border-foreground/60 pb-2 flex items-baseline justify-between gap-4 flex-wrap">
              <div className="mono text-foreground">TODAY</div>
              <div className="flex items-center gap-4">
                <div className="mono text-muted-foreground flex items-center gap-2">
                  <span>CAP</span>
                  <button
                    onClick={() => setTodayCap((c) => Math.max(3, c - 1))}
                    className="mono ink-link px-1"
                    aria-label="Decrease cap"
                  >[ − ]</button>
                  <span className="text-foreground w-6 text-center">{String(todayCap).padStart(2, "0")}</span>
                  <button
                    onClick={() => setTodayCap((c) => Math.min(50, c + 1))}
                    className="mono ink-link px-1"
                    aria-label="Increase cap"
                  >[ + ]</button>
                </div>
                <div className="mono text-muted-foreground">— {String(todayItems.length).padStart(3, "0")}</div>
              </div>
            </div>
            <div className="mono text-muted-foreground">{dateLine}</div>
          </div>
        )}
        {view === "today" && (
          <DailyBriefing
            leads={leads}
            queuedToday={todayItems.length}
            overdue={overdueCount}
            todayScheduled={todayScheduledCount}
            hotUncalled={hotFillCount}
            onOpenAIGenerate={openAIGenerate}
            onOpenLead={(l) => setActive(l)}
            onJumpToPipeline={() => setView("pipeline")}
          />
        )}
        {view === "hot" && (
          <SectionHeader label="Hot, Not Called" count={hotLeads.length} />
        )}
        {view === "followups" && (
          <SectionHeader label="Follow-ups Due" count={followupLeads.length} />
        )}
        {view === "pipeline" && (
          <SectionHeader label="Pipeline" count={pipelineLeads.length} />
        )}
        {view === "all" && (
          <SectionHeader label="All Leads" count={allFiltered.length} />
        )}

        {view === "today" && (
          <TodayView items={todayItems} onStartCall={setCallLead} />
        )}
        {view === "hot" && (
          <QueueView
            leads={hotLeads}
            presorted
            title="Hot, not called"
            emptyMessage="— no high-quality leads waiting — nice work —"
            onStartCall={setCallLead}
          />
        )}
        {view === "followups" && (
          <QueueView
            leads={followupLeads}
            presorted
            title="Follow-ups due"
            emptyMessage="— no follow-ups due today — you're caught up —"
            onStartCall={setCallLead}
          />
        )}
        {view === "pipeline" && (
          <QueueView
            leads={pipelineLeads}
            presorted
            title="Pipeline"
            emptyMessage="— no leads currently in your pipeline —"
            onStartCall={setCallLead}
          />
        )}
        {view === "all" && (
          <LeadTable
            leads={allFiltered}
            selected={selected}
            toggleSelect={toggleSelect}
            toggleAll={toggleAll}
            onView={setActive}
            onStatusChange={(id, s) => setStatus(id, s)}
            onCall={setCallLead}
          />
        )}
        {view === "analytics" && <AnalyticsView leads={leads} />}

        <footer className="border-t border-border pt-8 mt-16">
          <BotanicalDivider className="mb-6" />
          <div className="mono text-muted-foreground text-center">
            FACEBOOK-ONLY BUSINESSES ARE OFTEN STRONG WEBSITE PROSPECTS — KEEP GOING
          </div>
        </footer>
      </main>

      <LeadDetail lead={active} onClose={() => setActive(null)} onStartCall={setCallLead} />
      <CallAssistant lead={callLead} onClose={() => setCallLead(null)} />
        <AIGenerateModal
          open={aiOpen}
          onClose={() => {
            setAiOpen(false);
            setAiPrefill({});
          }}
          initialIndustry={aiPrefill.industry}
          initialCity={aiPrefill.city}
        />
      <AddLeadSheet open={addOpen} onOpenChange={setAddOpen} />
      <BulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        onStatus={(s) => { bulkSetStatus(Array.from(selected), s); setSelected(new Set()); }}
        onDelete={() => { bulkDelete(Array.from(selected)); setSelected(new Set()); }}
        onExport={() => { exportCSV(leads.filter((l) => selected.has(l.id))); }}
      />
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="border-b-2 border-foreground/60 pb-2 flex items-baseline justify-between">
      <div className="mono text-foreground">{label.toUpperCase()}</div>
      <div className="mono text-muted-foreground">— {String(count).padStart(3, "0")}</div>
    </div>
  );
}
