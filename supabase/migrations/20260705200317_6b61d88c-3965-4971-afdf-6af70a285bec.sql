
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS "confidenceScore" integer,
  ADD COLUMN IF NOT EXISTS "confidenceEvidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "unverified" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "unverifiedReason" text,
  ADD COLUMN IF NOT EXISTS "enrichment" jsonb;
