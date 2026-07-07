import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { enrichLeadFull, hostOf, runWithConcurrency } from "@/lib/enrichment.server";
import { discoverCandidates } from "@/lib/discover.server";

const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-pro";
const MAX_STEPS = 6;
const BULK_CONFIRM_THRESHOLD = 5;

// ─── Tool schemas ────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_leads",
      description: "Read leads from the CRM. Filter and count. Use for questions like 'how many verified roofers', 'what's stale', 'show me my hot leads'. Never invents data.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["Not Called","Called","Voicemail","Callback Scheduled","Zoom Booked","Sold","Not Interested"] },
          tier: { type: "string", enum: ["verified","partial","unverified"] },
          quality: { type: "string", enum: ["High","Medium","Low"] },
          city: { type: "string" },
          industry_or_segment: { type: "string", description: "Free-text match against business name/notes/tags — used to find e.g. 'roofers' or 'salons'." },
          stale_days: { type: "number", description: "Only return leads not touched (lastContacted OR created_at) in >= this many days." },
          limit: { type: "number", description: "Max rows to return in the sample (default 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_leads",
      description: "Discover + verify new local business leads via Google Places + Firecrawl. Imports ONLY verified leads by default. Slow (30-90s per lead). Use small counts (3-10).",
      parameters: {
        type: "object",
        properties: {
          industry: { type: "string" },
          city: { type: "string", description: "e.g. 'Franklin, TN'" },
          count: { type: "number", description: "3-15" },
          type: { type: "string", enum: ["No Dedicated Website","Facebook Only","Yelp/Directory Only","Outdated Website","Social-Heavy","Has Website"] },
          include_partial: { type: "boolean", description: "Also import partial-tier candidates. Default false." },
        },
        required: ["industry","city","count"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_leads",
      description: "Bulk update status / nextFollowUp / tags on filtered leads. If >5 leads match, returns a confirmation card (does NOT execute).",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "object",
            properties: {
              status: { type: "string" },
              tier: { type: "string" },
              city: { type: "string" },
              industry_or_segment: { type: "string" },
            },
          },
          changes: {
            type: "object",
            properties: {
              status: { type: "string" },
              nextFollowUp: { type: "string", description: "ISO date (yyyy-mm-dd) or plain like 'next Monday' — pass ISO if possible." },
              addTag: { type: "string" },
            },
          },
        },
        required: ["filter","changes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reverify_leads",
      description: "Re-run the hardened verification pipeline over a filtered scope. Reports how many became verified / partial / unverified.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["all","partial","unverified","filtered"] },
          filter: {
            type: "object",
            properties: { city: { type: "string" }, industry_or_segment: { type: "string" } },
          },
          limit: { type: "number", description: "Cap on how many to re-verify in one pass. Default 20, max 50." },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_leads",
      description: "Soft-delete filtered leads. NEVER auto-executes: always returns a confirmation card. If the user wants to scrap ALL leads, set scope='all' — the client will require a typed DELETE ALL confirmation.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["all","unverified","partial","filtered"] },
          filter: {
            type: "object",
            properties: {
              status: { type: "string" },
              city: { type: "string" },
              industry_or_segment: { type: "string" },
            },
          },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_leads",
      description: "Undo a recent soft-delete. Restores leads deleted within the last hour, optionally filtered.",
      parameters: {
        type: "object",
        properties: {
          within_minutes: { type: "number", description: "Only restore rows deleted within N minutes. Default 60." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "market_research",
      description: "Web research about a local market (segments, density, opportunity). NOT verified lead data. Returns a short sourced brief.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
          business_type: { type: "string" },
          question: { type: "string", description: "What the user actually wants to know." },
        },
        required: ["location"],
      },
    },
  },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────
type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type PendingAction =
  | { kind: "delete"; scope: string; filter?: Record<string, unknown>; ids: string[]; requireTyped?: boolean; preview: string }
  | { kind: "update"; ids: string[]; changes: Record<string, unknown>; preview: string };

type StepEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown>; label: string }
  | { type: "tool_result"; name: string; label: string; ok: boolean; summary: string };

type Body = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

