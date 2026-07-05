import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { LEADS_TABLE, mcpSupabase } from "../supabase";

const STATUSES = [
  "Not Called", "Called", "Voicemail", "Callback Scheduled",
  "Zoom Booked", "Sold", "Not Interested",
] as const;

export default defineTool({
  name: "update_lead_status",
  title: "Update lead status",
  description: "Update a lead's status and append a history entry. Sets lastContacted to now.",
  inputSchema: {
    id: z.string().min(1),
    status: z.enum(STATUSES),
    note: z.string().optional().describe("Optional note to attach to the history entry"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ id, status, note }) => {
    const supabase = mcpSupabase();
    const { data: existing, error: readErr } = await supabase
      .from(LEADS_TABLE).select("history").eq("id", id).maybeSingle();
    if (readErr) return { content: [{ type: "text", text: readErr.message }], isError: true };
    if (!existing) return { content: [{ type: "text", text: `No lead with id ${id}` }], isError: true };
    const now = new Date().toISOString();
    const history = Array.isArray(existing.history) ? existing.history : [];
    history.push({ id: crypto.randomUUID(), date: now, status, note });
    const { error } = await supabase
      .from(LEADS_TABLE)
      .update({ status, lastContacted: now, history })
      .eq("id", id);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Updated lead ${id} to status "${status}".` }],
      structuredContent: { id, status, lastContacted: now },
    };
  },
});