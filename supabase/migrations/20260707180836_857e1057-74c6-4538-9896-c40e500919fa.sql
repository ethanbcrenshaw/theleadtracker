ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS "verificationTier" text,
  ADD COLUMN IF NOT EXISTS "verificationReasons" jsonb NOT NULL DEFAULT '[]'::jsonb;