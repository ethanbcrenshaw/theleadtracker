import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { LEADS_TABLE, mcpSupabase } from "../supabase";

export default defineTool({
  name: "schedule_followup",
  title: "Schedule follow-up",
  description: "Set or clear a lead's next follow-up date (ISO 8601). Pass null to clear.",
  inputSchema: {
    id: z.string().min(1),
    nextFollowUp: z.string().nullable().describe("ISO 8601 date/time, or null to clear"),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, nextFollowUp }) => {
    const supabase = mcpSupabase();
    const { error } = await supabase.from(LEADS_TABLE).update({ nextFollowUp }).eq("id", id);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Follow-up for lead ${id} ${nextFollowUp ? `set to ${nextFollowUp}` : "cleared"}.` }],
      structuredContent: { id, nextFollowUp },
    };
  },
});