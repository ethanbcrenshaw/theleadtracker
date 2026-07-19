import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { enrichLeadFull, hostOf, runWithConcurrency } from "@/lib/enrichment.server";
import { runDiscovery, sortForReview } from "@/lib/discovery";
import { mergeCandidates } from "@/lib/discovery/merge";
import type { DiscoveredCandidate, DiscoverySourceId } from "@/lib/discovery/types";
import { runVerificationChecks } from "@/lib/verification.server";
import {
  aiChat,
  getAI,
  type AIChatMessage,
  type AIConfig,
  type AIToolCall,
  type AIToolDef,
} from "@/lib/ai.server";
import {
  computeWeekPlan,
  mondayOf,
  SCHEDULE_KEY,
  DEFAULT_MINUTES_PER_CALL,
  type CallSchedule,
} from "@/lib/planner";
import { getSettingServer, setSettingServer } from "@/lib/settings.server";
import { parseFollowUpDate } from "@/lib/crm-utils";
import type { Lead, LeadStatus } from "@/lib/types";

const MAX_STEPS = 10;
const BULK_CONFIRM_THRESHOLD = 5;

// Places-vouched: a partial-tier lead Google Places itself stands behind
// (operational, real reviews, strong opportunity score). The Today queue and
// the batch importer already trust these, so the assistant does too — otherwise
// it imports far fewer good no-website prospects than the rest of the app.
function placesVouched(
  enr: {
    verificationTier?: string;
    leadScore?: number;
  },
  checks: {
    leadScore?: number;
    verification?: { business?: { businessStatus?: string; reviewCount?: number } };
  } | null,
): boolean {
  const score = checks?.leadScore ?? enr.leadScore ?? 0;
  const biz = checks?.verification?.business;
  return (
    enr.verificationTier === "partial" &&
    score >= 70 &&
    biz?.businessStatus === "OPERATIONAL" &&
    (biz?.reviewCount ?? 0) >= 1
  );
}

// Append a history entry + stamp lastContacted when status changes, matching
// the UI (setStatus) and the MCP tool — so a status change via the assistant
// isn't silently missing from the lead's timeline.
async function applyStatusHistory(
  sb: Sb,
  ids: string[],
  status: string,
  note?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: rows } = await sb.from("leads").select("id, history").in("id", ids);
  for (const r of (rows ?? []) as Array<{ id: string; history: unknown[] | null }>) {
    const history = Array.isArray(r.history) ? r.history : [];
    history.push({ id: crypto.randomUUID(), date: now, status, note });
    await sb.from("leads").update({ status, lastContacted: now, history }).eq("id", r.id);
  }
}

