-- Phase 2: lead verification pipeline.
-- `verification` stores the structured results of the automated check pass
-- (website liveness/freshness, business-alive signals, checkedAt timestamp);
-- `leadScore` is the composite 0-100 opportunity score used for ordering.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS "leadScore" integer,
  ADD COLUMN IF NOT EXISTS "verification" jsonb;

CREATE INDEX IF NOT EXISTS leads_lead_score_idx ON public.leads ("leadScore" DESC NULLS LAST);
