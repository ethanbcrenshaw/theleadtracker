import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Sparkles, Download, Plus } from "lucide-react";
import { useLeads } from "@/lib/store";
import { exportCSV, isValidContactDate } from "@/lib/crm-utils";
import { StatsCards } from "@/components/crm/StatsCards";
import { Filters, type FilterState } from "@/components/crm/Filters";
import { LeadTable, qualityRank, statusRank } from "@/components/crm/LeadTable";
import { LeadDetail } from "@/components/crm/LeadDetail";
import { QueueView } from "@/components/crm/QueueView";
import { SavedViewPills, type SavedView } from "@/components/crm/SavedViewPills";
import { AnalyticsView } from "@/components/crm/AnalyticsView";
import { AIGenerateModal } from "@/components/crm/AIGenerateModal";
import { BulkBar } from "@/components/crm/BulkBar";
import { CallAssistant } from "@/components/crm/CallAssistant";
import type { Lead } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lead Management — Local Business CRM" },
      { name: "description", content: "Track, prioritize, and follow up with local business leads. A warm, human CRM for solo web designers and small agencies." },
      { property: "og:title", content: "Lead Management — Local Business CRM" },
      { property: "og:description", content: "Track, prioritize, and follow up with local business leads." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700&display=swap" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const leads = useLeads((s) => s.leads);
  const setStatus = useLeads((s) => s.setStatus);
  const bulkSetStatus = useLeads((s) => s.bulkSetStatus);
  const bulkDelete = useLeads((s) => s.bulkDelete);

  const [search, setSearch] = useState("");
  const [view, setView] = useState<SavedView>("hot");
  const [active, setActive] = useState<Lead | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [callLead, setCallLead] = useState<Lead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterState>({
    city: "All", quality: "All", status: "All", opportunity: "All", source: "All",
  });

  const cities = useMemo(
    () => Array.from(new Set(leads.map((l) => l.city))).sort(),
    [leads]
  );

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
      return true;
    });
  }, [searched, filters]);

  const counts = {
    hot: hotLeads.length,
    followups: followupLeads.length,
    pipeline: pipelineLeads.length,
    all: allFiltered.length,
  };

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
      {/* Header */}
      <header className="border-b border-border bg-gradient-to-b from-maroon/[0.04] via-background to-transparent">
        <div className="max-w-[1500px] mx-auto px-8 py-12">
          <div className="flex items-start justify-between flex-wrap gap-6">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-maroon mb-4">
                <span className="h-1.5 w-1.5 rounded-full bg-maroon" />
                CRM · Local Business Outreach
              </div>
              <h1 className="font-display text-5xl sm:text-6xl font-medium text-navy tracking-tight">
                Lead Management
              </h1>
              <p className="mt-4 text-muted-foreground max-w-xl leading-relaxed">
                Track, prioritize, and follow up with local business leads.
                <span className="italic"> Start with your highest-opportunity leads.</span>
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => setAiOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-br from-navy to-[oklch(0.30_0.08_265)] text-navy-foreground text-sm font-medium shadow-soft hover:shadow-elev transition-shadow">
                <Sparkles className="h-4 w-4" /> Generate Leads with AI
              </button>
              <button onClick={() => exportCSV(allFiltered)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-card border border-border text-sm font-medium hover:bg-secondary transition-colors">
                <Download className="h-4 w-4" /> Export CSV
              </button>
              <button
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-maroon text-maroon-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                onClick={() => alert("Add Lead form coming soon — for now use AI Generate.")}>
                <Plus className="h-4 w-4" /> Add Lead
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-8 py-10 space-y-8">
        <StatsCards leads={leads} />

        <div className="space-y-4">
          <SavedViewPills view={view} setView={setView} counts={counts} />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search business or city…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            {view !== "analytics" && (
              <div className="text-xs text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {view === "hot"
                    ? hotLeads.length
                    : view === "followups"
                      ? followupLeads.length
                      : view === "pipeline"
                        ? pipelineLeads.length
                        : allFiltered.length}
                </span>{" "}
                of {leads.length} leads
              </div>
            )}
          </div>

          {view === "all" && (
            <Filters filters={filters} setFilters={setFilters} cities={cities} />
          )}
        </div>

        {view === "hot" && (
          <QueueView
            leads={hotLeads}
            presorted
            title="Hot, not called"
            emptyMessage="No high-quality leads waiting to be called. Nice work."
            onStartCall={setCallLead}
          />
        )}
        {view === "followups" && (
          <QueueView
            leads={followupLeads}
            presorted
            title="Follow-ups due"
            emptyMessage="No follow-ups due today. You're caught up."
            onStartCall={setCallLead}
          />
        )}
        {view === "pipeline" && (
          <QueueView
            leads={pipelineLeads}
            presorted
            title="Pipeline"
            emptyMessage="No leads currently in your pipeline."
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

        <footer className="text-center text-sm text-muted-foreground py-12 italic font-display">
          Facebook-only businesses are often strong website prospects. Keep going. ✦
        </footer>
      </main>

      <LeadDetail lead={active} onClose={() => setActive(null)} onStartCall={setCallLead} />
      <CallAssistant lead={callLead} onClose={() => setCallLead(null)} />
      <AIGenerateModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <BulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        onStatus={(s) => { bulkSetStatus(Array.from(selected), s); setSelected(new Set()); }}
        onDelete={() => { if (confirm(`Delete ${selected.size} leads?`)) { bulkDelete(Array.from(selected)); setSelected(new Set()); } }}
        onExport={() => { exportCSV(leads.filter((l) => selected.has(l.id))); }}
      />
    </div>
  );
}