// ─── Tool schemas ────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_leads",
      description:
        "Read leads from the CRM. Filter and count. Use for questions like 'how many verified roofers', 'what's stale', 'show me my hot leads'. Never invents data.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: [
              "Not Called",
              "Called",
              "Voicemail",
              "Callback Scheduled",
              "Zoom Booked",
              "Sold",
              "Not Interested",
            ],
          },
          tier: { type: "string", enum: ["verified", "partial", "unverified"] },
          quality: { type: "string", enum: ["High", "Medium", "Low"] },
          city: { type: "string" },
          industry_or_segment: {
            type: "string",
            description:
              "Free-text match against business name/notes/tags — used to find e.g. 'roofers' or 'salons'.",
          },
          stale_days: {
            type: "number",
            description:
              "Only return leads not touched (lastContacted OR created_at) in >= this many days.",
          },
          limit: { type: "number", description: "Max rows to return in the sample (default 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_leads",
      description:
        "Discover new local-business leads from MULTIPLE sources (Google Places with AI query fan-out, web search for off-Google businesses, new Knox County filings, Foursquare if configured), dedupe them against the whole book, and queue an enrich-and-import job that runs right in the chat with live progress. NO small batch cap — up to 40 per call, and broad geography is fine: pass several cities. Verified + Places-vouched candidates import automatically; the job posts an honest final report when it finishes.",
      parameters: {
        type: "object",
        properties: {
          industry: { type: "string" },
          cities: {
            type: "array",
            items: { type: "string" },
            description:
              "1-4 'City, ST' strings. Translate regions into real cities yourself (e.g. 'East Tennessee' → ['Knoxville, TN','Maryville, TN','Sevierville, TN']).",
          },
          city: { type: "string", description: "Single city — legacy alias for cities." },
          count: { type: "number", description: "TOTAL leads wanted across all cities, 1-40." },
          type: {
            type: "string",
            enum: [
              "No Dedicated Website",
              "Facebook Only",
              "Yelp/Directory Only",
              "Outdated Website",
              "Social-Heavy",
              "Has Website",
            ],
          },
          include_partial: {
            type: "boolean",
            description: "Also import plain partial-tier candidates. Default false.",
          },
          expand_metro: {
            type: "boolean",
            description: "Fan across Knoxville's surrounding towns (Knox-metro cities only).",
          },
          sources: {
            type: "array",
            items: {
              type: "string",
              enum: ["places", "firecrawl-search", "foursquare", "knox-registry"],
            },
            description: "Restrict discovery sources. Default: all configured.",
          },
        },
        required: ["industry", "count"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_leads",
      description:
        "Bulk update status / nextFollowUp / tags on filtered leads. A status change logs history + last-contacted automatically. nextFollowUp accepts natural language ('next Monday', 'in 2 weeks', 'August') — it's normalized to a real date; if it can't be read, the result carries followUpWarning and the date is NOT saved. If >5 leads match, returns a confirmation card (does NOT execute until confirmed).",
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
              nextFollowUp: {
                type: "string",
                description:
                  "ISO date (yyyy-mm-dd) or plain like 'next Monday' — pass ISO if possible.",
              },
              addTag: { type: "string" },
            },
          },
        },
        required: ["filter", "changes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reverify_leads",
      description:
        "Re-run the hardened verification pipeline over a filtered scope. Reports how many became verified / partial / unverified.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["all", "partial", "unverified", "filtered"] },
          filter: {
            type: "object",
            properties: { city: { type: "string" }, industry_or_segment: { type: "string" } },
          },
          limit: {
            type: "number",
            description: "Cap on how many to re-verify in one pass. Default 20, max 50.",
          },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_leads",
      description:
        "Soft-delete leads. NEVER auto-executes: always returns a confirmation card. To DELETE BY EXCLUSION ('delete everything except…', 'keep only…', 'delete all but the roofers'), set scope='all' and put the criteria to SPARE in `keep` — everything not matching `keep` is deleted. To delete a matching subset, use scope='filtered' with `filter`. scope='all' with no keep scraps the whole book (client requires a typed DELETE ALL confirmation).",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["all", "unverified", "partial", "filtered"] },
          filter: {
            type: "object",
            description:
              "Leads MATCHING these criteria are deleted (inclusive). Use with scope='filtered'.",
            properties: {
              status: { type: "string" },
              tier: { type: "string", enum: ["verified", "partial", "unverified"] },
              quality: { type: "string", enum: ["High", "Medium", "Low"] },
              city: { type: "string" },
              industry_or_segment: { type: "string" },
            },
          },
          keep: {
            type: "object",
            description:
              "Leads MATCHING these criteria are SPARED; everything else in scope is deleted. This is how you delete by exclusion. e.g. keep={tier:'verified', industry_or_segment:'roofing'} deletes everything except verified roofers.",
            properties: {
              status: { type: "string" },
              tier: { type: "string", enum: ["verified", "partial", "unverified"] },
              quality: { type: "string", enum: ["High", "Medium", "Low"] },
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
      description:
        "Undo a recent soft-delete. Restores leads deleted within the last hour, optionally filtered.",
      parameters: {
        type: "object",
        properties: {
          within_minutes: {
            type: "number",
            description: "Only restore rows deleted within N minutes. Default 60.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_call_schedule",
      description:
        "Save the user's weekly cold-calling schedule (their sit-down slots). Use when they describe when they'll call this week, e.g. 'Tuesday 1-3pm and Thursday mornings'. Times are the user's local time, 24h HH:MM. Confirms capacity back.",
      parameters: {
        type: "object",
        properties: {
          slots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "string", enum: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
                start: { type: "string", description: "24h HH:MM, e.g. '13:00'" },
                end: { type: "string", description: "24h HH:MM, e.g. '15:00'" },
              },
              required: ["day", "start", "end"],
            },
          },
          minutes_per_call: {
            type: "number",
            description: "Minutes per dial incl. logging. Default 5.",
          },
        },
        required: ["slots"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_call_plan",
      description:
        "Compute this week's calling plan from the saved schedule and the lead book: per-slot capacity, which US timezones are in their answer window during each slot, callable stock per zone, and stock gaps that need new leads. Use to build the daily plan or decide what to generate.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "market_research",
      description:
        "Web research about a local market (segments, density, opportunity). NOT verified lead data. Returns a short sourced brief.",
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
type ChatMsg = AIChatMessage;
type ToolCall = AIToolCall;

type PendingAction =
  | {
      kind: "delete";
      scope: string;
      filter?: Record<string, unknown>;
      ids: string[];
      requireTyped?: boolean;
      preview: string;
    }
  | { kind: "update"; ids: string[]; changes: Record<string, unknown>; preview: string };

// Every discovery source the assistant may fan across (filtered to configured
// sources inside runDiscovery).
const ALL_SOURCE_IDS: DiscoverySourceId[] = [
  "places",
  "firecrawl-search",
  "foursquare",
  "knox-registry",
];

/**
 * A queued enrich-and-import run. Discovery happens server-side (fast); the
 * assistant page executes the slow part with live progress — one
 * /api/enrich-candidate call per candidate — so batch size has no serverless
 * ceiling. Persisted in pending_action so reloaded chats can re-run it.
 */
export type GenerateJob = {
  kind: "generate";
  id: string;
  industry: string;
  type: string;
  includePartial: boolean;
  targetCount: number;
  cities: string[];
  candidates: Array<
    Pick<
      DiscoveredCandidate,
      | "business"
      | "city"
      | "state"
      | "phone"
      | "owner"
      | "sourceUrl"
      | "website"
      | "sources"
      | "onlinePresence"
      | "websiteOpportunity"
      | "matchesFilter"
      | "placesSignals"
      | "foundVia"
      | "offGoogle"
      | "registeredAt"
      | "phoneInvalid"
    >
  >;
};

type StepEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown>; label: string }
  | { type: "tool_result"; name: string; label: string; ok: boolean; summary: string };

type Body = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Thread id from the assistant page. Absent → legacy single-stream rows. */
  conversationId?: string;
};

function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;
function makeSb(): Sb {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ─── Filtering (used by query, update, delete, reverify) ─────────────────────
type LeadRow = Record<string, unknown> & {
  id: string;
  business: string;
  city: string;
  phone: string;
  status: string;
  quality: string;
  websiteOpportunity: string;
  verificationTier: string | null;
  tags: string[] | null;
  notes: string | null;
  lastContacted: string | null;
  nextFollowUp: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
};

async function fetchLeads(
  sb: Sb,
  opts: {
    status?: string;
    tier?: string;
    quality?: string;
    city?: string;
    industry_or_segment?: string;
    stale_days?: number;
    scope?: string;
  },
): Promise<LeadRow[]> {
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
      const t = r.lastContacted
        ? new Date(r.lastContacted).getTime()
        : r.created_at
          ? new Date(r.created_at).getTime()
          : 0;
      return t > 0 && t < cutoff;
    });
  }
  return rows;
}

