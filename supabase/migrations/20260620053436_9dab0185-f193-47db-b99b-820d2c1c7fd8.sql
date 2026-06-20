
CREATE TABLE public.leads (
  id TEXT PRIMARY KEY,
  priority INTEGER NOT NULL DEFAULT 0,
  business TEXT NOT NULL DEFAULT '',
  owner TEXT,
  "ownerSource" TEXT,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  "onlinePresence" TEXT NOT NULL DEFAULT '',
  "websiteOpportunity" TEXT NOT NULL DEFAULT 'No Dedicated Website',
  quality TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Not Called',
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  "lastContacted" TEXT,
  "nextFollowUp" TEXT,
  notes TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  "ownerNote" TEXT,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  "callRecords" JSONB,
  "aiSummary" TEXT,
  "aiNextAction" TEXT,
  "zoomBooked" BOOLEAN,
  "zoomDate" TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open access — single-user CRM" ON public.leads
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