function normalizeName(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;
function makeSb(): Sb {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ─── Filtering (used by query, update, delete, reverify) ─────────────────────
type LeadRow = Record<string, unknown> & {
  id: string; business: string; city: string; phone: string; status: string;
  quality: string; websiteOpportunity: string; verificationTier: string | null;
  tags: string[] | null; notes: string | null;
  lastContacted: string | null; nextFollowUp: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
};

async function fetchLeads(sb: Sb, opts: {
  status?: string; tier?: string; quality?: string; city?: string;
  industry_or_segment?: string; stale_days?: number; scope?: string;
}): Promise<LeadRow[]> {
  let q = sb.from("leads").select("*").is("deleted_at", null);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.quality) q = q.eq("quality", opts.quality);
  if (opts.city) q = q.ilike("city", `%${opts.city}%`);
  if (opts.tier) q = q.eq("verificationTier", opts.tier);
  if (opts.scope === "partial") q = q.eq("verificationTier", "partial");
  if (opts.scope === "unverified") q = q.eq("verificationTier", "unverified");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = (data as unknown as LeadRow[]) ?? [];
  if (opts.industry_or_segment) {
    const needle = opts.industry_or_segment.toLowerCase();
    rows = rows.filter((r) => {
      const hay = `${r.business ?? ""} ${(r.tags ?? []).join(" ")} ${r.notes ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }
  if (opts.stale_days != null) {
    const cutoff = Date.now() - opts.stale_days * 86400000;
    rows = rows.filter((r) => {
      const t = r.lastContacted ? new Date(r.lastContacted).getTime()
        : r.created_at ? new Date(r.created_at).getTime() : 0;
      return t > 0 && t < cutoff;
    });
  }
  return rows;
}

// ─── Tool executor ───────────────────────────────────────────────────────────
async function executeTool(
  name: string, args: Record<string, unknown>, deps: { sb: Sb; origin: string },
): Promise<{ result: unknown; label: string; summary: string; pending?: PendingAction }> {
  const sb = deps.sb;

  if (name === "query_leads") {
    const rows = await fetchLeads(sb, args as Parameters<typeof fetchLeads>[1]);
    const limit = Math.min(Number(args.limit ?? 20), 50);
    const sample = rows.slice(0, limit).map((r) => ({
      business: r.business, city: r.city, status: r.status, tier: r.verificationTier,
      quality: r.quality, phone: r.phone, lastContacted: r.lastContacted,
    }));
    const label = `→ querying leads (${describeFilter(args)})`;
    const summary = `found ${rows.length} lead${rows.length === 1 ? "" : "s"}`;
    return { result: { count: rows.length, sample }, label, summary };
  }

  if (name === "market_research") {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) return { result: { error: "Firecrawl not configured" }, label: "→ market research", summary: "Firecrawl not configured" };
    const q = `${args.business_type ? args.business_type + " " : ""}${args.location} local businesses market ${args.question ?? ""}`.trim();
    const items = await firecrawlSearch(q, firecrawlKey);
    const brief = items.slice(0, 6).map((i) => ({ title: i.title, url: i.url, snippet: (i.description || "").slice(0, 300) }));
    return {
      result: { query: q, sources: brief },
      label: `→ researching ${args.location}${args.business_type ? " · " + args.business_type : ""}`,
      summary: `pulled ${brief.length} source${brief.length === 1 ? "" : "s"}`,
    };
  }

  if (name === "generate_leads") {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    const aiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey || !firecrawlKey) return { result: { error: "Missing API keys" }, label: "→ generate_leads", summary: "config missing" };
    const industry = String(args.industry);
    const city = String(args.city);
    const count = Math.max(1, Math.min(15, Number(args.count) || 5));
    const type = String(args.type || "No Dedicated Website");
    const includePartial = Boolean(args.include_partial);
    const label = `→ generating ${count} ${industry} leads in ${city}…`;

    const candidates = await discoverCandidates({ industry, city, count, type, apiKey });
    // Skip existing (by phone + name).
    const { data: existing } = await sb.from("leads").select("business,phone").is("deleted_at", null);
    const seenNames = new Set((existing ?? []).map((l: { business?: string }) => normalizeName(l.business ?? "")));
    const seenPhones = new Set((existing ?? []).map((l: { phone?: string }) => (l.phone ?? "").replace(/\D/g, "")).filter(Boolean));
    const filtered = candidates.filter((c) => {
      if (seenNames.has(normalizeName(c.business))) return false;
      const ph = c.phone.replace(/\D/g, "");
      if (ph && seenPhones.has(ph)) return false;
      return true;
    }).slice(0, count);

    // Enrich each concurrently.
    const enriched: Array<{ cand: typeof filtered[number]; enr: Awaited<ReturnType<typeof enrichLeadFull>> | null }> = [];
    await runWithConcurrency(filtered, 3, async (cand) => {
      try {
        const enr = await enrichLeadFull({
          business: cand.business, city: cand.city, state: cand.state, phone: cand.phone,
          website: cand.website, websiteOpportunity: cand.websiteOpportunity,
        }, { firecrawlKey, aiKey });
        enriched.push({ cand, enr });
      } catch {
        enriched.push({ cand, enr: null });
      }
    });

    const toImport = enriched.filter(({ enr }) => enr && (enr.verificationTier === "verified" || (includePartial && enr.verificationTier === "partial")));
    let basePriority = 0;
    const { data: maxRow } = await sb.from("leads").select("priority").order("priority", { ascending: false }).limit(1);
    if (maxRow && maxRow[0]) basePriority = (maxRow[0] as { priority: number }).priority + 1;

    const rows = toImport.map(({ cand, enr }, i) => {
      const opp = enr!.enrichment.websiteStatus === "none" ? "No Dedicated Website"
        : enr!.enrichment.websiteStatus === "outdated" ? "Outdated Website"
        : cand.websiteOpportunity;
      const quality = opp === "Has Website" ? "Low" : opp === "Outdated Website" ? "Medium" : "High";
      return {
        id: crypto.randomUUID(),
        priority: basePriority + i,
        business: cand.business, city: cand.city, state: cand.state, phone: cand.phone,
        onlinePresence: cand.onlinePresence, websiteOpportunity: opp, quality,
        status: "Not Called", sources: cand.sources.length ? cand.sources : ["Other"],
        notes: cand.sourceUrl ? `Discovered via: ${cand.sourceUrl}` : "Discovered via AI assistant.",
        tags: ["ai-found", "assistant"],
        history: [], enrichment: enr!.enrichment,
        confidenceScore: enr!.confidenceScore, confidenceEvidence: enr!.confidenceEvidence,
        unverified: enr!.unverified, unverifiedReason: enr!.unverifiedReason ?? null,
        verificationTier: enr!.verificationTier, verificationReasons: enr!.verificationReasons,
      };
    });
    if (rows.length) {
      const { error } = await sb.from("leads").insert(rows);
      if (error) return { result: { error: error.message }, label, summary: `insert failed: ${error.message}` };
    }

    const verifiedN = enriched.filter((e) => e.enr?.verificationTier === "verified").length;
    const partialN = enriched.filter((e) => e.enr?.verificationTier === "partial").length;
    const unverifiedN = enriched.filter((e) => e.enr?.verificationTier === "unverified").length;
    const failedN = enriched.filter((e) => !e.enr).length;
    const summary = `discovered ${candidates.length}, deduped to ${filtered.length}, verified ${verifiedN} · partial ${partialN} · unverified ${unverifiedN}${failedN ? ` · errors ${failedN}` : ""} — imported ${rows.length}`;
    return {
      result: { imported: rows.length, verified: verifiedN, partial: partialN, unverified: unverifiedN, errors: failedN, sample: rows.slice(0, 5).map((r) => r.business) },
      label, summary,
    };
  }

  if (name === "reverify_leads") {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    const aiKey = process.env.LOVABLE_API_KEY;
    if (!firecrawlKey) return { result: { error: "Firecrawl not configured" }, label: "→ reverify", summary: "config missing" };
    const scope = String(args.scope);
    const filter = (args.filter as Record<string, string>) || {};
    const limit = Math.min(Number(args.limit ?? 20), 50);
    const rows = (await fetchLeads(sb, { ...filter, scope })).slice(0, limit);
    const label = `→ re-verifying ${rows.length} lead${rows.length === 1 ? "" : "s"}…`;
    let checked = 0, newlyFlagged = 0;
    await runWithConcurrency(rows, 3, async (r) => {
      try {
        const before = r.verificationTier;
        const website = (() => { const m = (r.onlinePresence as string || "").match(/\(([^)]+\.[a-z]{2,})\)/i); return m ? hostOf(m[1]) : null; })();
        const enr = await enrichLeadFull({
          business: r.business as string, city: r.city as string, state: (r as { state?: string }).state ?? "",
          phone: r.phone as string, website, websiteOpportunity: r.websiteOpportunity as string,
        }, { firecrawlKey, aiKey });
        await sb.from("leads").update({
          enrichment: enr.enrichment as unknown,
          confidenceScore: enr.confidenceScore,
          confidenceEvidence: enr.confidenceEvidence,
          unverified: enr.unverified,
          unverifiedReason: enr.unverifiedReason ?? null,
          verificationTier: enr.verificationTier,
          verificationReasons: enr.verificationReasons,
        }).eq("id", r.id);
        checked++;
        if ((before === "verified" && enr.verificationTier !== "verified") ||
            (before !== "unverified" && enr.verificationTier === "unverified")) newlyFlagged++;
      } catch { /* skip */ }
    });
    return { result: { checked, newlyFlagged, total: rows.length }, label, summary: `re-verified ${checked} — ${newlyFlagged} newly flagged` };
  }

  if (name === "update_leads") {
    const filter = (args.filter as Record<string, string>) || {};
    const changes = (args.changes as Record<string, unknown>) || {};
    const rows = await fetchLeads(sb, filter);
    const ids = rows.map((r) => r.id);
    const patch: Record<string, unknown> = {};
    if (typeof changes.status === "string") patch.status = changes.status;
    if (typeof changes.nextFollowUp === "string") patch.nextFollowUp = changes.nextFollowUp;
    const addTag = typeof changes.addTag === "string" ? changes.addTag : null;
    const label = `→ updating ${ids.length} lead${ids.length === 1 ? "" : "s"}`;
    if (ids.length > BULK_CONFIRM_THRESHOLD) {
      const preview = `Update ${ids.length} lead(s) matching ${describeFilter(filter)} — set ${JSON.stringify({ ...patch, ...(addTag ? { addTag } : {}) })}`;
      return {
        result: { needsConfirmation: true, count: ids.length, preview },
        label, summary: `awaiting confirmation for ${ids.length} updates`,
        pending: { kind: "update", ids, changes: { ...patch, ...(addTag ? { addTag } : {}) }, preview },
      };
    }
    if (!ids.length) return { result: { updated: 0 }, label, summary: "no leads matched" };
    if (Object.keys(patch).length) {
      const { error } = await sb.from("leads").update(patch).in("id", ids);
      if (error) return { result: { error: error.message }, label, summary: error.message };
    }
    if (addTag) {
      for (const r of rows) {
        const nextTags = Array.from(new Set([...(r.tags ?? []), addTag]));
        await sb.from("leads").update({ tags: nextTags }).eq("id", r.id);
      }
    }
    return { result: { updated: ids.length }, label, summary: `updated ${ids.length}` };
  }

  if (name === "delete_leads") {
    const scope = String(args.scope);
    const filter = (args.filter as Record<string, string>) || {};
    const rows = await fetchLeads(sb, scope === "filtered" ? filter : { scope, ...filter });
    const ids = rows.map((r) => r.id);
    const label = `→ preparing delete (${ids.length} lead${ids.length === 1 ? "" : "s"})`;
    const requireTyped = scope === "all";
    const preview = scope === "all"
      ? `SCRAP EVERYTHING — this deletes all ${ids.length} lead(s) in the book.`
      : `Delete ${ids.length} ${scope} lead(s)${Object.keys(filter).length ? ` matching ${describeFilter(filter)}` : ""}.`;
    return {
      result: { needsConfirmation: true, scope, count: ids.length, preview, requireTyped },
      label, summary: `awaiting confirmation to delete ${ids.length}`,
      pending: { kind: "delete", scope, filter, ids, requireTyped, preview },
    };
  }

  if (name === "restore_leads") {
    const minutes = Math.max(1, Math.min(720, Number(args.within_minutes ?? 60)));
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    const { data: dead } = await sb.from("leads").select("id,business").not("deleted_at", "is", null).gte("deleted_at", cutoff);
    const ids = (dead ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return { result: { restored: 0 }, label: "→ restore recent deletes", summary: "no recent deletes" };
    const { error } = await sb.from("leads").update({ deleted_at: null }).in("id", ids);
    if (error) return { result: { error: error.message }, label: "→ restore", summary: error.message };
    return { result: { restored: ids.length, sample: (dead ?? []).slice(0, 5).map((r: { business: string }) => r.business) }, label: `→ restoring ${ids.length} lead${ids.length === 1 ? "" : "s"}`, summary: `restored ${ids.length}` };
  }

  return { result: { error: `unknown tool ${name}` }, label: `→ ${name}`, summary: "unknown tool" };
}

function describeFilter(f: Record<string, unknown>) {
  const parts = Object.entries(f).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${v}`);
  return parts.join(" · ") || "everything";
}

async function firecrawlSearch(query: string, apiKey: string) {
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, limit: 8 }),
    });
    if (!res.ok) return [];
    const j = await res.json() as { success?: boolean; data?: { web?: Array<{ url?: string; title?: string; description?: string }> } | Array<{ url?: string; title?: string; description?: string }> };
    if (!j.success) return [];
    const d = j.data;
    if (Array.isArray(d)) return d;
    return Array.isArray(d?.web) ? d!.web! : [];
  } catch { return []; }
}