// ─── Tool executor ───────────────────────────────────────────────────────────
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  deps: { sb: Sb; origin: string },
): Promise<{
  result: unknown;
  label: string;
  summary: string;
  pending?: PendingAction;
  job?: GenerateJob;
}> {
  const sb = deps.sb;

  if (name === "query_leads") {
    const rows = await fetchLeads(sb, args as Parameters<typeof fetchLeads>[1]);
    const limit = Math.min(Number(args.limit ?? 20), 50);
    const sample = rows.slice(0, limit).map((r) => ({
      business: r.business,
      city: r.city,
      status: r.status,
      tier: r.verificationTier,
      quality: r.quality,
      phone: r.phone,
      lastContacted: r.lastContacted,
    }));
    const label = `→ querying leads (${describeFilter(args)})`;
    const summary = `found ${rows.length} lead${rows.length === 1 ? "" : "s"}`;
    return { result: { count: rows.length, sample }, label, summary };
  }

  if (name === "market_research") {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    if (!firecrawlKey)
      return {
        result: { error: "Firecrawl not configured" },
        label: "→ market research",
        summary: "Firecrawl not configured",
      };
    const q =
      `${args.business_type ? args.business_type + " " : ""}${args.location} local businesses market ${args.question ?? ""}`.trim();
    const items = await firecrawlSearch(q, firecrawlKey);
    const brief = items
      .slice(0, 6)
      .map((i) => ({ title: i.title, url: i.url, snippet: (i.description || "").slice(0, 300) }));
    return {
      result: { query: q, sources: brief },
      label: `→ researching ${args.location}${args.business_type ? " · " + args.business_type : ""}`,
      summary: `pulled ${brief.length} source${brief.length === 1 ? "" : "s"}`,
    };
  }

  if (name === "generate_leads") {
    if (!process.env.GOOGLE_PLACES_API_KEY && !process.env.FIRECRAWL_API_KEY)
      return {
        result: { error: "No discovery keys configured" },
        label: "→ generate_leads",
        summary: "config missing",
      };
    const industry = String(args.industry || "").trim();
    const rawCities =
      Array.isArray(args.cities) && args.cities.length
        ? (args.cities as unknown[]).map(String)
        : args.city
          ? [String(args.city)]
          : [];
    const cities = rawCities
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (!industry || !cities.length)
      return {
        result: { error: "industry and at least one city required" },
        label: "→ generate_leads",
        summary: "missing industry/city",
      };
    const count = Math.max(1, Math.min(40, Number(args.count) || 10));
    const type = String(args.type || "No Dedicated Website");
    const includePartial = Boolean(args.include_partial);
    const expandMetro = Boolean(args.expand_metro);
    const requestedSources =
      Array.isArray(args.sources) && args.sources.length
        ? ((args.sources as unknown[]).map(String) as DiscoverySourceId[])
        : undefined;
    const label = `→ discovering ${industry} across ${cities.join(" · ")}…`;

    // Discovery only — fast, wall-clock-budgeted so the request always
    // returns inside the serverless window. The slow part (enrichment +
    // import) runs client-side as a chat job with live progress, so there is
    // NO batch-size cap anymore.
    const DISCOVERY_BUDGET_MS = 40_000;
    const startedAt = Date.now();
    const perCity: Record<string, number> = {};
    const perSource: Record<string, number> = {};
    const notes: string[] = [];
    const lists: DiscoveredCandidate[][] = [];
    const perCityCount = Math.ceil(count / cities.length);

    for (let i = 0; i < cities.length; i++) {
      const remaining = DISCOVERY_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < 4000) {
        notes.push(`stopped before ${cities[i]} — discovery time budget spent`);
        break;
      }
      // Slow off-Google sources run for the first city only on multi-city
      // sweeps; Places (fast) covers every city.
      const sources = (requestedSources ?? ALL_SOURCE_IDS).filter((s) => i === 0 || s === "places");
      const res = await runDiscovery(
        { industry, city: cities[i], count: perCityCount, type, expandMetro },
        { sources, timeBudgetMs: remaining },
      );
      lists.push(res.candidates);
      perCity[cities[i]] = res.candidates.length;
      for (const [k, v] of Object.entries(res.perSource)) perSource[k] = (perSource[k] ?? 0) + v;
      notes.push(...res.notes);
    }

    // Cross-city merge (a business discovered from two nearby cities is one
    // lead), then queue up to 2× the target — enrichment rejects some, and
    // the client stops importing once the target is reached.
    const merged = sortForReview(mergeCandidates(lists));
    const queued = merged.slice(0, Math.min(count * 2, 60));
    const offGoogleN = queued.filter((c) => c.offGoogle).length;

    const job: GenerateJob = {
      kind: "generate",
      id: crypto.randomUUID(),
      industry,
      type,
      includePartial,
      targetCount: count,
      cities,
      candidates: queued.map((c) => ({
        business: c.business,
        city: c.city,
        state: c.state,
        phone: c.phone,
        owner: c.owner,
        sourceUrl: c.sourceUrl,
        website: c.website,
        sources: c.sources,
        onlinePresence: c.onlinePresence,
        websiteOpportunity: c.websiteOpportunity,
        matchesFilter: c.matchesFilter,
        placesSignals: c.placesSignals,
        foundVia: c.foundVia,
        offGoogle: c.offGoogle,
        registeredAt: c.registeredAt,
        phoneInvalid: c.phoneInvalid,
      })),
    };

    const summary = `queued ${queued.length} candidates toward ${count} imports (${Object.entries(
      perCity,
    )
      .map(([c, n]) => `${c.split(",")[0]} ${n}`)
      .join(" · ")})${offGoogleN ? ` · ${offGoogleN} off-Google` : ""}`;
    return {
      result: {
        queuedCandidates: queued.length,
        targetImports: count,
        perCity,
        perSource,
        offGoogle: offGoogleN,
        notes,
        note: "An enrich-and-import job card is now running in this chat with live progress. Do NOT claim leads are imported — say the run is underway below and its report will follow.",
      },
      label,
      summary,
      job,
    };
  }

  if (name === "reverify_leads") {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    const ai = getAI();
    if (!firecrawlKey)
      return {
        result: { error: "Firecrawl not configured" },
        label: "→ reverify",
        summary: "config missing",
      };
    const scope = String(args.scope);
    const filter = (args.filter as Record<string, string>) || {};
    const limit = Math.min(Number(args.limit ?? 20), 50);
    const rows = (await fetchLeads(sb, { ...filter, scope })).slice(0, limit);
    const label = `→ re-verifying ${rows.length} lead${rows.length === 1 ? "" : "s"}…`;
    let checked = 0,
      newlyFlagged = 0;
    await runWithConcurrency(rows, 3, async (r) => {
      try {
        const before = r.verificationTier;
        const website = (() => {
          const m = ((r.onlinePresence as string) || "").match(/\(([^)]+\.[a-z]{2,})\)/i);
          return m ? hostOf(m[1]) : null;
        })();
        const enr = await enrichLeadFull(
          {
            business: r.business as string,
            city: r.city as string,
            state: (r as { state?: string }).state ?? "",
            phone: r.phone as string,
            website,
            websiteOpportunity: r.websiteOpportunity as string,
          },
          { firecrawlKey, ai },
        );
        // Verification checks — business signals carry over from the last
        // stored check (no fresh Places response on the re-verify path).
        const prior = (
          r as {
            verification?: {
              business?: {
                businessStatus?: string;
                rating?: number;
                reviewCount?: number;
                lastReviewAt?: string;
              };
            };
          }
        ).verification?.business;
        const checks = await runVerificationChecks({
          website,
          phone: r.phone as string,
          tier: enr.verificationTier,
          signals: prior,
        });
        await sb
          .from("leads")
          .update({
            enrichment: enr.enrichment as unknown,
            confidenceScore: enr.confidenceScore,
            confidenceEvidence: enr.confidenceEvidence,
            unverified: enr.unverified,
            unverifiedReason: enr.unverifiedReason ?? null,
            verificationTier: enr.verificationTier,
            verificationReasons: enr.verificationReasons,
            verification: checks.verification as unknown,
            leadScore: checks.leadScore,
          })
          .eq("id", r.id);
        checked++;
        if (
          (before === "verified" && enr.verificationTier !== "verified") ||
          (before !== "unverified" && enr.verificationTier === "unverified")
        )
          newlyFlagged++;
      } catch {
        /* skip */
      }
    });
    return {
      result: { checked, newlyFlagged, total: rows.length },
      label,
      summary: `re-verified ${checked} — ${newlyFlagged} newly flagged`,
    };
  }

  if (name === "update_leads") {
    const filter = (args.filter as Record<string, string>) || {};
    const changes = (args.changes as Record<string, unknown>) || {};
    const rows = await fetchLeads(sb, filter);
    const ids = rows.map((r) => r.id);
    const label = `→ updating ${ids.length} lead${ids.length === 1 ? "" : "s"}`;

    // Normalize a follow-up date to real ISO. If it's given but unparseable,
    // DO NOT write it (that silently loses the follow-up) — report it back so
    // the assistant can ask the user to clarify.
    const statusChange = typeof changes.status === "string" ? (changes.status as string) : null;
    const addTag = typeof changes.addTag === "string" ? changes.addTag : null;
    let followUpISO: string | undefined;
    let followUpWarning: string | undefined;
    if (changes.nextFollowUp != null && String(changes.nextFollowUp).trim()) {
      const parsed = parseFollowUpDate(changes.nextFollowUp);
      if (parsed) followUpISO = new Date(parsed + "T12:00:00").toISOString();
      else
        followUpWarning = `Could not read the follow-up date "${changes.nextFollowUp}" — ask the user for a concrete date.`;
    }

    // The non-status patch (follow-up) can be applied in one shot; status needs
    // per-row history, handled separately.
    const flatPatch: Record<string, unknown> = {};
    if (followUpISO) flatPatch.nextFollowUp = followUpISO;

    const previewParts = [
      statusChange ? `status=${statusChange}` : null,
      followUpISO ? `follow-up=${followUpISO.slice(0, 10)}` : null,
      addTag ? `+tag ${addTag}` : null,
    ].filter(Boolean);

    if (ids.length > BULK_CONFIRM_THRESHOLD) {
      const preview = `Update ${ids.length} lead(s) matching ${describeFilter(filter)} — ${previewParts.join(", ") || "no changes"}.`;
      return {
        result: { needsConfirmation: true, count: ids.length, preview, followUpWarning },
        label,
        summary: `awaiting confirmation for ${ids.length} updates`,
        pending: {
          kind: "update",
          ids,
          changes: {
            ...(statusChange ? { status: statusChange } : {}),
            ...flatPatch,
            ...(addTag ? { addTag } : {}),
          },
          preview,
        },
      };
    }
    if (!ids.length)
      return { result: { updated: 0, followUpWarning }, label, summary: "no leads matched" };

    if (Object.keys(flatPatch).length) {
      const { error } = await sb.from("leads").update(flatPatch).in("id", ids);
      if (error) return { result: { error: error.message }, label, summary: error.message };
    }
    if (statusChange) {
      await applyStatusHistory(sb, ids, statusChange);
    }
    if (addTag) {
      for (const r of rows) {
        const nextTags = Array.from(new Set([...(r.tags ?? []), addTag]));
        await sb.from("leads").update({ tags: nextTags }).eq("id", r.id);
      }
    }
    return {
      result: { updated: ids.length, followUpWarning },
      label,
      summary: `updated ${ids.length}${followUpWarning ? " (follow-up date unclear)" : ""}`,
    };
  }

  if (name === "delete_leads") {
    const scope = String(args.scope);
    const filter = (args.filter as Record<string, string>) || {};
    const keep = (args.keep as Record<string, string>) || {};
    const hasKeep = Object.keys(keep).some((k) => keep[k]);
    let rows = await fetchLeads(sb, scope === "filtered" ? filter : { scope, ...filter });

    // Delete-by-exclusion: spare everything matching `keep`, delete the rest.
    let keptCount = 0;
    if (hasKeep) {
      const keepRows = await fetchLeads(sb, keep);
      const keepIds = new Set(keepRows.map((r) => r.id));
      const before = rows.length;
      rows = rows.filter((r) => !keepIds.has(r.id));
      keptCount = before - rows.length;
    }

    const ids = rows.map((r) => r.id);
    const label = `→ preparing delete (${ids.length} lead${ids.length === 1 ? "" : "s"})`;
    // A "scrap everything" typed guard applies only to an unqualified scope=all.
    const requireTyped = scope === "all" && !hasKeep;
    const preview = hasKeep
      ? `Delete ${ids.length} lead(s), KEEPING ${keptCount} that match ${describeFilter(keep)}.`
      : scope === "all"
        ? `SCRAP EVERYTHING — this deletes all ${ids.length} lead(s) in the book.`
        : `Delete ${ids.length} ${scope} lead(s)${Object.keys(filter).length ? ` matching ${describeFilter(filter)}` : ""}.`;
    return {
      result: {
        needsConfirmation: true,
        scope,
        count: ids.length,
        kept: keptCount,
        preview,
        requireTyped,
      },
      label,
      summary: hasKeep
        ? `awaiting confirmation to delete ${ids.length} (keeping ${keptCount})`
        : `awaiting confirmation to delete ${ids.length}`,
      pending: { kind: "delete", scope, filter, ids, requireTyped, preview },
    };
  }

  if (name === "restore_leads") {
    const minutes = Math.max(1, Math.min(720, Number(args.within_minutes ?? 60)));
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    const { data: dead } = await sb
      .from("leads")
      .select("id,business")
      .not("deleted_at", "is", null)
      .gte("deleted_at", cutoff);
    const ids = (dead ?? []).map((r: { id: string }) => r.id);
    if (!ids.length)
      return {
        result: { restored: 0 },
        label: "→ restore recent deletes",
        summary: "no recent deletes",
      };
    const { error } = await sb.from("leads").update({ deleted_at: null }).in("id", ids);
    if (error)
      return { result: { error: error.message }, label: "→ restore", summary: error.message };
    return {
      result: {
        restored: ids.length,
        sample: (dead ?? []).slice(0, 5).map((r: { business: string }) => r.business),
      },
      label: `→ restoring ${ids.length} lead${ids.length === 1 ? "" : "s"}`,
      summary: `restored ${ids.length}`,
    };
  }

  if (name === "set_call_schedule") {
    const DAY_INDEX: Record<string, number> = {
      SUN: 0,
      MON: 1,
      TUE: 2,
      WED: 3,
      THU: 4,
      FRI: 5,
      SAT: 6,
    };
    const rawSlots = Array.isArray(args.slots) ? (args.slots as Array<Record<string, string>>) : [];
    const slots = rawSlots
      .map((s) => ({
        day:
          DAY_INDEX[
            String(s.day || "")
              .toUpperCase()
              .slice(0, 3)
          ] ?? -1,
        start: String(s.start || "").trim(),
        end: String(s.end || "").trim(),
      }))
      .filter(
        (s) => s.day >= 0 && /^\d{1,2}:\d{2}$/.test(s.start) && /^\d{1,2}:\d{2}$/.test(s.end),
      );
    if (!slots.length) {
      return {
        result: { error: "No valid slots — need day + start + end (24h HH:MM)." },
        label: "→ set schedule",
        summary: "no valid slots",
      };
    }
    const schedule: CallSchedule = {
      slots,
      minutesPerCall: Math.max(
        2,
        Math.min(30, Number(args.minutes_per_call) || DEFAULT_MINUTES_PER_CALL),
      ),
      weekOf: mondayOf(new Date()),
    };
    await setSettingServer(SCHEDULE_KEY, schedule);
    const { data: rows } = await sb.from("leads").select("*").is("deleted_at", null);
    const plan = computeWeekPlan((rows ?? []) as unknown as Lead[], schedule);
    return {
      result: {
        saved: true,
        totalCapacity: plan.totalCapacity,
        slots: plan.slots.map((p) => ({
          day: p.slot.day,
          start: p.slot.start,
          end: p.slot.end,
          capacity: p.capacity,
          bestZones: p.zones.slice(0, 3).map((z) => z.label),
          shortfall: p.shortfall,
        })),
        gaps: plan.gaps,
      },
      label: `→ saving schedule (${slots.length} slot${slots.length === 1 ? "" : "s"})`,
      summary: `saved — ${plan.totalCapacity} dials of capacity this week${plan.gaps.length ? `, gaps: ${plan.gaps.map((g) => `${g.needed} ${g.label}`).join(", ")}` : ""}`,
    };
  }

  if (name === "get_call_plan") {
    const schedule = await getSettingServer<CallSchedule>(SCHEDULE_KEY);
    if (!schedule || !schedule.slots.length) {
      return {
        result: {
          noSchedule: true,
          message: "No calling schedule saved. Ask the user for their sit-down slots this week.",
        },
        label: "→ reading call plan",
        summary: "no schedule saved",
      };
    }
    const { data: rows } = await sb.from("leads").select("*").is("deleted_at", null);
    const plan = computeWeekPlan((rows ?? []) as unknown as Lead[], schedule);
    const stale = schedule.weekOf !== mondayOf(new Date());
    return {
      result: {
        weekOf: plan.weekOf,
        staleSchedule: stale,
        minutesPerCall: schedule.minutesPerCall,
        totalCapacity: plan.totalCapacity,
        slots: plan.slots.map((p) => ({
          day: p.slot.day,
          start: p.slot.start,
          end: p.slot.end,
          capacity: p.capacity,
          zones: p.zones.map((z) => ({
            zone: z.label,
            answerability: z.answerability,
            stock: z.stock,
          })),
          callableStock: p.callableStock,
          shortfall: p.shortfall,
        })),
        gaps: plan.gaps,
      },
      label: "→ computing week plan",
      summary: `${plan.totalCapacity} dials planned across ${plan.slots.length} slot${plan.slots.length === 1 ? "" : "s"}${plan.gaps.length ? ` — need ${plan.gaps.reduce((s, g) => s + g.needed, 0)} more leads` : " — fully stocked"}`,
    };
  }

  return { result: { error: `unknown tool ${name}` }, label: `→ ${name}`, summary: "unknown tool" };
}

