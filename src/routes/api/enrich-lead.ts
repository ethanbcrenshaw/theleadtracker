import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { enrichLeadFull } from "@/lib/enrichment.server";
import { hostOf } from "@/lib/enrichment.server";
import { runVerificationChecks } from "@/lib/verification.server";
import { getAI } from "@/lib/ai.server";
import { createClient } from "@supabase/supabase-js";
import type { LeadVerification } from "@/lib/types";

type LeadRow = {
  id: string;
  business: string;
  city: string;
  state: string;
  phone: string;
  websiteOpportunity: string;
  onlinePresence: string;
  verification: LeadVerification | null;
};

/**
 * Re-research a single existing lead. Reads the row, enriches via Firecrawl +
 * Lovable AI, persists the enrichment fields back to Supabase, and returns
 * the updates so the client can patch its store.
 */
export const Route = createFileRoute("/api/enrich-lead")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const firecrawlKey = process.env.FIRECRAWL_API_KEY;
        const ai = getAI();
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!firecrawlKey)
          return Response.json({ error: "FIRECRAWL_API_KEY not configured" }, { status: 500 });
        if (!supabaseUrl || !supabaseKey)
          return Response.json({ error: "Supabase not configured" }, { status: 500 });

        let body: { leadId?: string };
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const leadId = body.leadId?.trim();
        if (!leadId) return Response.json({ error: "leadId required" }, { status: 400 });

        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: row, error: readErr } = await supabase
          .from("leads")
          .select('id,business,city,state,phone,"websiteOpportunity","onlinePresence",verification')
          .eq("id", leadId)
          .maybeSingle();
        if (readErr) return Response.json({ error: readErr.message }, { status: 500 });
        if (!row) return Response.json({ error: "Lead not found" }, { status: 404 });

        const lead = row as LeadRow;
        // Try to recover a website host from the current presence string (e.g. "Has a website (foo.com)").
        let website: string | null = null;
        const m = lead.onlinePresence?.match(/\(([^)]+\.[a-z]{2,})\)/i);
        if (m) website = hostOf(m[1]);

        try {
          const result = await enrichLeadFull(
            {
              business: lead.business,
              city: lead.city,
              state: lead.state,
              phone: lead.phone,
              website,
              websiteOpportunity: lead.websiteOpportunity,
            },
            { firecrawlKey, ai },
          );

          // Phase 2 verification pass. Re-verify has no fresh Places response,
          // so business-alive signals carry over from the last stored check.
          const priorBusiness = lead.verification?.business;
          const { verification, leadScore } = await runVerificationChecks({
            website,
            phone: lead.phone,
            tier: result.verificationTier,
            signals: priorBusiness
              ? {
                  businessStatus: priorBusiness.businessStatus,
                  rating: priorBusiness.rating,
                  reviewCount: priorBusiness.reviewCount,
                  lastReviewAt: priorBusiness.lastReviewAt,
                }
              : undefined,
          });

          const patch = {
            enrichment: result.enrichment,
            confidenceScore: result.confidenceScore,
            confidenceEvidence: result.confidenceEvidence,
            unverified: result.unverified,
            unverifiedReason: result.unverifiedReason ?? null,
            verificationTier: result.verificationTier,
            verificationReasons: result.verificationReasons,
            verification,
            leadScore,
          };

          const { error: updErr } = await supabase.from("leads").update(patch).eq("id", leadId);
          if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

          return Response.json({ ok: true, updates: patch });
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
