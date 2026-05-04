import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Sparkles, Download, Plus, Table2, Columns3, CalendarClock, Target } from "lucide-react";
import { useLeads } from "@/lib/store";
import { exportCSV } from "@/lib/crm-utils";
import { StatsCards } from "@/components/crm/StatsCards";
import { Filters, type FilterState } from "@/components/crm/Filters";
import { LeadTable } from "@/components/crm/LeadTable";
import { LeadDetail } from "@/components/crm/LeadDetail";
import { KanbanView } from "@/components/crm/KanbanView";
import { FollowUpView } from "@/components/crm/FollowUpView";
import { OpportunitiesView } from "@/components/crm/OpportunitiesView";
import { AIGenerateModal } from "@/components/crm/AIGenerateModal";
import { BulkBar } from "@/components/crm/BulkBar";
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
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap" },
    ],
  }),
  component: Dashboard,
});

type View = "table" | "kanban" | "followup" | "opportunities";

function Dashboard() {
  const leads = useLeads((s) => s.leads);
  const setStatus = useLeads((s) => s.setStatus);
  const bulkSetStatus = useLeads((s) => s.bulkSetStatus);
  const bulkSetQuality = useLeads((s) => s.bulkSetQuality);
  const bulkDelete = useLeads((s) => s.bulkDelete);

  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("table");
  const [active, setActive] = useState<Lead | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterState>({
    city: "All", quality: "All", status: "All", opportunity: "All", source: "All",
  });

  const cities = useMemo(
    () => Array.from(new Set(leads.map((l) => l.city))).sort(),
    [leads]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return leads.filter((l) => {
      if (q && !`${l.business} ${l.city} ${l.phone} ${l.notes}`.toLowerCase().includes(q)) return false;
      if (filters.city !== "All" && l.city !== filters.city) return false;
      if (filters.quality !== "All" && l.quality !== filters.quality) return false;
      if (filters.status !== "All" && l.status !== filters.status) return false;
      if (filters.opportunity !== "All" && l.websiteOpportunity !== filters.opportunity) return false;
      if (filters.source !== "All" && !l.sources.includes(filters.source)) return false;
      return true;
    }).sort((a, b) => a.priority - b.priority);
  }, [leads, search, filters]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) =>
      filtered.every((l) => prev.has(l.id)) ? new Set() : new Set(filtered.map((l) => l.id))
    );
  };

  const tabs: { id: View; label: string; icon: typeof Table2 }[] = [
    { id: "table", label: "Table", icon: Table2 },
    { id: "kanban", label: "Kanban", icon: Columns3 },
    { id: "followup", label: "Follow-Up", icon: CalendarClock },
    { id: "opportunities", label: "Opportunities", icon: Target },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-gradient-to-b from-tan/15 to-transparent">
        <div className="max-w-[1500px] mx-auto px-6 py-7">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-tan-foreground/80 mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-tan" />
                CRM · Local Business Outreach
              </div>
              <h1 className="font-display text-4xl sm:text-5xl font-medium text-foreground">
                Lead Management
              </h1>
              <p className="mt-2 text-muted-foreground max-w-xl">
                Track, prioritize, and follow up with local business leads.
                <span className="italic"> Start with your highest-opportunity leads.</span>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search business, city, phone…"
                  className="pl-9 pr-3 py-2 rounded-xl bg-card border border-border text-sm w-72 focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
              </div>
              <button onClick={() => setAiOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-br from-navy to-[oklch(0.32_0.07_265)] text-navy-foreground text-sm font-medium shadow-soft hover:shadow-elev">
                <Sparkles className="h-4 w-4" /> Generate Leads with AI
              </button>
              <button onClick={() => exportCSV(filtered)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border text-sm font-medium hover:bg-secondary">
                <Download className="h-4 w-4" /> Export CSV
              </button>
              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-tan text-tan-foreground text-sm font-medium hover:opacity-90"
                onClick={() => alert("Add Lead form coming soon — for now use AI Generate.")}>
                <Plus className="h-4 w-4" /> Add Lead
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-6 py-6 space-y-5">
        <StatsCards leads={leads} />
        <Filters filters={filters} setFilters={setFilters} cities={cities} />

        {/* Tabs */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex p-1 rounded-2xl bg-card border border-border shadow-soft">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  view === t.id
                    ? "bg-navy text-navy-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground">{filtered.length}</span> of {leads.length} leads
          </div>
        </div>

        {view === "table" && (
          <LeadTable
            leads={filtered}
            selected={selected}
            toggleSelect={toggleSelect}
            toggleAll={toggleAll}
            onView={setActive}
            onStatusChange={(id, s) => setStatus(id, s)}
          />
        )}
        {view === "kanban" && <KanbanView leads={filtered} onView={setActive} />}
        {view === "followup" && <FollowUpView leads={filtered} onView={setActive} />}
        {view === "opportunities" && <OpportunitiesView leads={filtered} onView={setActive} />}

        <footer className="text-center text-xs text-muted-foreground py-8 italic">
          Facebook-only businesses are often strong website prospects. Keep going. ✦
        </footer>
      </main>

      <LeadDetail lead={active} onClose={() => setActive(null)} />
      <AIGenerateModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <BulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        onStatus={(s) => { bulkSetStatus(Array.from(selected), s); setSelected(new Set()); }}
        onQuality={(q) => { bulkSetQuality(Array.from(selected), q); setSelected(new Set()); }}
        onDelete={() => { if (confirm(`Delete ${selected.size} leads?`)) { bulkDelete(Array.from(selected)); setSelected(new Set()); } }}
        onExport={() => { exportCSV(leads.filter((l) => selected.has(l.id))); }}
      />
    </div>
  );
}
