import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLeads } from "@/lib/store";
import { BloomFlower } from "./BloomFlower";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Step =
  | { type: "tool_call"; name: string; label: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; label: string; ok: boolean; summary: string };

type PendingAction =
  | { kind: "delete"; scope: string; ids: string[]; requireTyped?: boolean; preview: string }
  | { kind: "update"; ids: string[]; changes: Record<string, unknown>; preview: string };

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: Step[];
  pending?: PendingAction | null;
  executed?: { ok: boolean; count: number; kind: string } | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
}

const HINT =
  "Try: how many verified roofers do I have · generate 3 upholstery leads in Franklin, TN · re-verify partial leads · scrap all unverified · what's stale · research salons in Franklin";

type CallStep = Extract<Step, { type: "tool_call" }>;
type ResultStep = Extract<Step, { type: "tool_result" }>;

function pairSteps(steps: Step[]): Array<{ call: CallStep; result?: ResultStep }> {
  const out: Array<{ call: CallStep; result?: ResultStep }> = [];
  const results = steps.filter((s): s is ResultStep => s.type === "tool_result");
  const calls = steps.filter((s): s is CallStep => s.type === "tool_call");
  calls.forEach((call, i) => out.push({ call, result: results[i] }));
  return out;
}

export function AssistantPanel({ open, onClose }: Props) {
  const refresh = useLeads((s) => s.refresh);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // role=setting rows are the app's settings store (see lib/settings.ts) — not chat.
      const { data } = await sb
        .from("assistant_messages")
        .select("*")
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: true })
        .limit(200);
      if (cancelled || !data) return;
      const restored: Msg[] = data.map(
        (r: {
          id: string;
          role: string;
          content: string;
          tool_calls: Step[] | null;
          pending_action: PendingAction | null;
        }) => ({
          id: r.id,
          role: r.role as "user" | "assistant",
          content: r.content,
          steps: r.tool_calls ?? undefined,
          pending: r.pending_action ?? null,
        }),
      );
      setMessages(restored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text };
    const nextMsgs = [...messages, userMsg];
    setMessages(nextMsgs);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMsgs.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `status ${res.status}`);
      setMessages((cur) => [
        ...cur,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: j.reply || "",
          steps: j.steps,
          pending: j.pendingAction ?? null,
        },
      ]);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function executeConfirm(msgId: string, action: PendingAction, typedConfirmation?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/assistant-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, typedConfirmation }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `status ${res.status}`);
      setMessages((cur) =>
        cur.map((m) =>
          m.id === msgId
            ? { ...m, pending: null, executed: { ok: true, count: j.count, kind: j.kind } }
            : m,
        ),
      );
      // Add a system-like assistant confirmation message.
      const confirmText =
        action.kind === "delete"
          ? `Done. ${j.count} lead${j.count === 1 ? "" : "s"} moved to the trash — say "restore recent deletes" within the hour to bring them back.`
          : `Done. Updated ${j.count} lead${j.count === 1 ? "" : "s"}.`;
      setMessages((cur) => [
        ...cur,
        { id: crypto.randomUUID(), role: "assistant", content: confirmText },
      ]);
      await sb.from("assistant_messages").insert([{ role: "assistant", content: confirmText }]);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execute failed");
    } finally {
      setBusy(false);
    }
  }

  function cancelPending(msgId: string) {
    setMessages((cur) =>
      cur.map((m) =>
        m.id === msgId
          ? { ...m, pending: null, executed: { ok: false, count: 0, kind: "cancelled" } }
          : m,
      ),
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/40 z-40 md:hidden"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] md:w-[440px] bg-background border-l border-foreground flex flex-col"
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <div className="mono text-muted-foreground">— assistant</div>
                <h2 className="font-display text-2xl lowercase font-normal mt-1">the assistant</h2>
              </div>
              <button onClick={onClose} aria-label="Close" className="p-1 hover:bg-foreground/10">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {messages.length === 0 && (
                <div className="space-y-5">
                  <div aria-hidden className="flex justify-center py-4 text-foreground">
                    <BloomFlower className="h-20 w-20" />
                  </div>
                  <div className="mono text-muted-foreground text-center">— what i can do —</div>
                  <div className="mono text-muted-foreground leading-relaxed text-center">
                    {HINT}
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  {m.role === "user" ? (
                    <div className="mono text-foreground border-l-2 border-foreground pl-3">
                      {m.content}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {m.steps && m.steps.length > 0 && (
                        <ul className="space-y-0.5">
                          {pairSteps(m.steps).map((pair, i) => (
                            <li key={i} className="mono text-muted-foreground leading-relaxed">
                              <div>{pair.call.label}</div>
                              {pair.result && (
                                <div
                                  className={`pl-4 ${pair.result.ok ? "text-foreground/70" : "text-[color:var(--sienna)]"}`}
                                >
                                  {pair.result.ok ? "✓" : "✗"} {pair.result.summary}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {m.content && (
                        <div className="font-display text-[1.05rem] leading-relaxed text-foreground whitespace-pre-wrap">
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
              {error && <div className="mono text-[color:var(--sienna)]">— {error}</div>}
            </div>

            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2">
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
                  placeholder="ASK OR INSTRUCT…"
                  className="mono flex-1 bg-transparent border border-border p-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground resize-none"
                  style={{ fontSize: "12px" }}
                  disabled={busy}
                />
                <button
                  onClick={() => void send()}
                  disabled={busy || !input.trim()}
                  className="mono px-3 py-2 bg-foreground text-background hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1"
                >
                  <Send className="h-3 w-3" /> SEND
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
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
    <div className="border border-foreground tint-frog p-4 space-y-3">
      <div className="mono text-foreground">
        {pending.kind === "delete" ? "CONFIRM DELETE" : "CONFIRM BULK UPDATE"}
      </div>
      <div className="text-sm text-foreground leading-relaxed">{pending.preview}</div>
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
