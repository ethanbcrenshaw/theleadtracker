import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { aiText, getAI } from "@/lib/ai.server";

type BriefingInput = {
  mode: "briefing";
  stats: {
    total: number;
    queuedToday: number;
    overdue: number;
    todayScheduled: number;
    hotUncalled: number;
    inPipeline: number;
    zoomBooked: number;
    sold: number;
    contactedYesterday: number;
    movedYesterday: number; // status changes in last 24h
    weekday: string;
  };
};

type PatternInput = {
  mode: "pattern";
  groups: Array<{
    key: string; // e.g. "roofers" or "Nashville"
    kind: "segment" | "city";
    contacted: number;
    booked: number; // interested/booked/zoom/sold
    dead: number; // not-interested
  }>;
};

type Body = BriefingInput | PatternInput;

export const Route = createFileRoute("/api/daily-brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Body;
          const ai = getAI();
          if (!ai)
            return Response.json(
              {
                error:
                  "AI not configured — set ANTHROPIC_API_KEY, GEMINI_API_KEY, or LOVABLE_API_KEY",
              },
              { status: 500 },
            );

          const system =
            body.mode === "briefing"
              ? "You write a compact editorial 'chief-of-staff' briefing for a solo web designer running a local-business outreach CRM. 2-4 sentences, warm and factual, no hype, no emoji, no headings. Reference the concrete numbers provided. Prose only."
              : "You are a sales analyst. In 1-2 short sentences, describe the strongest and weakest segments from the data, then suggest 1-2 adjacent business types to try when a segment is running dry. Concrete, no fluff, no headings, prose only.";

          const user =
            body.mode === "briefing"
              ? briefingUserPrompt(body.stats)
              : patternUserPrompt(body.groups);

          const text = await aiText(ai, { system, user, maxTokens: 1024 });
          if (!text) return Response.json({ error: "Empty AI response" }, { status: 500 });
          return Response.json({ ok: true, text });
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

function briefingUserPrompt(s: BriefingInput["stats"]) {
  return [
    `Weekday: ${s.weekday}`,
    `Total leads in book: ${s.total}`,
    `Queued for today: ${s.queuedToday} (overdue ${s.overdue}, scheduled today ${s.todayScheduled}, hot uncalled fill ${s.hotUncalled})`,
    `Currently in pipeline (called / callback / zoom): ${s.inPipeline}`,
    `Zoom booked all-time: ${s.zoomBooked} — Sold: ${s.sold}`,
    `Calls logged yesterday: ${s.contactedYesterday}`,
    `Status changes in last 24h: ${s.movedYesterday}`,
  ].join("\n");
}

function patternUserPrompt(groups: PatternInput["groups"]) {
  const rows = groups
    .map(
      (g) =>
        `${g.kind}: ${g.key} — contacted ${g.contacted}, booked/interested ${g.booked}, dead ${g.dead}`,
    )
    .join("\n");
  return `Conversion by group:\n${rows}\n\nCall out the best and worst performing group by name, then suggest 1-2 adjacent business types to try.`;
}
