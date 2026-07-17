import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

type Body = {
  action:
    | { kind: "delete"; ids: string[]; scope: string; requireTyped?: boolean }
    | { kind: "update"; ids: string[]; changes: Record<string, unknown> };
  typedConfirmation?: string;
};

function makeSb(): Sb {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const Route = createFileRoute("/api/assistant-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad JSON" }, { status: 400 });
        }
        const { action, typedConfirmation } = body;
        if (!action || !Array.isArray(action.ids))
          return Response.json({ error: "action required" }, { status: 400 });

        const sb = makeSb();

        if (action.kind === "delete") {
          if (action.requireTyped && typedConfirmation !== "DELETE ALL") {
            return Response.json({ error: "typed confirmation required" }, { status: 400 });
          }
          if (!action.ids.length) return Response.json({ ok: true, count: 0 });
          const now = new Date().toISOString();
          const { error } = await sb.from("leads").update({ deleted_at: now }).in("id", action.ids);
          if (error) return Response.json({ error: error.message }, { status: 500 });
          return Response.json({ ok: true, count: action.ids.length, kind: "delete" });
        }

        if (action.kind === "update") {
          if (!action.ids.length) return Response.json({ ok: true, count: 0 });
          const changes = action.changes || {};
          const addTag = typeof changes.addTag === "string" ? changes.addTag : null;
          const status = typeof changes.status === "string" ? (changes.status as string) : null;
          // Non-status/non-tag fields (e.g. an already-ISO nextFollowUp) apply flat.
          const patch: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(changes)) {
            if (k !== "addTag" && k !== "status") patch[k] = v;
          }
          if (Object.keys(patch).length) {
            const { error } = await sb.from("leads").update(patch).in("id", action.ids);
            if (error) return Response.json({ error: error.message }, { status: 500 });
          }
          // A status change must append history + stamp lastContacted, matching
          // the UI and MCP paths — otherwise the change is missing from the
          // lead's timeline and "last contacted" is wrong.
          if (status) {
            const now = new Date().toISOString();
            const { data: rows } = await sb.from("leads").select("id,history").in("id", action.ids);
            for (const r of (rows ?? []) as Array<{ id: string; history: unknown[] | null }>) {
              const history = Array.isArray(r.history) ? r.history : [];
              history.push({ id: crypto.randomUUID(), date: now, status });
              await sb.from("leads").update({ status, lastContacted: now, history }).eq("id", r.id);
            }
          }
          if (addTag) {
            const { data: rows } = await sb.from("leads").select("id,tags").in("id", action.ids);
            for (const r of (rows ?? []) as Array<{ id: string; tags: string[] | null }>) {
              const next = Array.from(new Set([...(r.tags ?? []), addTag]));
              await sb.from("leads").update({ tags: next }).eq("id", r.id);
            }
          }
          return Response.json({ ok: true, count: action.ids.length, kind: "update" });
        }

        return Response.json({ error: "unknown action" }, { status: 400 });
      },
    },
  },
});
