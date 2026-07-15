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
    contactName: {
      type: ["string", "null"],
      description:
        "First name (or full name) of the person actually spoken to, if stated, else null. e.g. 'Mike'",
    },
    contactRole: {
      type: ["string", "null"],
      description: "Their role if stated (owner, manager, receptionist), else null",
    },
    followUpReason: {
      type: ["string", "null"],
      description:
        "One plain sentence explaining WHY a follow-up is needed — the concrete reason, e.g. 'Wants to see pricing after their busy season ends in August'. Null if no follow-up is warranted.",
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
    "contactName",
    "contactRole",
    "followUpReason",
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
              source?: "notes" | "transcript";
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

          const isTranscript = callSignals?.source === "transcript";
          const transcriptNote = isTranscript
            ? " This text is a LIVE SPEAKERPHONE TRANSCRIPT of a two-sided phone call, auto-transcribed with NO speaker labels — both voices are mixed into one stream. The caller (whose voice is one of them) is the salesperson selling website services; the other voice is the prospect. Infer who is speaking from context to reconstruct the conversation. Transcription is imperfect (garbled words, run-ons) — read past errors. Extract the prospect's name and role if they state or are addressed by them (e.g. 'this is Mike', 'Mike here', 'the owner'). When a follow-up is warranted, write followUpReason as the concrete human reason it exists."
            : "";

          const parsed = await aiExtract<Record<string, unknown>>(ai, {
            system:
              "You analyze sales call transcripts for a web design agency selling websites to local businesses. Extract structured CRM updates. Today is " +
              today +
              ". Use ISO dates. Be conservative — if unsure, set booleans to false and dates to null. If the call contains no lead speech, only dial tone, ringing, silence, or no meaningful conversation, set answered=false, interested=false, suggestedStatus='Callback Scheduled', zoomBooked=false, and recommend calling again later. Only use Voicemail when the transcript clearly says a voicemail was left or reached." +
              transcriptNote,
            user: `${ctx}\n\nCall signals:\n${JSON.stringify(callSignals ?? {})}\n\nTranscript:\n${transcript}`,
            toolName: "extract_call_updates",
            toolDescription: "Extract CRM updates from the call",
            schema: SCHEMA,
          });
          if (!parsed) return Response.json({ error: "No structured output" }, { status: 500 });

          // Normalize the new string|null fields to trimmed strings or null.
          const norm = (v: unknown) => {
            const s = typeof v === "string" ? v.trim() : "";
            return s.length ? s : null;
          };
          parsed.contactName = norm(parsed.contactName);
          parsed.contactRole = norm(parsed.contactRole);
          parsed.followUpReason = norm(parsed.followUpReason);
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
