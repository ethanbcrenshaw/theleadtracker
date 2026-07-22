// Server-only lead scoring — Furniture Repair & Upholstery spec.
//
// Runs AFTER enrichment (Google Places + Firecrawl) so the site assessment is
// available when a shop has a site. Produces the three fields the app persists:
//   leadScore (0-100), leadTier (hot|warm|cool|cool|disqualified), scoreBreakdown.
//
// The "good lead": an owner-run furniture/upholstery shop that is already busy,
// already proud of its work, already losing calls it can't answer, and
// underserved by a weak web presence — run by the one person who can say yes.
//
// All thresholds live in CONFIG so they can be tuned without touching logic.
// These weights are a starting point; revisit once there's closed-deal data.

import { aiExtract, type AIConfig } from "./ai.server";
import type { LeadTier, ScoreBand, ScoreBreakdown } from "./types";

export const CONFIG = {
  weights: {
    niche_fit: 20,
    web_presence: 25,
    reputation: 20,
    missed_inquiry: 20,
    reachability: 15,
  },

  niche: {
    core: 20,
    adjacent: 12,
    loose: 5,
    off: 0,
    // Primary-type / name keywords, strongest first.
    coreKeywords: [
      "upholster",
      "reupholster",
      "furniture repair",
      "furniture restoration",
      "furniture refinish",
      "refinishing",
      "restoration",
    ],
    adjacentKeywords: [
      "furniture",
      "antique",
      "cabinet",
      "woodwork",
      "custom furniture",
      "furniture store",
    ],
    looseKeywords: ["interior", "decor", "home furnishings", "mattress", "sofa"],
  },

  web: { none: 25, poor: 20, plain: 12, strong: 3 },

  reputation: {
    strong: 20,
    healthy: 14,
    thin: 7,
    weak: 3,
    strongMinRating: 4.3,
    strongMinReviews: 15,
    strongMaxReviews: 200, // above this = big operation, worse fit
    healthyMinRating: 4.0,
    healthyMinReviews: 8,
    weakMaxRating: 3.5,
  },

  missed: { high: 20, some: 12, low: 5 },

  reachability: {
    ownerRun: 15,
    miniChain: 8,
    larger: 3,
    // Known franchise brands in this vertical → not a single-owner sale.
    franchiseMarkers: [
      "furniture medic",
      "fibrenew",
      "guardian",
      "amish",
      "la-z-boy",
      "lazboy",
      "ashley",
      "ethan allen",
    ],
  },

  tiers: {
    hot: 75,
    warm: 55,
    cool: 35,
  },
} as const;

const CURRENT_YEAR = new Date().getFullYear();

export type SiteAssessment = {
  band: "poor" | "plain" | "strong";
  reason: string;
  mobileResponsive: boolean;
  modern: boolean;
  hasBooking: boolean; // online booking OR a quote/contact form
  hasChat: boolean; // chat widget or AI receptionist
  /** Concrete "this site is weak" tells, for the caller to eyeball. */
  cues?: string[];
  /** Inferred age/platform hint ("© 2016", "Wix (free tier)"). */
  builtHint?: string;
};

// Site-builder / free-tier hosts — a business still on one of these usually
// has a thin, template site worth pitching a rebuild.
const BUILDER_HOSTS: Array<[string, string]> = [
  ["wixsite.com", "Wix (free tier)"],
  ["business.site", "Google Business site builder"],
  ["weebly.com", "Weebly"],
  ["godaddysites.com", "GoDaddy Website Builder"],
  ["blogspot.", "Blogspot"],
  ["wordpress.com", "WordPress.com (free)"],
  ["squarespace.com", "Squarespace default domain"],
  ["myshopify.com", "Shopify default domain"],
  ["webflow.io", "Webflow staging"],
  ["yolasite.com", "Yola"],
  ["jimdosite.com", "Jimdo"],
];
const CHAT_WIDGETS =
  /intercom|drift\.com|tawk\.to|livechat|tidio|crisp\.chat|zendesk|olark|podium|birdeye|facebook\.com\/customer_chat|customerchat|live ?chat|chat with us/i;
const BOOKING_WIDGETS =
  /calendly|acuityscheduling|squareup\.com\/appointments|setmore|schedulicity|book(?:ing)?now|vagaro|housecallpro|jobber/i;

