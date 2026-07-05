import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { LEADS_TABLE, mcpSupabase } from "../supabase";

export default defineTool({
  name: "search_leads",
  title: "Search leads",
  description: "Search leads by business name or city (case-insensitive substring match).",
  inputSchema: {
    query: z.string().min(1).describe("Text to match against business name or city"),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }) => {
    const supabase = mcpSupabase();
    const like = `%${query}%`;
    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .select("*")
      .or(`business.ilike.${like},city.ilike.${like}`)
      .limit(limit ?? 50);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { leads: data ?? [], count: data?.length ?? 0 },
    };
  },
});