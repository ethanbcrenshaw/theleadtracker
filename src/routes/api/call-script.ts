import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import type { CallScript, Lead, LeadEnrichment } from "@/lib/types";
import { aiExtract, getAI } from "@/lib/ai.server";

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

type LeadInput = Pick<Lead, "business" | "city" | "state" | "websiteOpportunity" | "phone"> & {
  enrichment?: LeadEnrichment;
};

export const Route = createFileRoute("/api/call-script")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { lead } = (await request.json()) as { lead?: LeadInput };
          if (!lead || !lead.business) {
            return Response.json({ error: "Missing lead" }, { status: 400 });
          }
          const ai = getAI();
          if (!ai)
            return Response.json(
              {
                error:
                  "AI not configured — set ANTHROPIC_API_KEY, GEMINI_API_KEY, or LOVABLE_API_KEY",
              },
              { status: 500 },
            );

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
            enr?.profiles?.length ? `Profiles: ${enr.profiles.map((p) => p.type).join(", ")}` : "",
            enr?.pitchAngle ? `Prior pitch angle: ${enr.pitchAngle}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          const parsed = await aiExtract<{
            opener: string;
            pitchAngle: string;
            discovery?: string[];
            objections?: Array<{ objection: string; response: string }>;
          }>(ai, {
            system:
              "You are a sales coach for a solo web designer cold-calling local businesses. Produce a TIGHT pre-call script tailored to the specific business. Ground every line in the enrichment data provided — reference real ratings, review counts, hours, or activity when they exist. If enrichment is thin, keep it conservative and generic instead of making up facts. Objection responses must be practical and short (1-2 sentences). Never invent numbers.",
            user: ctx,
            toolName: "build_call_script",
            toolDescription: "Build a tailored pre-call script.",
            schema: SCHEMA,
          });
          if (!parsed) return Response.json({ error: "No structured output" }, { status: 500 });
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
