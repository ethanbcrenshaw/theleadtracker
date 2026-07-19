import { createFileRoute } from "@tanstack/react-router";
// Side-effect import to activate `server` route option augmentation
import "@tanstack/react-start";
import { discoverCandidates } from "@/lib/discover.server";
import { availableSources, runDiscovery, type DiscoverySourceId } from "@/lib/discovery";

// NOTE: Enrichment is intentionally NOT done here. The client (AIGenerateModal)
// enriches + verifies each candidate one-by-one via /api/enrich-candidate so it
// can show per-lead progress.
//
// Discovery is multi-source (src/lib/discovery/): pass `sources` (ids) and
// `expandMetro` to fan out. When `sources` is absent the legacy Places-only
// single-query path runs — that keeps the assistant's call shape and any old
// clients behaving exactly as before. GET returns which sources are
// configured (for the modal's toggle chips).

const KNOWN_SOURCES: DiscoverySourceId[] = [
  "places",
  "firecrawl-search",
  "foursquare",
  "knox-registry",
];

export const Route = createFileRoute("/api/generate-leads")({
  server: {
    handlers: {
      GET: async () => Response.json({ sources: availableSources() }),
      POST: async ({ request }) => {
        let body: {
          industry?: string;
          city?: string;
          count?: number;
          type?: string;
          sources?: string[];
          expandMetro?: boolean;
        };
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const industry = (body.industry || "upholstery").trim();
        const city = (body.city || "Nashville, TN").trim();
        // Enrichment happens client-side per candidate, so big batches are
        // safe — the cap only bounds discovery fan-out.
        const count = Math.max(1, Math.min(40, body.count || 5));
        const type = body.type || "No Dedicated Website";

        try {
          // Multi-source path (new UI).
          if (Array.isArray(body.sources)) {
            const sources = body.sources.filter((s): s is DiscoverySourceId =>
              (KNOWN_SOURCES as string[]).includes(s),
            );
            const result = await runDiscovery(
              { industry, city, count, type, expandMetro: Boolean(body.expandMetro) },
              { sources },
            );
            return Response.json({
              leads: result.candidates,
              perSource: result.perSource,
              droppedExisting: result.droppedExisting,
              notes: result.notes,
              requestedType: type,
            });
          }

          // Legacy Places-only path (assistant + old clients).
          const apiKey = process.env.GOOGLE_PLACES_API_KEY;
          if (!apiKey)
            return Response.json(
              { error: "GOOGLE_PLACES_API_KEY not configured" },
              { status: 500 },
            );
          const leads = await discoverCandidates({ industry, city, count, type, apiKey });
          return Response.json({ leads, requestedType: type });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 502 });
        }
      },
    },
  },
});
