import type { Quality, LeadStatus, WebsiteOpportunity, LeadSource } from "@/lib/types";
import { STATUSES, QUALITIES, OPPORTUNITIES, SOURCES } from "@/lib/crm-utils";

export interface FilterState {
  city: string;
  quality: Quality | "All";
  status: LeadStatus | "All";
  opportunity: WebsiteOpportunity | "All";
  source: LeadSource | "All";
}

interface Props {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  cities: string[];
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
        active
          ? "bg-navy text-navy-foreground border-navy shadow-soft"
          : "bg-card text-muted-foreground border-border hover:border-navy/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 mr-1">
        {label}
      </span>
      {children}
    </div>
  );
}

export function Filters({ filters, setFilters, cities }: Props) {
  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-soft space-y-3">
      <Group label="City">
        <Chip active={filters.city === "All"} onClick={() => setFilters({ ...filters, city: "All" })}>
          All Cities
        </Chip>
        {cities.map((c) => (
          <Chip key={c} active={filters.city === c} onClick={() => setFilters({ ...filters, city: c })}>
            {c}
          </Chip>
        ))}
      </Group>
      <Group label="Quality">
        <Chip active={filters.quality === "All"} onClick={() => setFilters({ ...filters, quality: "All" })}>All</Chip>
        {QUALITIES.map((q) => (
          <Chip key={q} active={filters.quality === q} onClick={() => setFilters({ ...filters, quality: q })}>{q}</Chip>
        ))}
      </Group>
      <Group label="Status">
        <Chip active={filters.status === "All"} onClick={() => setFilters({ ...filters, status: "All" })}>All</Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={filters.status === s} onClick={() => setFilters({ ...filters, status: s })}>{s}</Chip>
        ))}
      </Group>
      <Group label="Website Opportunity">
        <Chip active={filters.opportunity === "All"} onClick={() => setFilters({ ...filters, opportunity: "All" })}>All</Chip>
        {OPPORTUNITIES.map((o) => (
          <Chip key={o} active={filters.opportunity === o} onClick={() => setFilters({ ...filters, opportunity: o })}>{o}</Chip>
        ))}
      </Group>
      <Group label="Lead Source">
        <Chip active={filters.source === "All"} onClick={() => setFilters({ ...filters, source: "All" })}>All</Chip>
        {SOURCES.map((s) => (
          <Chip key={s} active={filters.source === s} onClick={() => setFilters({ ...filters, source: s })}>{s}</Chip>
        ))}
      </Group>
    </div>
  );
}
