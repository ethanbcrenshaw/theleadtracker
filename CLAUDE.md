# Lead Bloom (theleadtracker)

CRM for finding local businesses that need websites. Single-user app: discover leads
via Google Places, enrich/verify them with Firecrawl + AI, work the call list.
Originally built on Lovable; database now lives in a self-managed Supabase project.

## Stack

- **TanStack Start** (React 19, file-based routes) + Vite 7 + Tailwind 4 + shadcn/ui
- **Supabase** Postgres via `@supabase/supabase-js` (new `sb_publishable_`/`sb_secret_` key format)
- **Zustand** for client state, **Cloudflare Workers** build target (`wrangler.jsonc`)
- Dev: `npm run dev` (port 8080; in sandboxes pass `-- --host 127.0.0.1`, IPv6 is unsupported there)
- Lint/format: `npm run lint`, `npm run format`. TS check: `npx tsc --noEmit`

## Environment (.env — gitignored, see .env.example)

- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (+ `VITE_`-prefixed copies for the client bundle)
- `SUPABASE_SERVICE_ROLE_KEY` — server-only admin client (`client.server.ts`)
- `GOOGLE_PLACES_API_KEY` — lead discovery
- `FIRECRAWL_API_KEY` — enrichment/verification scraping
- AI provider (first match wins — see `src/lib/ai.server.ts`): `ANTHROPIC_API_KEY`
  (Claude via official SDK, default model `claude-opus-4-8`), `GEMINI_API_KEY`
  (Google OpenAI-compat endpoint), or `LOVABLE_API_KEY` (Lovable gateway; injected
  automatically on Lovable-hosted deploys). Used by assistant, call scripts, daily
  brief, call summaries, pitch angles.

## Database (Supabase project `bldyruumvdaxuplcnacz`, ca-central-1)

Two tables, schema in `supabase/migrations/` (replay in filename order on a fresh project):

- **`leads`** — one row per business. Column names are quoted camelCase mirroring the
  `Lead` type exactly (`websiteOpportunity`, `nextFollowUp`, …). JSONB columns:
  `sources`, `tags`, `history`, `callRecords`, `confidenceEvidence`, `enrichment`,
  `callScript`, `verificationReasons`. Soft delete via `deleted_at` (timestamptz, indexed).
- **`assistant_messages`** — AI assistant chat history.

RLS is intentionally open ("single-user CRM" policy: full access for `anon` +
`authenticated`). Anyone with the publishable key can read/write. There is no real auth;
`auth-middleware.ts` / `auth-attacher.ts` exist (Lovable-generated) but leads access
doesn't use them.

**Soft vs hard delete:** the assistant's bulk actions set `deleted_at` (recoverable;
`assistant.ts` has an undo that clears it), but the UI store's `bulkDelete` does a HARD
`DELETE`. All read paths filter `.is("deleted_at", null)`.

## Architecture map

### Client state — `src/lib/store.ts`
`useLeads` Zustand store. Auto-hydrates on module load from Supabase
(`select * where deleted_at is null order by priority`); falls back to localStorage
(`lead-mgmt-v1`) then bundled seed (`src/data/seed.ts`) if the DB is empty/unreachable.
All mutations are optimistic: update local state, then fire-and-forget the DB write
(`dbUpdateOne`/`dbUpsertMany`/…; errors only console.log). Row<->Lead mapping lives here
(`rowToLead`/`leadToRow` — null↔undefined fix-ups). `quality` is always derived from
`websiteOpportunity` via `qualityFromOpportunity` (`crm-utils.ts`), never stored raw.

### Domain types — `src/lib/types.ts`
`Lead`, `LeadStatus`, `WebsiteOpportunity`, `LeadEnrichment`, `CallRecord`, `CallScript`,
`VerificationTier` ("verified" | "partial" | "unverified"). The DB types in
`src/integrations/supabase/types.ts` are generated — regenerate rather than hand-edit.

### Supabase integration — `src/integrations/supabase/`
- `client.ts` — browser client (publishable key, localStorage session)
- `client.server.ts` — lazy admin client (service role, bypasses RLS). Import only
  inside server handlers/`.server.ts` modules
- `types.ts` — generated DB types (currently referenced loosely in store.ts via `as any`)

### Lead discovery (Google Places)
- `src/routes/api/generate-leads.ts` — POST { industry, city, count, type }. Text-search
  (≤3 pages), classifies each place's `websiteUri` into `WebsiteOpportunity` buckets
  (none / social-only / directory-only / has-website), returns raw candidates FAST.
  Enrichment deliberately does NOT happen here.
