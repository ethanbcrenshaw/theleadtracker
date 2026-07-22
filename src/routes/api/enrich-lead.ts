import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { enrichLeadFull } from "@/lib/enrichment.server";
import { hostOf } from "@/lib/enrichment.server";
import { runVerificationChecks } from "@/lib/verification.server";
import { getAI } from "@/lib/ai.server";
import { heuristicSiteAssessment, scoreLead } from "@/lib/scoring.server";
import { createClient } from "@supabase/supabase-js";
import type { LeadTier, LeadVerification, ScoreBreakdown } from "@/lib/types";

type LeadRow = {
  id: string;
  business: string;
  city: string;
  state: string;
  phone: string;
  websiteOpportunity: string;
  onlinePresence: string;
  verification: LeadVerification | null;
  leadScore: number | null;
  leadTier: LeadTier | null;
  scoreBreakdown: ScoreBreakdown | null;
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
          .select(
            'id,business,city,state,phone,"websiteOpportunity","onlinePresence",verification,"leadScore","leadTier","scoreBreakdown"',
          )
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
          // A site recovered from search feeds the score too.
          const effectiveWebsite = website || result.discoveredWebsite || null;
          const priorBusiness = lead.verification?.business;
          const { verification, leadScore } = await runVerificationChecks({
            website: effectiveWebsite,
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

          // ── Re-score against the Furniture/Upholstery spec ────────────────
          const hasWebsite =
            result.enrichment.websiteStatus === "good" ||
            result.enrichment.websiteStatus === "outdated";
          // Deterministic site read — no AI, so no API credits are spent.
          const site =
            hasWebsite && result.siteHtml
              ? heuristicSiteAssessment(result.siteHtml, result.siteHost)
              : null;
          const scored = scoreLead({
            business: lead.business,
            primaryType: null,
            industryQueried: null,
            phone: lead.phone,
            businessStatus: priorBusiness?.businessStatus ?? null,
            rating: priorBusiness?.rating ?? null,
            reviewCount: priorBusiness?.reviewCount ?? null,
            websiteStatus: result.enrichment.websiteStatus,
            hasWebsite,
            site,
          });
          // Keep prior score in a history record so drift is visible.
          if (typeof lead.leadScore === "number" && lead.leadTier) {
            const priorHistory = lead.scoreBreakdown?.history ?? [];
            scored.scoreBreakdown.history = [
              ...priorHistory,
              { score: lead.leadScore, tier: lead.leadTier, at: new Date().toISOString() },
            ].slice(-10);
          }

          const patch: Record<string, unknown> = {
            enrichment: result.enrichment,
            confidenceScore: result.confidenceScore,
            confidenceEvidence: result.confidenceEvidence,
            unverified: result.unverified,
            unverifiedReason: result.unverifiedReason ?? null,
            verificationTier: result.verificationTier,
            verificationReasons: result.verificationReasons,
            verification,
            leadScore: scored.leadScore,
            leadTier: scored.leadTier,
            scoreBreakdown: scored.scoreBreakdown,
          };
          // keep the composite opportunity score referenced but not primary
          void leadScore;
          // Correct the opportunity label when verification found a real site
          // (or confirmed there's none). quality re-derives from it client-side.
          if (result.websiteOpportunity && result.websiteOpportunity !== lead.websiteOpportunity) {
            patch.websiteOpportunity = result.websiteOpportunity;
            if (result.discoveredWebsite) {
              patch.onlinePresence = `Has a website (${result.discoveredWebsite}) — found via search`;
            }
          }

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
