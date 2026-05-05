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
}
