import type { Lead, LeadSource, LeadStatus, LeadTier, Quality, WebsiteOpportunity } from "./types";

/**
 * Client-side tier from score (Furniture/Upholstery spec thresholds). Used as
 * a fallback when the leadTier column isn't present/populated yet, so tier
 * badges still render from the persisted leadScore.
 */
export function tierFromScore(score?: number | null): LeadTier | undefined {
  if (typeof score !== "number") return undefined;
  if (score >= 75) return "hot";
  if (score >= 55) return "warm";
  if (score >= 35) return "cool";
  return "cold";
}

export const STATUSES: LeadStatus[] = [
  "Not Called",
  "Called",
  "Voicemail",
  "Callback Scheduled",
  "Zoom Booked",
  "Sold",
  "Not Interested",
];

export const QUALITIES: Quality[] = ["High", "Medium", "Low"];

export const OPPORTUNITIES: WebsiteOpportunity[] = [
  "No Dedicated Website",
  "Facebook Only",
  "Yelp/Directory Only",
  "Outdated Website",
  "Has Website",
  "Social-Heavy",
];

export function qualityFromOpportunity(op: WebsiteOpportunity): Quality {
  switch (op) {
    case "No Dedicated Website":
    case "Facebook Only":
    case "Yelp/Directory Only":
    case "Social-Heavy":
      return "High";
    case "Outdated Website":
      return "Medium";
    case "Has Website":
      return "Low";
  }
}

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

export function allTags(leads: Lead[]): string[] {
  const set = new Set<string>();
  for (const l of leads) for (const t of l.tags) set.add(t);
  return Array.from(set).sort();
}

export const SOURCES = [
  "Yelp",
  "Facebook",
  "Google Business",
  "Angie's List",
  "MapQuest",
  "Website",
  "Instagram",
  "Houzz",
  "Directory",
  "Other",
] as const;

export function qualityClasses(q: Quality) {
  return q === "High"
    ? "bg-sage/25 text-sage-foreground border-sage/40"
    : q === "Medium"
      ? "bg-gold/25 text-gold-foreground border-gold/40"
      : "bg-clay/15 text-clay border-clay/30";
}

export function statusClasses(s: LeadStatus) {
  switch (s) {
    case "Not Called":
      return "bg-navy/10 text-navy border-navy/20";
    case "Called":
      return "bg-muted text-muted-foreground border-border";
    case "Voicemail":
      return "bg-[oklch(0.85_0.04_300)] text-[oklch(0.3_0.05_300)] border-[oklch(0.7_0.04_300)]";
    case "Callback Scheduled":
      return "bg-gold/30 text-gold-foreground border-gold/40";
    case "Zoom Booked":
      return "bg-sage/30 text-sage-foreground border-sage/40";
    case "Sold":
      return "bg-[oklch(0.55_0.1_150)] text-white border-[oklch(0.45_0.1_150)]";
    case "Not Interested":
      return "bg-clay/15 text-clay border-clay/30";
  }
}

export function pitchAngle(lead: Lead): string {
  const op = lead.websiteOpportunity;
  if (op === "No Dedicated Website")
    return "This business has no dedicated website — only directory or map listings. A simple professional site would make them look more trustworthy and capture customers searching on Google.";
  if (op === "Facebook Only")
    return "This business relies entirely on Facebook. A simple website would make them findable in Google searches and let customers request quotes without needing a Facebook account.";
  if (op === "Yelp/Directory Only")
    return "Their online presence is scattered across directories like Yelp and MapQuest. A central website would unify their brand, showcase work, and convert more leads.";
  if (op === "Outdated Website")
    return "Their current site looks outdated and likely loses trust. A modern redesign would feel professional, load fast on phones, and help close more jobs.";
  if (op === "Social-Heavy")
    return "They have strong social momentum but no website hub. A clean site would convert that traffic into quote requests and rank them in local search.";
  return "They already have a website — lower priority unless they want a refresh.";
}

