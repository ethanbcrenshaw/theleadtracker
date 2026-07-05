import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import type { CallScript, Lead, LeadEnrichment } from "@/lib/types";

const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SCHEMA = {
  type: "object",
  properties: {
    opener: {
      type: "string",
      description:
        "One-sentence opener that references something concrete from enrichment (rating, review count, FB activity, hours). If nothing concrete, use a neutral opener.",
    },
    pitchAngle: {
      type: "string",
      description: "1-2 sentence pitch tailored to this business's website opportunity.",
    },
    discovery: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "string" },
      description: "2-3 discovery questions fitted to this business type.",
    },
    objections: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          objection: { type: "string" },
          response: { type: "string" },
        },
        required: ["objection", "response"],
        additionalProperties: false,
      },
      description:
        "Likely objections with concrete responses grounded in enrichment evidence when possible.",
    },
  },
  required: ["opener", "pitchAngle", "discovery", "objections"],
  additionalProperties: false,
};

type LeadInput = Pick<
  Lead,
  | "business"
  | "city"
  | "state"
  | "websiteOpportunity"
  | "phone"
> & { enrichment?: LeadEnrichment };

export const Route = createFileRoute("/api/call-script")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { lead } = (await request.json()) as { lead?: LeadInput };
          if (!lead || !lead.business) {
            return Response.json({ error: "Missing lead" }, { status: 400 });
          }
          const key = process.env.LOVABLE_API_KEY;
          if (!key) return Response.json({ error: "AI gateway not configured" }, { status: 500 });

          const enr = lead.enrichment;
          const ctx = [
            `Business: ${lead.business}`,
            `Location: ${lead.city}, ${lead.state}`,
            `Website opportunity: ${lead.websiteOpportunity}`,
            enr?.verifiedSummary ? `Verified summary: ${enr.verifiedSummary}` : "",
            enr?.reviews?.length
              ? `Reviews: ${enr.reviews
                  .map((r) => `${r.source} ${r.rating ?? "?"}★ · ${r.count ?? 0} reviews`)
                  .join("; ")}`
              : "",
            enr?.hours ? `Hours: ${enr.hours}` : "",
            enr?.ownerName ? `Owner: ${enr.ownerName}` : "",
            enr?.recentActivity ? `Recent activity: ${enr.recentActivity}` : "",
            enr?.profiles?.length
              ? `Profiles: ${enr.profiles.map((p) => p.type).join(", ")}`
              : "",
            enr?.pitchAngle ? `Prior pitch angle: ${enr.pitchAngle}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          const res = await fetch(AI, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a sales coach for a solo web designer cold-calling local businesses. Produce a TIGHT pre-call script tailored to the specific business. Ground every line in the enrichment data provided — reference real ratings, review counts, hours, or activity when they exist. If enrichment is thin, keep it conservative and generic instead of making up facts. Objection responses must be practical and short (1-2 sentences). Never invent numbers.",
                },
                { role: "user", content: ctx },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "build_call_script",
                    description: "Build a tailored pre-call script.",
                    parameters: SCHEMA,
                  },
                },
              ],
              tool_choice: { type: "function", function: { name: "build_call_script" } },
            }),
          });

          if (!res.ok) {
            const txt = await res.text();
            return Response.json(
              { error: `AI gateway ${res.status}: ${txt.slice(0, 200)}` },
              { status: res.status === 429 || res.status === 402 ? res.status : 500 },
            );
          }
          const data = await res.json();
          const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          if (!args) return Response.json({ error: "No structured output" }, { status: 500 });
          const parsed = JSON.parse(args);
          const script: CallScript = {
            opener: parsed.opener,
            pitchAngle: parsed.pitchAngle,
            discovery: parsed.discovery ?? [],
            objections: parsed.objections ?? [],
            generatedAt: new Date().toISOString(),
            enrichedAt: enr?.enrichedAt,
          };
          return Response.json({ ok: true, script });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Unknown error" },
            { status: 500 },
          );
        }
      },
    },
  },
});