- `src/lib/discover.server.ts` — same Places search extracted for reuse by the assistant.
- `src/components/crm/AIGenerateModal.tsx` — drives the flow: calls generate-leads, then
  enriches candidates one-by-one via `/api/enrich-candidate` for per-lead progress UI.

### Verification checks (Phase 2 pipeline)
- `src/lib/verification.server.ts` — post-discovery check pass: website liveness
  (live/dead/parked/redirect-social/none, ≤3 redirect hops, 5s timeouts), freshness
  heuristics (copyright year, viewport meta, HTTPS), business-alive signals passed
  through from Places (status/rating/review count/last review), and the composite
  0-100 `leadScore` (`computeLeadScore`). Results persist as `leads.verification`
  (jsonb) + `leads.leadScore` (int, indexed). CLOSED businesses are discarded at
  discovery (`isClosed` in discover.server.ts). Re-verify paths carry business
  signals over from the last stored check (no fresh Places call).
- UI: `VerificationFacts` block in LeadDetail's Dossier; SCORE chip in
  AIGenerateModal review rows.

### AI provider layer
- `src/lib/ai.server.ts` — provider-agnostic chat (`getAI`, `aiChat`, `aiText`,
  `aiExtract`). Anthropic branch uses the official `@anthropic-ai/sdk` (native
  Messages API, tools mapped from the normalized OpenAI-flavored shape); Gemini and
  Lovable use their OpenAI-compatible endpoints. All AI routes go through this.

### Enrichment & verification (Firecrawl + AI)
- `src/lib/enrichment.server.ts` — the pipeline (`enrichLeadFull`): Firecrawl search +
  profile scrape, website liveness check (`verifyWebsiteAlive`), staleness heuristics
  (copyright year, viewport meta — `isBodyOutdated`), closure detection, name/phone/city
  cross-checks, pitch-angle generation via Lovable AI. Produces `LeadEnrichment` +
  `confidenceScore`/`verificationTier`/`verificationReasons`. Hard timeouts per step
  (7–12s). `runWithConcurrency` helper at the bottom.
- `src/routes/api/enrich-candidate.ts` — enrich a not-yet-saved candidate (generate flow)
- `src/routes/api/enrich-lead.ts` — re-enrich a saved lead by id (used by re-verify)
- `src/components/crm/ReverifyButton.tsx` — bulk re-verify all leads, 3-way concurrency,
  per-lead progress + summary chips. EXTEND THIS for verification UI work, don't duplicate.

### AI assistant & coaching (all via Lovable AI gateway)
- `src/routes/api/assistant.ts` — chat assistant with tool-calling over the lead book
  (uses service-role client; soft-deletes; has undo-recent-deletes)
- `src/routes/api/assistant-execute.ts` — executes confirmed bulk actions
- `src/routes/api/call-script.ts`, `daily-brief.ts`, `summarize-call.ts`
- `src/components/crm/AssistantPanel.tsx`, `CallAssistant.tsx` (transcript import only),
  `DailyBriefing.tsx`

### MCP server (app exposes its own agent tools)
- `src/routes/mcp.ts`, `src/routes/[.mcp]/*`, `src/lib/mcp/` — MCP endpoint + tools
  (list/search/get leads, update status, add note, schedule follow-up, follow-ups due).
  Uses the publishable-key client (`src/lib/mcp/supabase.ts`).

### UI
- `src/routes/index.tsx` — the whole dashboard (tabs: Today / Hot / Follow-ups /
  Pipeline / All / Analytics). Views in `src/components/crm/` (LeadTable, LeadDetail,
  KanbanView, FollowUpView, QueueView, TodayView, AnalyticsView, …).
- Aesthetic: editorial/typewriter style, mono labels in `[ BRACKETS ]`.

## Conventions & gotchas

- DB writes from the UI are fire-and-forget — check the browser console for `[leads]` errors.
- `leads.id` is TEXT (mixed UUIDs and legacy slug ids like `l1`), not a UUID column.
- Dates are mostly ISO strings in TEXT columns (`lastContacted`, `nextFollowUp`, `zoomDate`).
- Don't add duplicate Vite plugins — `@lovable.dev/vite-tanstack-config` already bundles
  tanstackStart/react/tailwind/paths/cloudflare (see vite.config.ts comment).
- Never commit `.env`, the service-role key, or the DB password. `.env.example` is the
  template. The old committed Lovable Cloud anon key (project `hdigjlfqhbsajjlbzuqh`)
  in git history is dead — that project is being decommissioned.
- Schema changes: add a new file to `supabase/migrations/` (timestamp prefix) and apply
  it to the live project (Postgres wire protocol may be blocked in sandboxes; the
  Supabase Management API `POST /v1/projects/{ref}/database/query` works over HTTPS).
