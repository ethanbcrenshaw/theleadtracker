import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLeads } from "@/lib/store";
import { qualityFromOpportunity } from "@/lib/crm-utils";
import type {
  Lead,
  LeadEnrichment,
  LeadSource,
  LeadVerification,
  VerificationTier,
  WebsiteOpportunity,
} from "@/lib/types";
import { BloomFlower } from "@/components/crm/BloomFlower";
import { Wordmark } from "@/components/crm/Wordmark";
import { webSpeechProvider } from "@/lib/transcription/webspeech";
import type { TranscriptionSession } from "@/lib/transcription";

// The assistant's own room: full page, deep maroon, white ink. Same editorial
// bones as the rest of the app (serif display, mono [ BRACKET ] labels,
// hairline borders) — the palette flips, the language doesn't.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

// ── Maroon palette — scoped to this page via CSS-variable overrides ─────────
const MAROON_VARS: Record<string, string> = {
  "--background": "oklch(0.235 0.052 22)",
  "--card": "oklch(0.275 0.055 22)",
  "--popover": "oklch(0.275 0.055 22)",
  "--foreground": "oklch(0.962 0.008 80)",
  "--muted-foreground": "oklch(0.74 0.024 40)",
  "--border": "oklch(0.40 0.045 25)",
  "--sienna": "oklch(0.78 0.155 42)",
  "--frog": "oklch(0.84 0.10 255)",
  "--frog-ink": "oklch(0.86 0.085 255)",
  "--frog-tint": "oklch(0.29 0.045 260)",
};

type Step =
  | { type: "tool_call"; name: string; label: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; label: string; ok: boolean; summary: string };

type PendingAction =
  | { kind: "delete"; scope: string; ids: string[]; requireTyped?: boolean; preview: string }
  | { kind: "update"; ids: string[]; changes: Record<string, unknown>; preview: string };

// A queued enrich-and-import run from generate_leads. Discovery happened
// server-side; this page executes the slow part (one /api/enrich-candidate
// call per candidate) with live progress — so batch size has no serverless
// ceiling.
type JobCandidate = {
  business: string;
  city: string;
  state: string;
  phone: string;
  owner: string | null;
  sourceUrl: string | null;
  website: string | null;
  sources: string[];
  onlinePresence: string;
  websiteOpportunity: string;
  matchesFilter: boolean;
  placesSignals?: {
    businessStatus?: string;
    rating?: number;
    reviewCount?: number;
    lastReviewAt?: string;
  };
  foundVia?: string[];
  offGoogle?: boolean;
  registeredAt?: string;
  phoneInvalid?: boolean;
};

type GenerateJob = {
  kind: "generate";
  id: string;
  industry: string;
  type: string;
  includePartial: boolean;
  targetCount: number;
  cities: string[];
  candidates: JobCandidate[];
};

type JobProgress = {
  status: "running" | "done" | "cancelled";
  done: number;
  imported: number;
  skipped: number;
  errors: number;
  current?: string;
};

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  steps?: Step[];
  pending?: PendingAction | null;
  job?: GenerateJob | null;
  executed?: { ok: boolean; count: number; kind: string } | null;
};

const ALLOWED_SOURCES: LeadSource[] = [
  "Yelp",
  "Facebook",
  "Google Business",
  "Angie's List",
  "MapQuest",
  "Website",
  "Instagram",
  "Houzz",
  "Directory",
  "Other",
];
const ALLOWED_OPP: WebsiteOpportunity[] = [
  "No Dedicated Website",
  "Facebook Only",
  "Yelp/Directory Only",
  "Outdated Website",
  "Has Website",
  "Social-Heavy",
];

type EnrichResult = {
  enrichment?: LeadEnrichment;
  confidenceScore?: number;
  confidenceEvidence?: string[];
  unverified?: boolean;
  unverifiedReason?: string;
  verificationTier?: VerificationTier;
  verificationReasons?: string[];
  verification?: LeadVerification;
  leadScore?: number;
  websiteOpportunity?: string;
  discoveredWebsite?: string;
};

// Same bar the rest of the app trusts: a partial-tier lead Google Places
// itself stands behind.
function placesVouchedClient(r: EnrichResult): boolean {
  const biz = r.verification?.business;
  return (
    r.verificationTier === "partial" &&
    (r.leadScore ?? 0) >= 70 &&
    biz?.businessStatus === "OPERATIONAL" &&
    (biz?.reviewCount ?? 0) >= 1
  );
}