function describeFilter(f: Record<string, unknown>) {
  const parts = Object.entries(f)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
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
    const j = (await res.json()) as {
      success?: boolean;
      data?:
        | { web?: Array<{ url?: string; title?: string; description?: string }> }
        | Array<{ url?: string; title?: string; description?: string }>;
    };
    if (!j.success) return [];
    const d = j.data;
    if (Array.isArray(d)) return d;
    return Array.isArray(d?.web) ? d!.web! : [];
  } catch {
    return [];
  }
}

// ─── Agent loop ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the in-app assistant for "lead bloom", a solo web designer's local-business CRM.
You operate the CRM via tools. Never invent lead data — everything you report comes from tool results.

Voice: warm, editorial, and BRIEF. Default to 1–3 short sentences; lead with the number or result, then stop. Longer replies only when the user asks for a plan, a list, or an explanation. Never restate the user's question, never narrate what you're about to do, no filler ("Sure!", "Great question"), no sign-offs. No emoji. No headings. Mono/uppercase labels are fine when quoting counts.

Rules:
- Ground EVERY claim in a tool result. Never say you did something unless the tool result confirms it. If a tool returned an error, a zero count, or a warning field, report that plainly — do not smooth it over or claim success. Honesty about a failure is far better than a false "done".
- Prefer query_leads to answer questions about the user's book. Report actual counts.
- generate_leads has NO small batch cap: up to 40 per call (run it again for more). It discovers from every configured source (Google Places with AI query variants, web search for off-Google businesses, new Knox County filings, Foursquare), dedupes against the whole book, and queues an enrich-and-import job that runs RIGHT IN THIS CHAT with live progress and a final report.
- Broad geography is yours to translate: a region becomes 2-4 concrete cities you choose ("East Tennessee" → Knoxville, Maryville, Sevierville; "Middle TN" → Nashville, Franklin, Murfreesboro; "Pacific stock" → Portland OR, Seattle WA, Sacramento CA). Never refuse a broad ask — pick real cities and say which you picked and why. For Knoxville-area asks, set expand_metro to sweep the surrounding towns.
- After calling generate_leads, do NOT claim leads are imported. The tool result reports what was QUEUED; say the import is running below with live progress and the final report will follow. If 0 candidates were queued, say so and suggest a different segment, city, or source mix.
- update_leads: follow-up dates can be natural language ("next Monday", "in 2 weeks", "August") — the tool normalizes them. If a tool result includes followUpWarning, the date could NOT be saved; tell the user and ask for a concrete date rather than claiming the follow-up is set.
- reverify_leads for freshness passes. Summarize what changed.
- delete_leads and bulk update_leads (>5) return a confirmation card — do not describe the action as done. Say something like "I've queued it — confirm on the card below." Only after the user confirms does it execute.
- To delete by exclusion ("delete everything except X", "keep only X", "delete all but the roofers"), call delete_leads with scope='all' and put the criteria to KEEP in the 'keep' object — never say you can't do this. Only ask for specifics if the "except" criteria itself is ambiguous.
- market_research is web research, NOT verified lead data. Call out that distinction.

