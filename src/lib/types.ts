export type Quality = "High" | "Medium" | "Low";

export type LeadStatus =
  | "Not Called"
  | "Called"
  | "Voicemail"
  | "Callback Scheduled"
  | "Zoom Booked"
  | "Sold"
  | "Not Interested";

export type LeadSource =
  | "Yelp"
  | "Facebook"
  | "Google Business"
  | "Angie's List"
  | "MapQuest"
  | "Website"
  | "Instagram"
  | "Houzz"
  | "Directory"
  | "Other";

export type WebsiteOpportunity =
  | "No Dedicated Website"
  | "Facebook Only"
  | "Yelp/Directory Only"
  | "Outdated Website"
  | "Has Website"
  | "Social-Heavy";

export interface CallLog {
  id: string;
  date: string; // ISO
  status: LeadStatus;
  note?: string;
}

export type LeadProfileType =
  | "website"
  | "google-business"
  | "facebook"
  | "instagram"
  | "yelp"
  | "linkedin"
  | "directory"
  | "other";

export interface LeadProfile {
  type: LeadProfileType;
  url: string;
  label?: string;
  note?: string;
}

export interface LeadReviews {
  source: string; // "Google", "Yelp", "Facebook"
  rating?: number; // e.g. 4.6
  count?: number; // e.g. 214
}

export interface LeadEnrichment {
  verifiedSummary?: string;
  websiteStatus: "none" | "outdated" | "good" | "unknown";
  profiles: LeadProfile[];
  reviews: LeadReviews[];
  hours?: string;
  ownerName?: string;
  recentActivity?: string;
  pitchAngle?: string;
  enrichedAt: string; // ISO
  /** ISO timestamp of the last time the website URL was actually fetched and its content evaluated. */
  lastVerifiedAt?: string;
}

export interface CallRecord {
  id: string;
  leadId: string;
  createdAt: string; // ISO
  transcript: string;
  summary: string;
  outcome: string; // e.g. "Answered — interested", "Voicemail", "Not interested"
  answered: boolean;
  interested: boolean;
  suggestedStatus: LeadStatus | null;
  followUpDate: string | null; // ISO
  zoomBooked: boolean;
  zoomDate: string | null; // ISO
  objections: string[];
  websitePainPoints: string[];
  onlinePresenceNotes: string;
  nextAction: string;
  opportunitySummary: string;
  /** Where the raw text originated. Future-proofs live transcription. */
  source?: "notes" | "transcript";
  /** Who was actually spoken to on the call — e.g. "Mike". */
  contactName?: string;
  /** Their role — e.g. "owner", "manager". */
  contactRole?: string;
  /** One plain sentence for WHY a follow-up exists (drives the Follow-Ups desk). */
  followUpReason?: string;
}

export interface CallScriptObjection {
  objection: string;
  response: string;
}

export interface CallScript {
  opener: string;
  pitchAngle: string;
  discovery: string[];
  objections: CallScriptObjection[];
  generatedAt: string; // ISO
  /** Timestamp of the enrichment the script was built from — lets us know when it's stale. */
  enrichedAt?: string;
}

export type VerificationTier = "verified" | "partial" | "unverified";

export type WebsiteCheckStatus = "live" | "dead" | "parked" | "redirect-social" | "none";

/** Structured results of the automated verification pass (Phase 2 pipeline). */
export interface LeadVerification {
  website: {
    status: WebsiteCheckStatus;
    url?: string; // the URL that was checked
    finalUrl?: string; // after redirects
    httpStatus?: number;
    redirects?: number;
    reason?: string; // human-readable failure/classification detail
  };
  freshness?: {
    copyrightYear?: number;
    hasViewportMeta?: boolean;
    https?: boolean;
    outdated: boolean;
  };
  business: {
    businessStatus?: string; // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
    rating?: number;
    reviewCount?: number;
    lastReviewAt?: string; // ISO — most recent review, when available
  };
  checkedAt: string; // ISO
}

export interface Lead {
  id: string;
  priority: number;
  business: string;
  owner?: string;
  ownerSource?: string;
  city: string;
  state: string;
  phone: string;
  onlinePresence: string;
  websiteOpportunity: WebsiteOpportunity;
  quality: Quality;
  status: LeadStatus;
  sources: LeadSource[];
  lastContacted?: string; // ISO
  nextFollowUp?: string; // ISO
  notes: string;
  tags: string[];
  ownerNote?: string;
  history: CallLog[];
  callRecords?: CallRecord[];
  aiSummary?: string;
  aiNextAction?: string;
  zoomBooked?: boolean;
  zoomDate?: string;
  confidenceScore?: number; // 0-100
  confidenceEvidence?: string[]; // short chip strings
  unverified?: boolean;
  unverifiedReason?: string;
  enrichment?: LeadEnrichment;
  callScript?: CallScript;
  verificationTier?: VerificationTier;
  verificationReasons?: string[];
  leadScore?: number; // composite 0-100 opportunity score
  verification?: LeadVerification;
}
