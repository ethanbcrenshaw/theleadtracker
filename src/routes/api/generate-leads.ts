import { createFileRoute } from "@tanstack/react-router";
// Side-effect import to activate `server` route option augmentation
import "@tanstack/react-start";
import { discoverCandidates } from "@/lib/discover.server";

// NOTE: Enrichment is intentionally NOT done here. The client (AIGenerateModal)
// enriches + verifies each candidate one-by-one via /api/enrich-candidate so it
// can show per-lead progress. This route only discovers candidates via Google
// Places (shared implementation in src/lib/discover.server.ts), which also
// discards CLOSED businesses and attaches business-alive signals
// (status / rating / review count / most recent review).

export const Route = createFileRoute("/api/generate-leads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;
        if (!apiKey)
          return Response.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 500 });

        let body: { industry?: string; city?: string; count?: number; type?: string };
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const industry = (body.industry || "upholstery").trim();
        const city = (body.city || "Nashville, TN").trim();
        const count = Math.max(1, Math.min(15, body.count || 5));
        const type = body.type || "No Dedicated Website";

        try {
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