// ─── Agent loop ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the in-app assistant for "lead bloom", a solo web designer's local-business CRM.
You operate the CRM via tools. Never invent lead data — everything you report comes from tool results.

Voice: warm, editorial, concise. Use short paragraphs. No emoji. No headings. Mono/uppercase labels are fine when quoting counts.

Rules:
- Prefer query_leads to answer questions about the user's book. Report actual counts.
- Use generate_leads for creating new leads. Explain verified/partial/unverified split honestly.
- reverify_leads for freshness passes. Summarize what changed.
- delete_leads and bulk update_leads (>5) return a confirmation card — do not describe the deletion as done. Say something like "I've queued the delete — confirm below."
- market_research is web research, NOT verified lead data. Call out that distinction.
- If a tool errors, say so plainly — do not pretend it worked.
- Today: ${new Date().toISOString().slice(0,10)}.`;

async function llmCall(messages: ChatMsg[], key: string) {
  const res = await fetch(AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto" }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return j?.choices?.[0]?.message as { content: string | null; tool_calls?: ToolCall[] };
}

export const Route = createFileRoute("/api/assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return Response.json({ error: "LOVABLE_API_KEY not configured" }, { status: 500 });

        let body: Body;
        try { body = await request.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
        const history = Array.isArray(body.messages) ? body.messages : [];
        if (!history.length) return Response.json({ error: "messages required" }, { status: 400 });

        const sb = makeSb();
        const origin = new URL(request.url).origin;

        const messages: ChatMsg[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMsg),
        ];

        const steps: StepEvent[] = [];
        let pendingAction: PendingAction | null = null;
        let finalReply = "";

        try {
          for (let step = 0; step < MAX_STEPS; step++) {
            const assistant = await llmCall(messages, key);
            const calls = assistant.tool_calls ?? [];
            if (!calls.length) {
              finalReply = assistant.content ?? "";
              break;
            }
            messages.push({ role: "assistant", content: assistant.content ?? null, tool_calls: calls });

            for (const call of calls) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* ignore */ }
              try {
                const { result, label, summary, pending } = await executeTool(call.function.name, args, { sb, origin });
                steps.push({ type: "tool_call", name: call.function.name, args, label });
                steps.push({ type: "tool_result", name: call.function.name, label, ok: true, summary });
                if (pending && !pendingAction) pendingAction = pending;
                messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
              } catch (e) {
                const msg = e instanceof Error ? e.message : "tool error";
                steps.push({ type: "tool_call", name: call.function.name, args, label: `→ ${call.function.name}` });
                steps.push({ type: "tool_result", name: call.function.name, label: `→ ${call.function.name}`, ok: false, summary: msg });
                messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ error: msg }) });
              }
            }
          }
          if (!finalReply) finalReply = "I hit my step budget. Try narrowing the request.";

          // Persist user + assistant turns.
          const lastUser = history[history.length - 1];
          if (lastUser?.role === "user") {
            await sb.from("assistant_messages").insert([
              { role: "user", content: lastUser.content },
              { role: "assistant", content: finalReply, tool_calls: steps as unknown, pending_action: pendingAction as unknown },
            ]);
          }
          return Response.json({ reply: finalReply, steps, pendingAction });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown error";
          return Response.json({ error: msg, steps }, { status: 500 });
        }
      },
    },
  },
});