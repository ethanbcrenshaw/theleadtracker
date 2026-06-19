import type { Lead, LeadSource, LeadStatus, Quality, WebsiteOpportunity } from "./types";

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
    "Priority","Business","City","State","Phone","Online Presence","Website Opportunity",
    "Quality","Status","Sources","Last Contacted","Next Follow-Up","Notes","Tags","Owner",
  ];
  const rows = leads.map((l) => [
    l.priority, l.business, l.city, l.state, l.phone, l.onlinePresence,
    l.websiteOpportunity, l.quality, l.status, l.sources.join("; "),
    l.lastContacted ?? "", l.nextFollowUp ?? "", l.notes.replace(/\n/g, " "),
    l.tags.join("; "), l.ownerNote ?? "",
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
    "Facebook": {
      label: "Facebook Page",
      url: `https://www.facebook.com/search/pages/?q=${qOnly}`,
      domain: "facebook.com",
    },
    "Yelp": {
      label: "Yelp Listing",
      url: `https://www.yelp.com/search?find_desc=${qOnly}&find_loc=${cityState}`,
      domain: "yelp.com",
    },
    "Google Business": {
      label: "Google Business Profile",
      url: `https://www.google.com/maps/search/?api=1&query=${q}`,
      domain: "google.com/maps",
    },
    "Instagram": {
      label: "Instagram",
      url: `https://www.google.com/search?q=site%3Ainstagram.com+${qOnly}`,
      domain: "instagram.com",
    },
    "Houzz": {
      label: "Houzz Profile",
      url: `https://www.houzz.com/professionals/query/${qOnly}`,
      domain: "houzz.com",
    },
    "MapQuest": {
      label: "MapQuest Listing",
      url: `https://www.mapquest.com/search/results?query=${q}`,
      domain: "mapquest.com",
    },
    "Angie's List": {
      label: "Angi (Angie's List)",
      url: `https://www.angi.com/companylist/search.htm?searchTerm=${qOnly}&zip=${encodeURIComponent(lead.city)}`,
      domain: "angi.com",
    },
    "Website": {
      label: "Their Website",
      url: `https://www.google.com/search?q=${q}+official+site`,
      domain: "google search",
    },
    "Directory": {
      label: "Directory Listings",
      url: `https://www.google.com/search?q=${q}+upholstery`,
      domain: "google search",
    },
    "Other": {
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
