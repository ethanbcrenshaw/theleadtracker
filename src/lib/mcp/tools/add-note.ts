import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { LEADS_TABLE, mcpSupabase } from "../supabase";

export default defineTool({
  name: "add_lead_note",
  title: "Add lead note",
  description: "Append a note to a lead's notes field (separated by a blank line).",
  inputSchema: {
    id: z.string().min(1),
    note: z.string().min(1),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ id, note }) => {
    const supabase = mcpSupabase();
    const { data: existing, error: readErr } = await supabase
      .from(LEADS_TABLE).select("notes").eq("id", id).maybeSingle();
    if (readErr) return { content: [{ type: "text", text: readErr.message }], isError: true };
    if (!existing) return { content: [{ type: "text", text: `No lead with id ${id}` }], isError: true };
    const nextNotes = existing.notes ? `${existing.notes}\n\n${note}` : note;
    const { error } = await supabase.from(LEADS_TABLE).update({ notes: nextNotes }).eq("id", id);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return { content: [{ type: "text", text: `Note added to lead ${id}.` }], structuredContent: { id } };
  },
});