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

export interface Lead {
  id: string;
  priority: number;
  business: string;
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
}