export function exportCSV(leads: Lead[]) {
  const headers = [
    "Priority",
    "Business",
    "City",
    "State",
    "Phone",
    "Online Presence",
    "Website Opportunity",
    "Quality",
    "Status",
    "Sources",
    "Last Contacted",
    "Next Follow-Up",
    "Notes",
    "Tags",
    "Owner",
  ];
  const rows = leads.map((l) => [
    l.priority,
    l.business,
    l.city,
    l.state,
    l.phone,
    l.onlinePresence,
    l.websiteOpportunity,
    l.quality,
    l.status,
    l.sources.join("; "),
    l.lastContacted ?? "",
    l.nextFollowUp ?? "",
    l.notes.replace(/\n/g, " "),
    l.tags.join("; "),
    l.ownerNote ?? "",
  ]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function isValidContactDate(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d.getFullYear() >= 2000;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Parse a follow-up date the way a person or an LLM would phrase it, into a
 * clean ISO `yyyy-mm-dd` string. Returns null when nothing sensible can be
 * derived — callers must NOT persist an unparseable value (that's how a
 * follow-up silently disappears from every date-filtered view).
 *
 * Handles: real ISO dates, "today/tomorrow", "in N days/weeks/months",
 * "next week/month", weekday names ("monday", "next friday"), month names
 * ("august", "end of august"), and anything the JS Date parser accepts.
 */
export function parseFollowUpDate(input: unknown, now = new Date()): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const s = raw.toLowerCase();

  // Already an ISO date/datetime — take the date part if it's real.
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1] + "T00:00:00");
    return !isNaN(d.getTime()) && d.getFullYear() >= 2000 ? isoMatch[1] : null;
  }

  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  if (s === "today") return toISODate(base);
  if (s === "tomorrow") {
    base.setDate(base.getDate() + 1);
    return toISODate(base);
  }

  // "in N day(s)/week(s)/month(s)"
  const rel = s.match(/in\s+(\d+)\s*(day|week|month)s?/);
  if (rel) {
    const n = Number(rel[1]);
    if (rel[2] === "day") base.setDate(base.getDate() + n);
    else if (rel[2] === "week") base.setDate(base.getDate() + n * 7);
    else base.setMonth(base.getMonth() + n);
    return toISODate(base);
  }
  if (s === "next week") {
    base.setDate(base.getDate() + 7);
    return toISODate(base);
  }
  if (s === "next month") {
    base.setMonth(base.getMonth() + 1);
    return toISODate(base);
  }

  // Weekday, optionally prefixed "next" — next occurrence of that weekday.
  const wd = s.match(/(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]);
    let delta = (target - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // "monday" today → next monday, not today
    if (wd[1] && delta <= 7) delta += 0; // "next monday" — the upcoming one is fine
    base.setDate(base.getDate() + delta);
    return toISODate(base);
  }

  // Month name ("august", "end of august", "mid august") — best-effort day.
  const mo = s.match(
    /(end of|late|mid|early|beginning of)?\s*(january|february|march|april|may|june|july|august|september|october|november|december)/,
  );
  if (mo) {
    const m = MONTHS.indexOf(mo[2]);
    let year = base.getFullYear();
    // If that month has already passed this year, assume next year.
    if (m < base.getMonth()) year += 1;
    const qualifier = mo[1] || "";
    let day = 1;
    if (/end|late/.test(qualifier)) day = new Date(year, m + 1, 0).getDate();
    else if (/mid/.test(qualifier)) day = 15;
    else if (!qualifier) day = 1;
    return toISODate(new Date(year, m, day));
  }

  // Last resort: let the JS Date parser try.
  const d = new Date(raw);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return toISODate(d);
  return null;
}

export function relativeFollowUp(nextFollowUp?: string, lastContacted?: string) {
  if (!isValidContactDate(nextFollowUp)) return null;
  const days = Math.ceil((new Date(nextFollowUp!).getTime() - Date.now()) / 86400000);
  if (days < 0) {
    // Only flag as overdue when we actually have a prior contact to be overdue from.
    if (!isValidContactDate(lastContacted)) {
      return { label: "Scheduled", tone: "later" as const };
    }
    return { label: `${Math.abs(days)}d overdue`, tone: "overdue" as const };
  }
  if (days === 0) return { label: "Today", tone: "today" as const };
  if (days <= 3) return { label: `In ${days}d`, tone: "soon" as const };
  return { label: `In ${days}d`, tone: "later" as const };
}

export interface SourceLink {
  source: LeadSource;
  label: string;
  url: string;
  domain: string;
}

export function sourceLinks(lead: Lead): SourceLink[] {
  const q = encodeURIComponent(`${lead.business} ${lead.city} ${lead.state}`);
  const qOnly = encodeURIComponent(lead.business);
  const cityState = encodeURIComponent(`${lead.city}, ${lead.state}`);

  const map: Record<LeadSource, { label: string; url: string; domain: string }> = {
    Facebook: {
      label: "Facebook Page",
      url: `https://www.facebook.com/search/pages/?q=${qOnly}`,
      domain: "facebook.com",
    },
    Yelp: {
      label: "Yelp Listing",
      url: `https://www.yelp.com/search?find_desc=${qOnly}&find_loc=${cityState}`,
      domain: "yelp.com",
    },
    "Google Business": {
      label: "Google Business Profile",
      url: `https://www.google.com/maps/search/?api=1&query=${q}`,
      domain: "google.com/maps",
    },
    Instagram: {
      label: "Instagram",
      url: `https://www.google.com/search?q=site%3Ainstagram.com+${qOnly}`,
      domain: "instagram.com",
    },
    Houzz: {
      label: "Houzz Profile",
      url: `https://www.houzz.com/professionals/query/${qOnly}`,
      domain: "houzz.com",
    },
    MapQuest: {
      label: "MapQuest Listing",
      url: `https://www.mapquest.com/search/results?query=${q}`,
      domain: "mapquest.com",
    },
    "Angie's List": {
      label: "Angi (Angie's List)",
      url: `https://www.angi.com/companylist/search.htm?searchTerm=${qOnly}&zip=${encodeURIComponent(lead.city)}`,
      domain: "angi.com",
    },
    Website: {
      label: "Their Website",
      url: `https://www.google.com/search?q=${q}+official+site`,
      domain: "google search",
    },
    Directory: {
      label: "Directory Listings",
      url: `https://www.google.com/search?q=${q}+upholstery`,
      domain: "google search",
    },
    Other: {
      label: "Web Mentions",
      url: `https://www.google.com/search?q=${q}`,
      domain: "google search",
    },
  };

  const seen = new Set<LeadSource>();
  const links: SourceLink[] = [];
  for (const s of lead.sources) {
    if (seen.has(s)) continue;
    seen.add(s);
    links.push({ source: s, ...map[s] });
  }
  // Always include a general Google search as a safety net
  if (!links.some((l) => l.domain === "google search")) {
    links.push({
      source: "Other",
      label: "Google Search",
      url: `https://www.google.com/search?q=${q}`,
      domain: "google search",
    });
  }
  return links;
}