type Thread = {
  id: string; // conversation_id, or "legacy" for pre-thread rows
  title: string;
  lastAt: string;
  count: number;
};

const LEGACY_ID = "legacy";
const SIDEBAR_KEY = "leadbloom.assistantSidebar";

// Text-like files we can inline into a message. Everything else is refused
// with a visible failed state rather than silently dropped.
const TEXT_EXTENSIONS = ["txt", "csv", "tsv", "md", "json", "log"];
const MAX_FILE_BYTES = 300_000;
const MAX_INLINE_CHARS = 20_000;

type Attachment = {
  id: string;
  name: string;
  size: number;
  text?: string;
  error?: string;
};

const QUICK_PROMPTS = [
  "what's my plan for today",
  "how many verified leads do I have",
  "generate 5 plumbers in Knoxville",
  "who's overdue for a follow-up",
  "re-verify my partial leads",
];

type CallStep = Extract<Step, { type: "tool_call" }>;
type ResultStep = Extract<Step, { type: "tool_result" }>;

function pairSteps(steps: Step[]): Array<{ call: CallStep; result?: ResultStep }> {
  const out: Array<{ call: CallStep; result?: ResultStep }> = [];
  const results = steps.filter((s): s is ResultStep => s.type === "tool_result");
  const calls = steps.filter((s): s is CallStep => s.type === "tool_call");
  calls.forEach((call, i) => out.push({ call, result: results[i] }));
  return out;
}

function threadTitle(firstUser: string | undefined): string {
  const t = (firstUser || "").replace(/\s+/g, " ").trim();
  if (!t) return "untitled";
  return t.length > 44 ? t.slice(0, 44) + "…" : t;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type DbRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  conversation_id?: string | null;
  tool_calls: Step[] | null;
  pending_action: PendingAction | GenerateJob | null;
};

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [{ title: "the assistant — lead bloom" }],
  }),
  component: AssistantPage,
});

