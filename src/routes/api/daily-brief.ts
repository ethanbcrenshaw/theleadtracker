import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";

const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
    key: string;         // e.g. "roofers" or "Nashville"
    kind: "segment" | "city";
    contacted: number;
    booked: number;      // interested/booked/zoom/sold
    dead: number;        // not-interested
  }>;
};

type Body = BriefingInput | PatternInput;

export const Route = createFileRoute("/api/daily-brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Body;
          const key = process.env.LOVABLE_API_KEY;
          if (!key) return Response.json({ error: "AI gateway not configured" }, { status: 500 });

          const system =
            body.mode === "briefing"
              ? "You write a compact editorial 'chief-of-staff' briefing for a solo web designer running a local-business outreach CRM. 2-4 sentences, warm and factual, no hype, no emoji, no headings. Reference the concrete numbers provided. Prose only."
              : "You are a sales analyst. In 1-2 short sentences, describe the strongest and weakest segments from the data, then suggest 1-2 adjacent business types to try when a segment is running dry. Concrete, no fluff, no headings, prose only.";

          const user =
            body.mode === "briefing"
              ? briefingUserPrompt(body.stats)
              : patternUserPrompt(body.groups);

          const res = await fetch(AI, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            }),
          });

          if (!res.ok) {
            const txt = await res.text();
            return Response.json(
              { error: `AI gateway ${res.status}: ${txt.slice(0, 200)}` },
              { status: res.status === 429 || res.status === 402 ? res.status : 500 },
            );
          }
          const data = await res.json();
          const text: string =
            data?.choices?.[0]?.message?.content?.trim() ?? "";
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