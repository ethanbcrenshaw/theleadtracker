import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { enrichLeadFull, hostOf } from "@/lib/enrichment.server";
import { runVerificationChecks, type PlacesSignals } from "@/lib/verification.server";
import { getAI } from "@/lib/ai.server";

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
        const ai = getAI();
        if (!firecrawlKey)
          return Response.json({ error: "FIRECRAWL_API_KEY not configured" }, { status: 500 });

        let body: {
          business?: string;
          city?: string;
          state?: string;
          phone?: string;
          website?: string | null;
          websiteOpportunity?: string;
          placesSignals?: PlacesSignals;
          offGoogle?: boolean;
          foundVia?: string[];
        };
        try {
          body = await request.json();
        } catch {
          body = {};
        }
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
            { firecrawlKey, ai },
          );
          // Phase 2 verification pass: website liveness/freshness + business
          // signals + composite lead score. 5s timeouts, never throws.
          const { verification, leadScore } = await runVerificationChecks({
            website: body.website,
            phone: body.phone,
            tier: result.verificationTier,
            signals: body.placesSignals,
            offGoogle: body.offGoogle,
            foundVia: body.foundVia,
          });
          return Response.json({ ok: true, result: { ...result, verification, leadScore } });
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