function AssistantPage() {
  const refresh = useLeads((s) => s.refresh);
  const addLeads = useLeads((s) => s.addLeads);

  // History: one fetch of all chat rows; threads + active messages derive from it.
  const [rows, setRows] = useState<DbRow[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "offline">("loading");
  const [threadsSupported, setThreadsSupported] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Turns taken this session (optimistic, appended after the DB rows).
  const [localMsgs, setLocalMsgs] = useState<Record<string, Msg[]>>({});

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live enrich-and-import jobs, keyed by job id.
  const [jobProgress, setJobProgress] = useState<Record<string, JobProgress>>({});
  const cancelledJobs = useRef<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // Starts true on both server and client, then syncs from localStorage after
  // mount — reading it in the initializer causes a hydration mismatch.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarHydrated = useRef(false);
  useEffect(() => {
    setSidebarOpen(window.localStorage.getItem(SIDEBAR_KEY) !== "closed");
    sidebarHydrated.current = true;
  }, []);

  // Voice input.
  const [micState, setMicState] = useState<"idle" | "starting" | "listening">("idle");
  const [interim, setInterim] = useState("");
  const micSession = useRef<TranscriptionSession | null>(null);
  // Detected after mount — SSR can't know, and guessing mismatches hydration.
  const [micSupported, setMicSupported] = useState(false);
  useEffect(() => setMicSupported(webSpeechProvider.isSupported()), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load history ──────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    // role=setting rows are the app's settings store (lib/settings.ts) — never chat.
    const q = () =>
      sb
        .from("assistant_messages")
        .select("*")
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: true })
        .limit(1000);
    const { data, error: err } = await q();
    if (err) {
      setHistoryState("offline");
      return;
    }
    const list = (data ?? []) as DbRow[];
    setThreadsSupported(list.length === 0 || "conversation_id" in (list[0] ?? {}));
    setRows(list);
    setHistoryState("ready");
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const threads: Thread[] = useMemo(() => {
    const by = new Map<string, DbRow[]>();
    for (const r of rows) {
      const key = r.conversation_id || LEGACY_ID;
      const arr = by.get(key) ?? [];
      arr.push(r);
      by.set(key, arr);
    }
    const out: Thread[] = [];
    for (const [id, msgs] of by) {
      const firstUser = msgs.find((m) => m.role === "user")?.content;
      out.push({
        id,
        title: id === LEGACY_ID ? "earlier conversation" : threadTitle(firstUser),
        lastAt: msgs[msgs.length - 1]?.created_at ?? "",
        count: msgs.length,
      });
    }
    // Session-local new threads that have no DB rows yet.
    for (const id of Object.keys(localMsgs)) {
      if (!by.has(id) && localMsgs[id].length) {
        out.push({
          id,
          title: threadTitle(localMsgs[id].find((m) => m.role === "user")?.content),
          lastAt: new Date().toISOString(),
          count: localMsgs[id].length,
        });
      }
    }
    out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    return out;
  }, [rows, localMsgs]);

  // Default to the most recent thread on first load; else a fresh chat.
  useEffect(() => {
    if (historyState !== "ready" || activeId) return;
    setActiveId(threads[0]?.id ?? crypto.randomUUID());
  }, [historyState, threads, activeId]);

  const activeMessages: Msg[] = useMemo(() => {
    if (!activeId) return [];
    const fromDb: Msg[] = rows
      .filter((r) => (r.conversation_id || LEGACY_ID) === activeId)
      .map((r) => ({
        id: r.id,
        role: r.role as "user" | "assistant",
        content: r.content,
        createdAt: r.created_at,
        steps: r.tool_calls ?? undefined,
        // Historical pending cards are stale — never re-executable after reload.
        pending: null,
        // Import jobs ARE re-runnable after reload (dedupe guards repeats).
        job: r.pending_action?.kind === "generate" ? (r.pending_action as GenerateJob) : null,
      }));
    return [...fromDb, ...(localMsgs[activeId] ?? [])];
  }, [rows, localMsgs, activeId]);

  // ── Bottom-anchored scroll: on thread open AND on every new message ───────
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, activeMessages.length, busy]);

  useEffect(() => {
    if (!sidebarHydrated.current) return;
    window.localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);

  // Stop the mic when leaving the page.
  useEffect(() => () => micSession.current?.stop(), []);

  function newChat() {
    micSession.current?.stop();
    setMicState("idle");
    setInterim("");
    setError(null);
    setAttachments([]);
    setActiveId(crypto.randomUUID());
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function deleteThread(id: string) {
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    const del = sb.from("assistant_messages").delete().in("role", ["user", "assistant"]);
    const { error: err } =
      id === LEGACY_ID
        ? await del.is("conversation_id", null)
        : await del.eq("conversation_id", id);
    if (err && id === LEGACY_ID) {
      // Column missing entirely (pre-migration): legacy == everything.
      await sb.from("assistant_messages").delete().in("role", ["user", "assistant"]);
    }
    setLocalMsgs((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    if (activeId === id) setActiveId(crypto.randomUUID());
    void loadHistory();
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const id = crypto.randomUUID();
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext)) {
        setAttachments((a) => [
          ...a,
          {
            id,
            name: f.name,
            size: f.size,
            error: `.${ext || "?"} not supported — text files only (${TEXT_EXTENSIONS.join(", ")})`,
          },
        ]);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setAttachments((a) => [
          ...a,
          {
            id,
            name: f.name,
            size: f.size,
            error: `too large — ${Math.round(MAX_FILE_BYTES / 1000)}KB max`,
          },
        ]);
        continue;
      }
      setAttachments((a) => [...a, { id, name: f.name, size: f.size }]);
      const reader = new FileReader();
      reader.onload = () =>
        setAttachments((a) =>
          a.map((x) => (x.id === id ? { ...x, text: String(reader.result ?? "") } : x)),
        );
      reader.onerror = () =>
        setAttachments((a) => a.map((x) => (x.id === id ? { ...x, error: "read failed" } : x)));
      reader.readAsText(f);
    }
  }

  // ── Voice input ───────────────────────────────────────────────────────────
  async function toggleMic() {
    if (micState !== "idle") {
      micSession.current?.stop();
      micSession.current = null;
      setMicState("idle");
      setInterim("");
      return;
    }
    setMicState("starting");
    setError(null);
    try {
      micSession.current = await webSpeechProvider.start({
        onSegment: (seg) => {
          setInput((cur) => (cur ? cur.replace(/\s+$/, "") + " " : "") + seg.text);
          setInterim("");
        },
        onInterim: (text) => setInterim(text),
        onStateChange: (s) => {
          if (s === "listening") setMicState("listening");
          if (s === "stopped") setMicState("idle");
        },
        onError: (e) => {
          if (e.fatal) {
            setMicState("idle");
            setError(e.message);
            micSession.current = null;
          }
        },
      });
    } catch (e) {
      setMicState("idle");
      setError(e instanceof Error ? e.message : "Microphone unavailable");
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const readyAttachments = attachments.filter((a) => a.text !== undefined && !a.error);
  const canSend = !busy && (input.trim().length > 0 || readyAttachments.length > 0);

  async function send() {
    if (!canSend || !activeId) return;
    micSession.current?.stop();
    micSession.current = null;
    setMicState("idle");
    setInterim("");

    let content = input.trim();
    for (const a of readyAttachments) {
      const text = (a.text ?? "").slice(0, MAX_INLINE_CHARS);
      content += `\n\n[Attached file: ${a.name}]\n${text}${(a.text ?? "").length > MAX_INLINE_CHARS ? "\n…(truncated)" : ""}`;
    }
    const shown = input.trim() || `(sent ${readyAttachments.map((a) => a.name).join(", ")})`;

    setInput("");
    setAttachments([]);
    setError(null);
    const convo = activeId;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: shown };
    setLocalMsgs((m) => ({ ...m, [convo]: [...(m[convo] ?? []), userMsg] }));
    setBusy(true);
    try {
      const priorTurns = activeMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...priorTurns, { role: "user", content }],
          conversationId: convo === LEGACY_ID ? undefined : convo,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `status ${res.status}`);
      setLocalMsgs((m) => ({
        ...m,
        [convo]: [
          ...(m[convo] ?? []),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: j.reply || "",
            steps: j.steps,
            pending: j.pendingAction ?? null,
            job: j.generateJob ?? null,
          },
        ],
      }));
      // A freshly queued import runs immediately — progress shows on its card.
      if (j.generateJob) void runJob(convo, j.generateJob as GenerateJob);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function executeConfirm(msgId: string, action: PendingAction, typedConfirmation?: string) {
    if (!activeId) return;
    const convo = activeId;
    setBusy(true);
    try {
      const res = await fetch("/api/assistant-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, typedConfirmation }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `status ${res.status}`);
      const confirmText =
        action.kind === "delete"
          ? `Done — ${j.count} lead${j.count === 1 ? "" : "s"} in the trash. "Restore recent deletes" undoes it within the hour.`
          : `Done — updated ${j.count} lead${j.count === 1 ? "" : "s"}.`;
      setLocalMsgs((m) => ({
        ...m,
        [convo]: [
          ...(m[convo] ?? []).map((x) =>
            x.id === msgId
              ? { ...x, pending: null, executed: { ok: true, count: j.count, kind: j.kind } }
              : x,
          ),
          { id: crypto.randomUUID(), role: "assistant", content: confirmText },
        ],
      }));
      const row = { role: "assistant", content: confirmText };
      const { error: insErr } = await sb
        .from("assistant_messages")
        .insert([convo === LEGACY_ID ? row : { ...row, conversation_id: convo }]);
      if (insErr && convo !== LEGACY_ID) await sb.from("assistant_messages").insert([row]);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execute failed");
    } finally {
      setBusy(false);
    }
  }

  // ── Enrich-and-import job runner ──────────────────────────────────────────
  // Discovery already happened server-side; this walks the queued candidates
  // through /api/enrich-candidate (concurrency 3), imports the ones that meet
  // the bar as they pass (leads appear in the book live), and posts an honest
  // summary into the conversation when it finishes.
  async function runJob(convo: string, job: GenerateJob) {
    if (jobProgress[job.id]?.status === "running") return;
    cancelledJobs.current.delete(job.id);
    const bump = (patch: Partial<JobProgress>) =>
      setJobProgress((p) => ({
        ...p,
        [job.id]: {
          ...(p[job.id] ?? { status: "running", done: 0, imported: 0, skipped: 0, errors: 0 }),
          ...patch,
        },
      }));
    bump({ status: "running", done: 0, imported: 0, skipped: 0, errors: 0 });

    // Dedupe against the book as it stands right now — re-running a job (or a
    // parallel import) can never create duplicates.
    const startLeads = useLeads.getState().leads;
    const seenNames = new Set(startLeads.map((l) => l.business.toLowerCase().trim()));
    const seenPhones = new Set(
      startLeads.map((l) => (l.phone || "").replace(/\D/g, "")).filter(Boolean),
    );

    let done = 0;
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    let verifiedN = 0;
    let vouchedN = 0;

    let i = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (i < job.candidates.length) {
        if (cancelledJobs.current.has(job.id) || imported >= job.targetCount) return;
        const cand = job.candidates[i++];
        bump({ current: cand.business });
        const nameKey = cand.business.toLowerCase().trim();
        const phoneKey = (cand.phone || "").replace(/\D/g, "");
        if (seenNames.has(nameKey) || (phoneKey && seenPhones.has(phoneKey))) {
          skipped++;
          done++;
          bump({ done, skipped });
          continue;
        }
        try {
          const r = await fetch("/api/enrich-candidate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              business: cand.business,
              city: cand.city,
              state: cand.state,
              phone: cand.phone,
              website: cand.website,
              websiteOpportunity: cand.websiteOpportunity,
              placesSignals: cand.placesSignals,
              offGoogle: cand.offGoogle,
              foundVia: cand.foundVia,
            }),
          });
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || `enrich ${r.status}`);
          const res: EnrichResult = j.result;
          const vouched = placesVouchedClient(res);
          const accept =
            res.verificationTier === "verified" ||
            vouched ||
            (job.includePartial && res.verificationTier === "partial");
          if (accept && imported < job.targetCount && !cancelledJobs.current.has(job.id)) {
            if (res.verificationTier === "verified") verifiedN++;
            else if (vouched) vouchedN++;
            // res.websiteOpportunity carries verification's corrected label
            // (e.g. a site found via search that Google didn't list).
            const oppRaw = res.websiteOpportunity ?? cand.websiteOpportunity;
            const opp = (ALLOWED_OPP as string[]).includes(oppRaw)
              ? (oppRaw as WebsiteOpportunity)
              : "No Dedicated Website";
            const onlinePresence =
              res.discoveredWebsite && !cand.website
                ? `Has a website (${res.discoveredWebsite}) — found via search`
                : cand.onlinePresence || "Discovered via assistant";
            const sources = (cand.sources || []).filter((s): s is LeadSource =>
              (ALLOWED_SOURCES as string[]).includes(s),
            );
            const basePriority =
              useLeads.getState().leads.reduce((m, l) => Math.max(m, l.priority), 0) + 1;
            const lead: Lead = {
              id: crypto.randomUUID(),
              priority: basePriority,
              business: cand.business,
              city: cand.city,
              state: cand.state,
              phone: cand.phone,
              owner: cand.owner || undefined,
              ownerSource: cand.sourceUrl || undefined,
              onlinePresence,
              websiteOpportunity: opp,
              quality: qualityFromOpportunity(opp),
              status: "Not Called",
              sources: sources.length ? sources : ["Other"],
              notes: cand.sourceUrl
                ? `Discovered via: ${cand.sourceUrl}`
                : "Discovered via AI assistant.",
              tags: ["ai-found", "assistant"],
              history: [],
              enrichment: res.enrichment,
              confidenceScore: res.confidenceScore,
              confidenceEvidence: res.confidenceEvidence,
              unverified: res.unverified,
              unverifiedReason: res.unverifiedReason,
              verificationTier: res.verificationTier,
              verificationReasons: res.verificationReasons,
              verification: res.verification,
              leadScore: res.leadScore,
              foundVia: cand.foundVia,
            };
            seenNames.add(nameKey);
            if (phoneKey) seenPhones.add(phoneKey);
            addLeads([lead]);
            imported++;
          } else if (!accept) {
            skipped++;
          }
          done++;
          bump({ done, imported, skipped });
        } catch {
          errors++;
          done++;
          bump({ done, errors });
        }
      }
    });
    await Promise.all(workers);

    const wasCancelled = cancelledJobs.current.has(job.id);
    bump({
      status: wasCancelled ? "cancelled" : "done",
      current: undefined,
      done,
      imported,
      skipped,
      errors,
    });

    const summary = wasCancelled
      ? `Import cancelled — ${imported} lead${imported === 1 ? "" : "s"} made it in before stopping.`
      : `Imported ${imported} of ${job.targetCount} — ${verifiedN} verified, ${vouchedN} Places-vouched. ${skipped} skipped (dupes or below the bar)${errors ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}.${
          imported < job.targetCount && !wasCancelled
            ? " Say the word and I'll widen the net — more cities or sources."
            : ""
        }`;
    setLocalMsgs((m) => ({
      ...m,
      [convo]: [
        ...(m[convo] ?? []),
        { id: crypto.randomUUID(), role: "assistant", content: summary },
      ],
    }));
    const row = { role: "assistant", content: summary };
    const { error: insErr } = await sb
      .from("assistant_messages")
      .insert([convo === LEGACY_ID ? row : { ...row, conversation_id: convo }]);
    if (insErr && convo !== LEGACY_ID) await sb.from("assistant_messages").insert([row]);
    void refresh();
  }

  function cancelPending(msgId: string) {
    if (!activeId) return;
    setLocalMsgs((m) => ({
      ...m,
      [activeId]: (m[activeId] ?? []).map((x) =>
        x.id === msgId
          ? { ...x, pending: null, executed: { ok: false, count: 0, kind: "cancelled" } }
          : x,
      ),
    }));
  }

  const activeThread = threads.find((t) => t.id === activeId);
  const isEmpty = historyState === "ready" && activeMessages.length === 0;

  return (
    <div
      style={MAROON_VARS as React.CSSProperties}
      className="h-screen flex bg-background text-foreground overflow-hidden"
    >
      {/* ── Sidebar: chat history ─────────────────────────────────────────── */}
      <aside
        className={`${sidebarOpen ? "w-72" : "w-0"} shrink-0 transition-all duration-200 border-r border-border bg-card/40 flex flex-col overflow-hidden`}
      >
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <Link to="/" className="inline-flex items-center gap-2 text-foreground hover:opacity-80">
            <Wordmark size={20} />
          </Link>
          <div className="mono text-muted-foreground mt-3">— conversations</div>
          <button
            onClick={newChat}
            className="mono mt-3 w-full inline-flex items-center justify-center gap-2 border border-foreground px-3 py-2 hover:bg-foreground hover:text-background transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> [ NEW CHAT ]
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {historyState === "loading" && (
            <div className="mono text-muted-foreground px-5 py-4 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> loading history…
            </div>
          )}
          {historyState === "offline" && (
            <div className="mono text-[color:var(--sienna)] px-5 py-4 leading-relaxed">
              — history unreachable — new chats still work, they just won't be saved.
            </div>
          )}
          {historyState === "ready" && threads.length === 0 && (
            <div className="mono text-muted-foreground px-5 py-4 leading-relaxed">
              — no conversations yet. Say hello.
            </div>
          )}
          {historyState === "ready" && !threadsSupported && rows.length > 0 && (
            <div className="mono text-muted-foreground/70 px-5 py-3 leading-relaxed border-b border-border">
              — new chats will merge into one thread until the conversations migration is applied
              (see supabase/migrations).
            </div>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-2 px-5 py-2.5 cursor-pointer border-l-2 ${
                t.id === activeId
                  ? "border-foreground bg-foreground/[0.06]"
                  : "border-transparent hover:bg-foreground/[0.04]"
              }`}
              onClick={() => {
                setActiveId(t.id);
                setError(null);
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate font-display">{t.title}</div>
                <div className="mono text-muted-foreground mt-0.5">
                  {fmtDay(t.lastAt)} · {String(t.count).padStart(2, "0")}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteThread(t.id);
                }}
                aria-label="Delete conversation"
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-[color:var(--sienna)] transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-border">
          <Link to="/" className="mono ink-link text-muted-foreground">
            [ ← BACK TO LEADS ]
          </Link>
        </div>
      </aside>

      {/* ── Main panel ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 md:px-10 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle conversation list"
              className="mono text-muted-foreground hover:text-foreground"
            >
              [ {sidebarOpen ? "◂" : "▸"} ]
            </button>
            <div className="min-w-0">
              <div className="mono text-muted-foreground">— assistant</div>
              <h1 className="font-display text-2xl lowercase font-normal leading-tight truncate">
                {activeThread ? activeThread.title : "the assistant"}
              </h1>
            </div>
          </div>
          <div className="mono flex items-center gap-2 shrink-0">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                error
                  ? "bg-[color:var(--sienna)]"
                  : busy
                    ? "bg-[color:var(--frog)] animate-pulse"
                    : "bg-[color:var(--frog)]"
              }`}
            />
            <span className="text-muted-foreground">
              {error ? "ERROR" : busy ? "THINKING…" : "READY"}
            </span>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 md:px-10 py-10 space-y-8">
            {historyState === "loading" && (
              <div className="mono text-muted-foreground flex items-center gap-2 justify-center py-16">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> opening the ledger…
              </div>
            )}
            {isEmpty && (
              <div className="text-center space-y-6 py-14">
                <div aria-hidden className="flex justify-center text-foreground">
                  <BloomFlower className="h-24 w-24" />
                </div>
                <div>
                  <div className="mono text-muted-foreground">— a fresh page</div>
                  <p className="font-display text-2xl lowercase mt-2">what should we work on?</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setInput(q);
                        inputRef.current?.focus();
                      }}
                      className="mono border border-border px-3 py-1.5 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                    >
                      [ {q.toUpperCase()} ]
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeMessages.map((m) => (
              <div key={m.id}>
                {m.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] border border-border bg-card px-4 py-3">
                      <div className="mono text-muted-foreground mb-1">— you</div>
                      <div className="text-[0.95rem] leading-relaxed whitespace-pre-wrap">
                        {m.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 max-w-[92%]">
                    {m.steps && m.steps.length > 0 && (
                      <ul className="space-y-1 border-l border-border pl-4">
                        {pairSteps(m.steps).map((pair, i) => (
                          <li key={i} className="mono text-muted-foreground leading-relaxed">
                            <div>{pair.call.label}</div>
                            {pair.result && (
                              <div
                                className={`pl-4 ${pair.result.ok ? "text-foreground/60" : "text-[color:var(--sienna)]"}`}
                              >
                                {pair.result.ok ? "✓" : "✗"} {pair.result.summary}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.content && (
                      <div className="font-display text-[1.12rem] leading-relaxed whitespace-pre-wrap">
                        {m.content}
                      </div>
                    )}
                    {m.pending && (
                      <ConfirmationCard
                        pending={m.pending}
                        onConfirm={(t) => executeConfirm(m.id, m.pending!, t)}
                        onCancel={() => cancelPending(m.id)}
                        busy={busy}
                      />
                    )}
                    {m.job && (
                      <JobCard
                        job={m.job}
                        progress={jobProgress[m.job.id]}
                        onRun={() => activeId && void runJob(activeId, m.job!)}
                        onCancel={() => cancelledJobs.current.add(m.job!.id)}
                      />
                    )}
                    {m.executed && (
                      <div className="mono text-muted-foreground">
                        {m.executed.kind === "cancelled"
                          ? "— cancelled —"
                          : `— ${m.executed.kind} confirmed —`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="mono text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> thinking…
              </div>
            )}
            {error && (
              <div className="mono text-[color:var(--sienna)] border border-[color:var(--sienna)]/40 px-4 py-3">
                — {error}
              </div>
            )}
          </div>
        </div>

        {/* ── Input bar — fixed to the bottom of the panel ─────────────────── */}
        <div
          className={`shrink-0 border-t ${dragOver ? "border-[color:var(--frog)]" : "border-border"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
        >
          <div className="max-w-3xl mx-auto px-6 md:px-10 py-4">
            {dragOver && (
              <div className="mono text-[color:var(--frog-ink)] mb-2">
                — drop the file to attach it —
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className={`mono inline-flex items-center gap-2 border px-2 py-1 ${
                      a.error
                        ? "border-[color:var(--sienna)] text-[color:var(--sienna)]"
                        : "border-border text-foreground"
                    }`}
                  >
                    <Paperclip className="h-3 w-3" />
                    {a.name}
                    {a.error
                      ? ` — ${a.error}`
                      : a.text === undefined
                        ? " — reading…"
                        : ` · ${Math.max(1, Math.round(a.size / 1000))}KB`}
                    <button
                      onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}
                      aria-label={`Remove ${a.name}`}
                      className="hover:text-[color:var(--sienna)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {micState !== "idle" && (
              <div className="mono text-[color:var(--frog-ink)] mb-2 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--frog)] animate-pulse" />
                {micState === "starting" ? "starting mic…" : "listening — tap the mic to stop"}
                {interim && <span className="text-muted-foreground italic">“{interim}”</span>}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={TEXT_EXTENSIONS.map((e) => "." + e).join(",")}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                aria-label="Attach a file"
                title="Attach a text/CSV file (or drag one in)"
                className="p-2.5 border border-border text-muted-foreground hover:text-foreground hover:border-foreground disabled:opacity-40 transition-colors"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                onClick={() => void toggleMic()}
                disabled={busy || !micSupported}
                aria-label={micState === "idle" ? "Start voice input" : "Stop voice input"}
                title={micSupported ? "Talk instead of typing" : "Voice needs Chrome or Edge"}
                className={`p-2.5 border transition-colors disabled:opacity-40 ${
                  micState !== "idle"
                    ? "border-[color:var(--frog)] text-[color:var(--frog-ink)] bg-[color:var(--frog-tint)]"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                }`}
              >
                <Mic className="h-4 w-4" />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={
                  micState === "listening" ? "listening…" : "ask or instruct — enter to send"
                }
                className="mono flex-1 bg-card/60 border border-border px-3 py-2.5 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-foreground resize-none"
                style={{ fontSize: "13px" }}
                disabled={busy}
              />
              <button
                onClick={() => void send()}
                disabled={!canSend}
                className="mono px-4 py-2.5 bg-foreground text-background hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                SEND
              </button>
            </div>
            <div className="mono text-muted-foreground/60 mt-2">
              enter to send · shift+enter for a new line · drop a .csv/.txt to attach
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function JobCard({
  job,
  progress,
  onRun,
  onCancel,
}: {
  job: GenerateJob;
  progress?: JobProgress;
  onRun: () => void;
  onCancel: () => void;
}) {
  const total = job.candidates.length;
  const towns = job.cities.map((c) => c.split(",")[0]).join(" · ");
  return (
    <div className="border border-border bg-card p-4 space-y-3">
      <div className="mono text-foreground flex items-center justify-between gap-3 flex-wrap">
        <span>
          IMPORT RUN — {String(job.targetCount).padStart(2, "0")} {job.industry.toUpperCase()}
        </span>
        <span className="text-muted-foreground">{towns}</span>
      </div>
      {!progress && (
        <div className="space-y-2">
          <div className="mono text-muted-foreground">
            {String(total).padStart(2, "0")} candidates queued — not yet enriched.
          </div>
          <button
            onClick={onRun}
            className="mono border border-foreground px-3 py-1.5 hover:bg-foreground hover:text-background"
          >
            [ RUN IMPORT ]
          </button>
        </div>
      )}
      {progress && (
        <div className="space-y-2">
          <div className="h-px bg-border">
            <div
              className="h-px bg-[color:var(--frog)] transition-all"
              style={{ width: `${total ? (progress.done / total) * 100 : 0}%` }}
            />
          </div>
          <div className="mono text-muted-foreground flex items-center gap-3 flex-wrap">
            <span>
              {String(progress.done).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
            <span className="text-[color:var(--frog-ink)]">
              IMPORTED {String(progress.imported).padStart(2, "0")}
            </span>
            <span>SKIPPED {String(progress.skipped).padStart(2, "0")}</span>
            {progress.errors > 0 && (
              <span className="text-[color:var(--sienna)]">
                ERRORS {String(progress.errors).padStart(2, "0")}
              </span>
            )}
            {progress.status === "running" && progress.current && (
              <span className="truncate max-w-[16rem]">— {progress.current}</span>
            )}
          </div>
          {progress.status === "running" && (
            <div className="flex items-center gap-4">
              <span className="mono text-muted-foreground/70 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> keep this page open while it runs
              </span>
              <button onClick={onCancel} className="mono ink-link">
                [ CANCEL ]
              </button>
            </div>
          )}
          {progress.status === "done" && (
            <div className="mono text-muted-foreground">— run complete —</div>
          )}
          {progress.status === "cancelled" && (
            <div className="mono text-muted-foreground">— cancelled —</div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfirmationCard({
  pending,
  onConfirm,
  onCancel,
  busy,
}: {
  pending: PendingAction;
  onConfirm: (typed?: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const requireTyped = pending.kind === "delete" && pending.requireTyped;
  const [typed, setTyped] = useState("");
  const canConfirm = !busy && (!requireTyped || typed === "DELETE ALL");
  return (
    <div className="border border-foreground bg-card p-4 space-y-3">
      <div className="mono text-foreground">
        {pending.kind === "delete" ? "CONFIRM DELETE" : "CONFIRM BULK UPDATE"}
      </div>
      <div className="text-sm leading-relaxed">{pending.preview}</div>
      {requireTyped && (
        <div>
          <div className="mono text-muted-foreground mb-1">TYPE "DELETE ALL" TO CONFIRM</div>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mono w-full bg-transparent border border-border p-2 focus:outline-none focus:border-foreground text-foreground"
            style={{ fontSize: "12px" }}
            placeholder="DELETE ALL"
          />
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onConfirm(typed || undefined)}
          disabled={!canConfirm}
          className="mono border border-foreground px-3 py-1 hover:bg-foreground hover:text-background disabled:opacity-40"
        >
          [ CONFIRM ]
        </button>
        <button onClick={onCancel} disabled={busy} className="mono ink-link">
          [ CANCEL ]
        </button>
      </div>
    </div>
  );
}
