-- Furniture/Upholstery lead scoring spec. leadScore (int, 0-100) already
-- exists; add the tier + auditable per-criterion breakdown.
alter table public.leads
  add column if not exists "leadTier" text,
  add column if not exists "scoreBreakdown" jsonb;

create index if not exists leads_lead_tier_idx on public.leads ("leadTier");
