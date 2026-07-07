import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { enrichLeadFull, hostOf } from "@/lib/enrichment.server";

/**
 * Enrich + verify a single candidate lead (not yet in DB). Called from
 * AIGenerateModal one at a time with concurrency, so the modal can show
 * "researching N/M…" progress.
 */
export const Route = createFileRoute("/api/enrich-candidate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const firecrawlKey = process.env.FIRECRAWL_API_KEY;
        const aiKey = process.env.LOVABLE_API_KEY;
        if (!firecrawlKey) return Response.json({ error: "FIRECRAWL_API_KEY not configured" }, { status: 500 });

        let body: {
          business?: string; city?: string; state?: string; phone?: string;
          website?: string | null; websiteOpportunity?: string;
        };
        try { body = await request.json(); } catch { body = {}; }
        if (!body.business) return Response.json({ error: "business required" }, { status: 400 });

        try {
          const result = await enrichLeadFull(
            {
              business: body.business,
              city: body.city || "",
              state: body.state || "",
              phone: body.phone || "",
              website: body.website ? hostOf(body.website) : null,
              websiteOpportunity: body.websiteOpportunity,
            },
            { firecrawlKey, aiKey },
          );
          return Response.json({ ok: true, result });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
        }
      },
    },
  },
});
