import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { LEADS_TABLE, mcpSupabase } from "../supabase";

const STATUSES = [
  "Not Called", "Called", "Voicemail", "Callback Scheduled",
  "Zoom Booked", "Sold", "Not Interested",
] as const;
const QUALITIES = ["High", "Medium", "Low"] as const;

export default defineTool({
  name: "list_leads",
  title: "List leads",
  description: "List leads from the CRM, optionally filtered by status, quality, or city. Returns up to `limit` leads.",
  inputSchema: {
    status: z.enum(STATUSES).optional().describe("Filter by lead status"),
    quality: z.enum(QUALITIES).optional().describe("Filter by quality tier"),
    city: z.string().optional().describe("Filter by city (exact match)"),
    limit: z.number().int().min(1).max(200).optional().describe("Max leads to return (default 50)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, quality, city, limit }) => {
    const supabase = mcpSupabase();
    let q = supabase.from(LEADS_TABLE).select("*").order("priority", { ascending: true }).limit(limit ?? 50);
    if (status) q = q.eq("status", status);
    if (quality) q = q.eq("quality", quality);
    if (city) q = q.eq("city", city);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { leads: data ?? [], count: data?.length ?? 0 },
    };
  },
});