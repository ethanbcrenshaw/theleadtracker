-- Multi-source discovery provenance: which discovery sources found each lead
-- (e.g. ["places","firecrawl-search"]). Lets source quality be tracked
-- against leads that actually close.
alter table public.leads
  add column if not exists "foundVia" jsonb;
