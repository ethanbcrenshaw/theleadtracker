import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { LEADS_TABLE, mcpSupabase } from "../supabase";

export default defineTool({
  name: "list_followups_due",
  title: "List follow-ups due",
  description: "List leads whose next follow-up date is today or earlier (most overdue first).",
  inputSchema: { limit: z.number().int().min(1).max(200).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }) => {
    const supabase = mcpSupabase();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .select("*")
      .not("nextFollowUp", "is", null)
      .lte("nextFollowUp", endOfToday.toISOString())
      .order("nextFollowUp", { ascending: true })
      .limit(limit ?? 50);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { leads: data ?? [], count: data?.length ?? 0 },
    };
  },
});