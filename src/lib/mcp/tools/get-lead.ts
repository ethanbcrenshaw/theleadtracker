import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { LEADS_TABLE, mcpSupabase } from "../supabase";

export default defineTool({
  name: "get_lead",
  title: "Get lead",
  description: "Fetch a single lead by ID, including notes, history, and any call records.",
  inputSchema: { id: z.string().min(1).describe("The lead ID") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }) => {
    const supabase = mcpSupabase();
    const { data, error } = await supabase.from(LEADS_TABLE).select("*").eq("id", id).maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: `No lead with id ${id}` }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { lead: data },
    };
  },
});