You are also the user's calling-week planner:
- When the user describes when they'll sit down to cold call (days/times), call set_call_schedule. Times are their local time; convert casual phrasing ("Thursday mornings" → 09:00–11:30).
- Use get_call_plan to answer "what's my plan", "how many calls can I do", or to build a daily plan. It returns per-slot capacity, which US timezones are answerable during each slot, stock per zone, and gaps.
- If get_call_plan reports staleSchedule or noSchedule, ask ONE short question for this week's slots before planning.
- When the plan shows gaps, proactively offer to fill them with generate_leads — pick the user's best-converting segment and a specific city IN THE NEEDED TIMEZONE (e.g. Central gap → Memphis or Nashville TN; Eastern gap → Knoxville or Chattanooga TN). Say why you chose that city. Never auto-import beyond capacity needs.
- Timezone golden windows: businesses answer best 9:00–11:30am and 1:30–4:30pm THEIR local time; avoid lunch and after 5pm. East coast first when multiple zones are open.
- Today: ${new Date().toISOString().slice(0, 10)}.`;

// Transient model errors (overload/rate-limit/5xx) should not kill the whole
// request — the assistant would just surface a raw "529 Overloaded" as a
// dead-end. Retry a couple of times with backoff before giving up.
function isTransient(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b(429|500|502|503|529)\b/.test(m) || /overload|rate.?limit|timeout|temporarily/.test(m);
}

async function llmCall(messages: ChatMsg[], ai: AIConfig) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { content, toolCalls } = await aiChat(ai, {
        messages,
        tools: TOOLS as unknown as AIToolDef[],
        toolChoice: "auto",
        timeoutMs: 60_000,
      });
      return { content, tool_calls: toolCalls };
    } catch (err) {
      lastErr = err;
      if (attempt < 2 && isTransient(err)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export const Route = createFileRoute("/api/assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ai = getAI();
        if (!ai)
          return Response.json(
            {
              error:
                "AI not configured — set ANTHROPIC_API_KEY, GEMINI_API_KEY, or LOVABLE_API_KEY",
            },
            { status: 500 },
          );

        let body: Body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad JSON" }, { status: 400 });
        }
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
        let generateJob: GenerateJob | null = null;
        let finalReply = "";

        try {
          for (let step = 0; step < MAX_STEPS; step++) {
            const assistant = await llmCall(messages, ai);
            const calls = assistant.tool_calls ?? [];
            if (!calls.length) {
              finalReply = assistant.content ?? "";
              break;
            }
            messages.push({
              role: "assistant",
              content: assistant.content ?? null,
              tool_calls: calls,
            });

            for (const call of calls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch {
                /* ignore */
              }
              try {
                const { result, label, summary, pending, job } = await executeTool(
                  call.function.name,
                  args,
                  { sb, origin },
                );
                steps.push({ type: "tool_call", name: call.function.name, args, label });
                steps.push({
                  type: "tool_result",
                  name: call.function.name,
                  label,
                  ok: true,
                  summary,
                });
                if (pending && !pendingAction) pendingAction = pending;
                if (job && !generateJob) generateJob = job;
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  name: call.function.name,
                  content: JSON.stringify(result),
                });
              } catch (e) {
                const msg = e instanceof Error ? e.message : "tool error";
                steps.push({
                  type: "tool_call",
                  name: call.function.name,
                  args,
                  label: `→ ${call.function.name}`,
                });
                steps.push({
                  type: "tool_result",
                  name: call.function.name,
                  label: `→ ${call.function.name}`,
                  ok: false,
                  summary: msg,
                });
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  name: call.function.name,
                  content: JSON.stringify({ error: msg }),
                });
              }
            }
          }
          if (!finalReply) {
            // Out of steps but work was done — summarize honestly instead of a
            // bare "I gave up." The steps array is returned so the UI shows it.
            const okSteps = steps.filter((s) => s.type === "tool_result" && s.ok);
            finalReply = okSteps.length
              ? "That took more steps than I run in one go — here's what I got through above. Tell me the next piece and I'll continue."
              : "I couldn't complete that in one pass. Try breaking it into a smaller, more specific request.";
          }

          // Persist user + assistant turns. conversation_id threads the new
          // assistant page; if the column's migration hasn't been applied yet,
          // retry without it so chat history never silently stops saving.
          const lastUser = history[history.length - 1];
          if (lastUser?.role === "user") {
            const rows = [
              { role: "user", content: lastUser.content },
              {
                role: "assistant",
                content: finalReply,
                tool_calls: steps as unknown,
                // Jobs share the pending_action column so reloaded chats can
                // re-run an un-run import.
                pending_action: (pendingAction ?? generateJob) as unknown,
              },
            ];
            const withThread = body.conversationId
              ? rows.map((r) => ({ ...r, conversation_id: body.conversationId }))
              : rows;
            const { error: insErr } = await sb.from("assistant_messages").insert(withThread);
            if (insErr && body.conversationId) {
              await sb.from("assistant_messages").insert(rows);
            }
          }
          return Response.json({ reply: finalReply, steps, pendingAction, generateJob });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown error";
          return Response.json({ error: msg, steps }, { status: 500 });
        }
      },
    },
  },
});
