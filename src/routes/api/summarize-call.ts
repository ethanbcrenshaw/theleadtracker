import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { aiExtract, getAI } from "@/lib/ai.server";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-4 sentence summary of the call" },
    outcome: {
      type: "string",
      description:
        "Short outcome label, e.g. 'Answered — interested', 'Voicemail', 'Not interested', 'Callback requested', 'Dial tone / no answer', 'No speech detected'",
    },
    answered: { type: "boolean" },
    interested: { type: "boolean" },
    suggestedStatus: {
      type: "string",
      enum: [
        "Not Called",
        "Called",
        "Voicemail",
        "Callback Scheduled",
        "Zoom Booked",
        "Sold",
        "Not Interested",
      ],
    },
    followUpDate: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD) if a follow-up is mentioned, else null",
    },
    zoomBooked: { type: "boolean" },
    zoomDate: {
      type: ["string", "null"],
      description: "ISO datetime if a Zoom is scheduled, else null",
    },
    objections: { type: "array", items: { type: "string" } },
    websitePainPoints: { type: "array", items: { type: "string" } },
    onlinePresenceNotes: { type: "string" },
    nextAction: { type: "string", description: "Recommended next sales action" },
    opportunitySummary: {
      type: "string",
      description: "1-2 sentences describing the sales opportunity",
    },
  },
  required: [
    "summary",
    "outcome",
    "answered",
    "interested",
    "suggestedStatus",
    "followUpDate",
    "zoomBooked",
    "zoomDate",
    "objections",
    "websitePainPoints",
    "onlinePresenceNotes",
    "nextAction",
    "opportunitySummary",
  ],
  additionalProperties: false,
};

export const Route = createFileRoute("/api/summarize-call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { transcript, lead, callSignals } = (await request.json()) as {
            transcript?: string;
            lead?: {
              business?: string;
              city?: string;
              state?: string;
              websiteOpportunity?: string;
            };
            callSignals?: {
              elapsedSeconds?: number;
              detectedDialTone?: boolean;
              detectedNoSpeech?: boolean;
            };
          };
          if (!transcript || transcript.trim().length < 10) {
            return Response.json({ error: "Transcript too short" }, { status: 400 });
          }
          const ai = getAI();
          if (!ai)
            return Response.json(
              {
                error:
                  "AI not configured — set ANTHROPIC_API_KEY, GEMINI_API_KEY, or LOVABLE_API_KEY",
              },
              { status: 500 },
            );

          const today = new Date().toISOString().slice(0, 10);
          const ctx = lead
            ? `Lead: ${lead.business} (${lead.city}, ${lead.state}). Website opportunity: ${lead.websiteOpportunity}.`
            : "";

          const parsed = await aiExtract<Record<string, unknown>>(ai, {
            system:
              "You analyze sales call transcripts for a web design agency selling websites to local businesses. Extract structured CRM updates. Today is " +
              today +
              ". Use ISO dates. Be conservative — if unsure, set booleans to false and dates to null. If the call contains no lead speech, only dial tone, ringing, silence, or no meaningful conversation, set answered=false, interested=false, suggestedStatus='Callback Scheduled', zoomBooked=false, and recommend calling again later. Only use Voicemail when the transcript clearly says a voicemail was left or reached.",
            user: `${ctx}\n\nCall signals:\n${JSON.stringify(callSignals ?? {})}\n\nTranscript:\n${transcript}`,
            toolName: "extract_call_updates",
            toolDescription: "Extract CRM updates from the call",
            schema: SCHEMA,
          });
          if (!parsed) return Response.json({ error: "No structured output" }, { status: 500 });
          return Response.json({ ok: true, updates: parsed });
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
