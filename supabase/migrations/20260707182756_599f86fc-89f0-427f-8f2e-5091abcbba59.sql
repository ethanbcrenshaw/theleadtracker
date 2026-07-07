
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS leads_deleted_at_idx ON public.leads (deleted_at);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  content text not null default '',
  tool_calls jsonb,
  tool_results jsonb,
  pending_action jsonb,
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_messages TO anon, authenticated;
GRANT ALL ON public.assistant_messages TO service_role;

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open access — single-user assistant"
ON public.assistant_messages
FOR ALL
TO anon, authenticated
USING (true) WITH CHECK (true);
