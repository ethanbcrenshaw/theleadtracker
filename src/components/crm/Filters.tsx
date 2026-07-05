import type { Quality, LeadStatus, WebsiteOpportunity, LeadSource } from "@/lib/types";
import { STATUSES, QUALITIES, OPPORTUNITIES, SOURCES } from "@/lib/crm-utils";
import { TagBadge } from "./Badges";

export interface FilterState {
  city: string;
  quality: Quality | "All";
  status: LeadStatus | "All";
  opportunity: WebsiteOpportunity | "All";
  source: LeadSource | "All";
  tags: string[];
}

export const EMPTY_FILTERS: FilterState = {
  city: "All", quality: "All", status: "All", opportunity: "All", source: "All", tags: [],
};

interface Props {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  cities: string[];
  tags: string[];
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`mono px-2.5 py-1 border transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
      }`}
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="mono text-muted-foreground min-w-[110px]">— {label}</span>
      {children}
    </div>
  );
}

export function Filters({ filters, setFilters, cities, tags }: Props) {
  const toggleTag = (t: string) => {
    const next = filters.tags.includes(t)
      ? filters.tags.filter((x) => x !== t)
      : [...filters.tags, t];
    setFilters({ ...filters, tags: next });
  };

  return (
    <div className="border border-border p-5 space-y-3 bg-card">
      {tags.length > 0 && (
        <Group label="Tags">
          {tags.map((t) => (
            <TagBadge key={t} label={t} active={filters.tags.includes(t)} onClick={() => toggleTag(t)} />
          ))}
        </Group>
      )}
      <Group label="City">
        <Chip active={filters.city === "All"} onClick={() => setFilters({ ...filters, city: "All" })}>
          All
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
      <Group label="Opportunity">
        <Chip active={filters.opportunity === "All"} onClick={() => setFilters({ ...filters, opportunity: "All" })}>All</Chip>
        {OPPORTUNITIES.map((o) => (
          <Chip key={o} active={filters.opportunity === o} onClick={() => setFilters({ ...filters, opportunity: o })}>{o}</Chip>
        ))}
      </Group>
      <Group label="Source">
        <Chip active={filters.source === "All"} onClick={() => setFilters({ ...filters, source: "All" })}>All</Chip>
        {SOURCES.map((s) => (
          <Chip key={s} active={filters.source === s} onClick={() => setFilters({ ...filters, source: s })}>{s}</Chip>
        ))}
      </Group>
    </div>
  );
}
