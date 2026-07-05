import { defineMcp } from "@lovable.dev/mcp-js";
import listLeadsTool from "./tools/list-leads";
import getLeadTool from "./tools/get-lead";
import searchLeadsTool from "./tools/search-leads";
import followUpsDueTool from "./tools/follow-ups-due";
import updateLeadStatusTool from "./tools/update-lead-status";
import addNoteTool from "./tools/add-note";
import scheduleFollowupTool from "./tools/schedule-followup";

export default defineMcp({
  name: "lead-tracker-mcp",
  title: "Lead Tracker CRM",
  version: "0.1.0",
  instructions:
    "Tools for a local-business lead-tracking CRM. Use `list_leads`, `search_leads`, `get_lead`, and `list_followups_due` to read the pipeline. Use `update_lead_status`, `add_lead_note`, and `schedule_followup` to act on leads.",
  tools: [
    listLeadsTool,
    getLeadTool,
    searchLeadsTool,
    followUpsDueTool,
    updateLeadStatusTool,
    addNoteTool,
    scheduleFollowupTool,
  ],
});