/**
 * Deterministic website-quality read from raw HTML — NO AI, so it never
 * touches API credits. Grades poor/plain/strong and lists the concrete weak
 * signals a human would notice: not mobile-friendly, dated markup, a builder/
 * free-tier host, a stale copyright year, no gallery of their work, no
 * quote/contact form, a single-page site, no chat/receptionist.
 */
export function heuristicSiteAssessment(html: string, host = ""): SiteAssessment {
  const cues: string[] = [];
  const h = html;

  const mobileResponsive = /<meta[^>]+name=["']viewport["']/i.test(h);
  if (!mobileResponsive) cues.push("not mobile-friendly (no viewport tag)");

  // Platform / build-age hints.
  let builtHint: string | undefined;
  for (const [dom, label] of BUILDER_HOSTS) {
    if (host.includes(dom) || h.toLowerCase().includes(dom)) {
      cues.push(`built on ${label}`);
      builtHint = label;
      break;
    }
  }
  const generator = h.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (generator && !builtHint) builtHint = generator;
  const years = [...h.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,15}(20\d{2})/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((y) => y >= 2000 && y <= CURRENT_YEAR + 1);
  const copyrightYear = years.length ? Math.max(...years) : undefined;
  if (copyrightYear && CURRENT_YEAR - copyrightYear >= 3)
    cues.push(`copyright ${copyrightYear} (${CURRENT_YEAR - copyrightYear} yrs stale)`);
  if (copyrightYear && !builtHint) builtHint = `© ${copyrightYear}`;

  // Ancient markup.
  if (/<font\b|<center\b|<marquee\b/i.test(h) || /<table[^>]+(bgcolor|cellpadding)/i.test(h))
    cues.push("dated HTML (table/font layout)");
  if (/\.swf\b|shockwave|<embed\b/i.test(h)) cues.push("uses Flash/embed (very dated)");

  // Gallery of their work.
  const imgCount = (h.match(/<img\b/gi) || []).length;
  const galleryWord =
    /gallery|portfolio|our work|our projects|before\s*(?:&amp;|and|\/)?\s*after/i.test(h);
  if (imgCount < 4 && !galleryWord) cues.push("no photo gallery of their work");

  // Contact / quote path.
  const hasForm = /<form\b/i.test(h) && /<(input|textarea)\b/i.test(h);
  const emailField = /type=["']email["']/i.test(h) || /mailto:/i.test(h);
  const quoteWord =
    /request a quote|get a quote|free quote|free estimate|get (?:a )?estimate|book (?:an? )?(?:appointment|consultation)|schedule (?:a )?(?:call|visit|consultation)/i.test(
      h,
    );
  const hasBooking = BOOKING_WIDGETS.test(h) || (hasForm && (emailField || quoteWord)) || quoteWord;
  if (!hasBooking && !hasForm) cues.push("no quote or contact form");

  const hasChat = CHAT_WIDGETS.test(h);
  if (!hasChat) cues.push("no chat/receptionist widget");

  // Single-page site: count distinct internal paths.
  const paths = new Set<string>();
  const bareHost = host.replace(/^www\./, "");
  for (const m of h.matchAll(/href=["']([^"']+)["']/gi)) {
    const u = m[1];
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(u)) continue;
    try {
      const abs = new URL(u, `https://${host || "x.com"}/`);
      if (abs.hostname.replace(/^www\./, "") === bareHost)
        paths.add(abs.pathname.replace(/\/+$/, "") || "/");
    } catch {
      /* ignore */
    }
  }
  if (host && paths.size <= 1) cues.push("appears to be a single-page site");

  // Modern-framework signal → likely a decent recent build.
  const framework =
    /__NEXT_DATA__|data-reactroot|wp-content|elementor|cdn\.shopify|squarespace|wixstatic|_next\/|gatsby|astro-/i.test(
      h,
    );
  const modern =
    mobileResponsive &&
    (framework || (copyrightYear !== undefined && CURRENT_YEAR - copyrightYear <= 2)) &&
    !cues.some((c) => /dated|Flash|free tier|single-page|not mobile/i.test(c));

  const clearlyWeak =
    !mobileResponsive ||
    cues.some((c) => /dated|Flash|free tier|Wix|Weebly|GoDaddy|stale|single-page/i.test(c)) ||
    (!hasBooking && imgCount < 4);
  const band: SiteAssessment["band"] =
    modern && mobileResponsive && hasBooking && hasChat ? "strong" : clearlyWeak ? "poor" : "plain";

  const reason = cues.length
    ? cues.slice(0, 4).join("; ")
    : band === "strong"
      ? "modern, responsive, has booking + chat"
      : "functional but basic — no booking or chat";

  return { band, reason, mobileResponsive, modern, hasBooking, hasChat, cues, builtHint };
}

export interface ScoreInput {
  business: string;
  primaryType?: string | null; // Google Places primary type display name
  industryQueried?: string | null; // the segment searched, e.g. "upholstery"
  phone?: string | null;
  businessStatus?: string | null; // OPERATIONAL | CLOSED_* | undefined
  rating?: number | null;
  reviewCount?: number | null;
  websiteStatus: "none" | "outdated" | "good" | "unknown";
  /** A real site exists (Places-listed OR recovered via search). */
  hasWebsite: boolean;
  /** Claude's site read — null when there's no site to assess. */
  site?: SiteAssessment | null;
}

/**
 * Ask Claude to grade a scraped site. The spec is explicit: do NOT grade with
 * keyword rules alone. Returns a band + one-line reason + the automation
 * signals scoring needs. Never throws — a failed read falls back to "plain".
 */
export async function assessSiteQuality(
  siteText: string,
  business: string,
  ai: AIConfig,
): Promise<SiteAssessment> {
  const fallback: SiteAssessment = {
    band: "plain",
    reason: "couldn't fully assess the site",
    mobileResponsive: true,
    modern: true,
    hasBooking: false,
    hasChat: false,
  };
  const text = siteText.replace(/\s+/g, " ").slice(0, 6000);
  if (!text.trim()) return fallback;
  try {
    const res = await aiExtract<SiteAssessment>(ai, {
      system:
        "You grade a local business's existing website for a web-design agency deciding whether to pitch a rebuild + AI-receptionist bundle. Read the scraped content and rate the site: 'poor' (outdated, not mobile-responsive, broken, or very thin), 'plain' (functional but basic — no online booking, no chat/receptionist), or 'strong' (modern, responsive, already has booking AND a chat/receptionist). Also report booleans: mobileResponsive, modern, hasBooking (online booking OR a quote/contact form), hasChat (a chat widget or AI receptionist). One-line reason. Judge the actual content, not keywords alone.",
      user: `Business: ${business}\n\nScraped site content:\n${text}`,
      toolName: "report_site_quality",
      toolDescription: "Report the website quality band and automation signals",
      schema: {
        type: "object",
        properties: {
          band: { type: "string", enum: ["poor", "plain", "strong"] },
          reason: { type: "string" },
          mobileResponsive: { type: "boolean" },
          modern: { type: "boolean" },
          hasBooking: { type: "boolean" },
          hasChat: { type: "boolean" },
        },
        required: ["band", "reason", "mobileResponsive", "modern", "hasBooking", "hasChat"],
      },
      timeoutMs: 15_000,
    });
    return res ?? fallback;
  } catch {
    return fallback;
  }
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function scoreNiche(input: ScoreInput): ScoreBand {
  const hay =
    `${input.business} ${input.primaryType ?? ""} ${input.industryQueried ?? ""}`.toLowerCase();
  const c = CONFIG.niche;
  if (includesAny(hay, c.coreKeywords)) return { band: "core", points: c.core };
  if (includesAny(hay, c.adjacentKeywords)) return { band: "adjacent", points: c.adjacent };
  if (includesAny(hay, c.looseKeywords)) return { band: "loose", points: c.loose };
  return { band: "off-vertical", points: c.off };
}

function scoreWebPresence(input: ScoreInput): ScoreBand {
  const w = CONFIG.web;
  if (!input.hasWebsite || input.websiteStatus === "none") return { band: "none", points: w.none };
  if (input.site) {
    if (input.site.band === "poor") return { band: "poor", points: w.poor };
    if (input.site.band === "strong") return { band: "strong", points: w.strong };
    return { band: "plain", points: w.plain };
  }
  // No Claude read available — derive from the liveness/freshness verdict.
  if (input.websiteStatus === "outdated") return { band: "poor", points: w.poor };
  return { band: "plain", points: w.plain };
}

function scoreReputation(input: ScoreInput): ScoreBand {
  const r = CONFIG.reputation;
  const rating = input.rating ?? 0;
  const reviews = input.reviewCount ?? 0;
  if (rating > 0 && rating < r.weakMaxRating) return { band: "weak", points: r.weak };
  if (rating >= r.strongMinRating && reviews >= r.strongMinReviews && reviews <= r.strongMaxReviews)
    return { band: "strong", points: r.strong };
  if (rating >= r.healthyMinRating && reviews >= r.healthyMinReviews)
    return { band: "healthy", points: r.healthy };
  return { band: "thin", points: r.thin };
}

function scoreMissedInquiry(input: ScoreInput): ScoreBand {
  const m = CONFIG.missed;
  if (input.site?.hasChat) return { band: "low", points: m.low };
  if (input.site?.hasBooking) return { band: "some", points: m.some };
  return { band: "high", points: m.high };
}

function scoreReachability(input: ScoreInput): ScoreBand {
  const r = CONFIG.reachability;
  const name = input.business.toLowerCase();
  if (includesAny(name, r.franchiseMarkers)) return { band: "larger", points: r.larger };
  // Without a reliable multi-location signal, an independent local shop reads
  // as owner-run — the profile the offer is built for.
  return { band: "owner_run", points: r.ownerRun };
}

function tierFor(score: number): LeadTier {
  if (score >= CONFIG.tiers.hot) return "hot";
  if (score >= CONFIG.tiers.warm) return "warm";
  if (score >= CONFIG.tiers.cool) return "cool";
  return "cold";
}

/** Disqualifier check — returns a reason string when the lead is out. */
function disqualify(input: ScoreInput): string | null {
  const status = (input.businessStatus ?? "").toUpperCase();
  if (status && status !== "OPERATIONAL") return "business not operational";
  if (!(input.phone ?? "").replace(/\D/g, "")) return "no phone on record — nothing to solve";
  if (
    input.site &&
    input.site.modern &&
    input.site.mobileResponsive &&
    input.site.hasBooking &&
    input.site.hasChat
  )
    return "already has a modern site with booking + receptionist — nothing to sell";
  return null;
}

export interface ScoreResult {
  leadScore: number;
  leadTier: LeadTier;
  scoreBreakdown: ScoreBreakdown;
}

/** Score one enriched lead against the Furniture/Upholstery spec. Never throws. */
export function scoreLead(input: ScoreInput): ScoreResult {
  const dq = disqualify(input);
  if (dq) {
    const empty: ScoreBand = { band: "n/a", points: 0 };
    return {
      leadScore: 0,
      leadTier: "disqualified",
      scoreBreakdown: {
        niche_fit: empty,
        web_presence: empty,
        reputation: empty,
        missed_inquiry: empty,
        reachability: empty,
        total: 0,
        tier: "disqualified",
        rationale: `Disqualified — ${dq}.`,
      },
    };
  }

  const niche_fit = scoreNiche(input);
  const web_presence = scoreWebPresence(input);
  const reputation = scoreReputation(input);
  const missed_inquiry = scoreMissedInquiry(input);
  const reachability = scoreReachability(input);
  const total =
    niche_fit.points +
    web_presence.points +
    reputation.points +
    missed_inquiry.points +
    reachability.points;
  const tier = tierFor(total);

  const rating = input.rating ?? 0;
  const reviews = input.reviewCount ?? 0;
  const webPhrase =
    web_presence.band === "none"
      ? "no real website"
      : web_presence.band === "poor"
        ? "weak/outdated site"
        : web_presence.band === "plain"
          ? "basic site, no automation"
          : "modern site already";
  // Surface the concrete site tells so the human knows why it reads "weak".
  const siteCues = input.site?.cues?.length
    ? ` Site tells: ${input.site.cues.slice(0, 4).join(", ")}${input.site.builtHint ? ` (${input.site.builtHint})` : ""}.`
    : "";
  const rationale =
    `${reachability.band === "owner_run" ? "Owner-run" : reachability.band === "larger" ? "Larger/franchise" : "Small-chain"} ` +
    `${niche_fit.band === "off-vertical" ? "shop" : niche_fit.band + " fit"}` +
    `${rating ? `, ${rating}★${reviews ? ` over ${reviews} reviews` : ""}` : ""}, ` +
    `${webPhrase}, ${missed_inquiry.band === "high" ? "phone-driven contact" : missed_inquiry.band === "some" ? "a basic form but no automation" : "channels already automated"}.` +
    siteCues;

  return {
    leadScore: total,
    leadTier: tier,
    scoreBreakdown: {
      niche_fit,
      web_presence,
      reputation,
      missed_inquiry,
      reachability,
      total,
      tier,
      rationale,
    },
  };
}
