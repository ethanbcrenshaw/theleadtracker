import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import {
  parseCsv,
  proposeMapping,
  rowsToCandidates,
  type CsvMapping,
} from "@/lib/discovery/csv-import";
import { runDiscovery } from "@/lib/discovery";

// CSV lead import (Data Axle exports etc.), two-step:
//   { action: "map", csv }              → headers + proposed column mapping +
//                                          sample rows for user confirmation
//   { action: "import", csv, mapping }  → full parse, then the same
//                                          merge/dedupe/off-Google cross-check
//                                          as discovered candidates
// Rows without a website are cross-checked against Places first (budget-
// capped in the orchestrator), since those are the likeliest off-Google gold.

type Body = {
  action?: "map" | "import";
  csv?: string;
  mapping?: CsvMapping;
  type?: string;
  city?: string;
};

export const Route = createFileRoute("/api/import-csv")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad JSON" }, { status: 400 });
        }
        const csv = (body.csv || "").trim();
        if (!csv) return Response.json({ error: "csv required" }, { status: 400 });

        const rows = parseCsv(csv);
        if (rows.length < 2)
          return Response.json(
            { error: "CSV needs a header row and at least one data row" },
            { status: 400 },
          );
        const headers = rows[0].map((h) => h.trim());
        const dataRows = rows.slice(1);

        if (body.action === "map") {
          const mapping = await proposeMapping(headers, dataRows);
          return Response.json({ ok: true, headers, mapping, rowCount: dataRows.length });
        }

        if (body.action === "import") {
          if (!body.mapping) return Response.json({ error: "mapping required" }, { status: 400 });
          const candidates = rowsToCandidates(
            headers,
            dataRows,
            body.mapping,
            body.type || "No Dedicated Website",
          );
          if (!candidates.length)
            return Response.json(
              { error: "No usable rows — check the business-name column mapping" },
              { status: 400 },
            );
          // No-website rows first so the budget-capped off-Google cross-check
          // spends its lookups on the likeliest gold.
          candidates.sort((a, b) => Number(Boolean(a.website)) - Number(Boolean(b.website)));
          const result = await runDiscovery(
            {
              industry: "csv import",
              city: body.city || "",
              count: candidates.length,
              type: body.type || "No Dedicated Website",
            },
            { sources: [], extraCandidates: [candidates] },
          );
          return Response.json({
            ok: true,
            candidates: result.candidates,
            droppedExisting: result.droppedExisting,
            notes: result.notes,
          });
        }

        return Response.json({ error: "unknown action" }, { status: 400 });
      },
    },
  },
});
