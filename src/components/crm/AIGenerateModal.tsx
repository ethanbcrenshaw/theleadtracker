import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  X,
  Loader2,
  AlertCircle,
  Check,
  ExternalLink,
  Globe,
  Phone,
  MapPin,
} from "lucide-react";
import { useLeads } from "@/lib/store";
import type {
  Lead,
  LeadEnrichment,
  LeadSource,
  LeadTier,
  LeadVerification,
  ScoreBreakdown,
  VerificationTier,
  WebsiteOpportunity,
} from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  initialIndustry?: string;
  initialCity?: string;
}

const ALLOWED_SOURCES: LeadSource[] = [
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
];
const ALLOWED_OPP: WebsiteOpportunity[] = [
  "No Dedicated Website",
  "Facebook Only",
  "Yelp/Directory Only",
  "Outdated Website",
  "Has Website",
  "Social-Heavy",
];

function qualityFor(opp: WebsiteOpportunity): "High" | "Medium" | "Low" {
  if (opp === "Has Website") return "Low";
  if (opp === "Outdated Website") return "Medium";
  return "High";
}

type Candidate = {
  business: string;
  city: string;
  state: string;
  phone: string;
  owner: string | null;
  sourceUrl: string | null;
  website: string | null;
  sources: string[];
  onlinePresence: string;
  websiteOpportunity: string;
  matchesFilter: boolean;
  placesSignals?: {
    businessStatus?: string;
    rating?: number;
    reviewCount?: number;
    lastReviewAt?: string;
  };
  // multi-source discovery provenance
  foundVia?: string[];
  offGoogle?: boolean;
  registeredAt?: string;
  phoneInvalid?: boolean;
  // filled during enrichment phase
  enrichment?: LeadEnrichment;
  confidenceScore?: number;
  confidenceEvidence?: string[];
  unverified?: boolean;
  unverifiedReason?: string;
  verificationTier?: VerificationTier;
  verificationReasons?: string[];
  verification?: LeadVerification;
  leadScore?: number;
  leadTier?: LeadTier;
  scoreBreakdown?: ScoreBreakdown;
  _id: string;
  _selected: boolean;
  _enrichState: "pending" | "running" | "done" | "failed";
};

type Phase = "form" | "searching" | "enriching" | "review" | "csv" | "csv-map";

const ENRICH_CONCURRENCY = 3;

// Discovery source ids ↔ chip labels (mono, editorial).
const SOURCE_META: Array<{ id: string; label: string; short: string }> = [
  { id: "places", label: "GOOGLE", short: "GOOGLE" },
  { id: "firecrawl-search", label: "WEB SEARCH", short: "WEB" },
  { id: "foursquare", label: "FOURSQUARE", short: "FSQ" },
  { id: "knox-registry", label: "NEW FILINGS", short: "FILINGS" },
];
const SHORT_LABEL: Record<string, string> = Object.fromEntries(
  SOURCE_META.map((s) => [s.id, s.short]),
);
SHORT_LABEL["csv-import"] = "CSV";

type SourceInfo = { id: string; configured: boolean };
type CsvField = "business" | "phone" | "city" | "state" | "website";
const CSV_FIELDS: CsvField[] = ["business", "phone", "city", "state", "website"];
type CsvMapping = Record<CsvField, string | null>;

async function runConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<void>,
) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        await fn(items[idx], idx);
      } catch {
        /* swallow per-item */
      }
    }
  });
  await Promise.all(workers);
}

export function AIGenerateModal({ open, onClose, initialIndustry, initialCity }: Props) {
  const addLeads = useLeads((s) => s.addLeads);
  const existing = useLeads((s) => s.leads);
  const [industry, setIndustry] = useState("Upholstery");
  const [city, setCity] = useState("Nashville, TN");
  const [count, setCount] = useState(8);
  const [type, setType] = useState<WebsiteOpportunity>("No Dedicated Website");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [enrichDone, setEnrichDone] = useState(0);
  // multi-source discovery
  const [srcInfo, setSrcInfo] = useState<SourceInfo[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    () => new Set(["places", "firecrawl-search"]),
  );
  const [expandMetro, setExpandMetro] = useState(false);
  const [perSource, setPerSource] = useState<Record<string, number> | null>(null);
  const [droppedExisting, setDroppedExisting] = useState(0);
  // CSV import
  const [csvText, setCsvText] = useState("");
  const [csvMapping, setCsvMapping] = useState<CsvMapping | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRowCount, setCsvRowCount] = useState(0);
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialIndustry) setIndustry(initialIndustry);
    if (initialCity) setCity(initialCity);
    // Which sources have keys configured? Default configured ones on.
    fetch("/api/generate-leads")
      .then((r) => r.json())
      .then((j: { sources?: SourceInfo[] }) => {
        if (!Array.isArray(j.sources)) return;
        setSrcInfo(j.sources);
        setSelectedSources(new Set(j.sources.filter((s) => s.configured).map((s) => s.id)));
      })
      .catch(() => {});
  }, [open, initialIndustry, initialCity]);

  function reset() {
    setCandidates([]);
    setError(null);
    setPhase("form");
    setEnrichDone(0);
    setPerSource(null);
    setDroppedExisting(0);
    setCsvText("");
    setCsvMapping(null);
    setCsvHeaders([]);
    setCsvRowCount(0);
    setCsvBusy(false);
  }
  function close() {
    reset();
    onClose();
  }

  /** Client-side belt over the server's saved-lead dedupe (live leads only). */
  function dedupeAgainstLoaded(raw: Candidate[]): Candidate[] {
    const seenNames = new Set(existing.map((l) => l.business.toLowerCase().trim()));
    const seenPhones = new Set(existing.map((l) => l.phone?.replace(/\D/g, "")).filter(Boolean));
    return raw.filter((r) => {
      const key = (r.business || "").toLowerCase().trim();
      if (!key || seenNames.has(key)) return false;
      const ph = (r.phone || "").replace(/\D/g, "");
      if (ph && seenPhones.has(ph)) return false;
      return true;
    });
  }

  async function start() {
    setError(null);
    setPhase("searching");
    try {
      const res = await fetch("/api/generate-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry,
          city,
          count,
          type,
          sources: [...selectedSources],
          expandMetro,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setPerSource(data.perSource ?? null);
      setDroppedExisting(data.droppedExisting ?? 0);

      const raw: Candidate[] = dedupeAgainstLoaded(Array.isArray(data.leads) ? data.leads : []).map(
        (r: Candidate, i: number) => ({
          ...r,
          _id: `${i}-${r.business}`,
          _selected: false,
          _enrichState: "pending" as const,
        }),
      );

      if (!raw.length) {
        setError("No new leads found. Try a different city, lead type, or more sources.");
        setPhase("form");
        return;
      }

      await runEnrichment(raw);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("form");
    }
  }

  /** Enrich a candidate batch (shared by generate + CSV import), then review. */
  async function runEnrichment(raw: Candidate[]) {
    setCandidates(raw);
    setPhase("enriching");
    setEnrichDone(0);

    // Enrich every candidate (no cap) — concurrency 3.
    await runConcurrent(raw, ENRICH_CONCURRENCY, async (cand) => {
      cand._enrichState = "running";
      setCandidates((cs) => [...cs]);
      try {
        const r = await fetch("/api/enrich-candidate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business: cand.business,
            city: cand.city,
            state: cand.state,
            phone: cand.phone,
            website: cand.website,
            websiteOpportunity: cand.websiteOpportunity,
            placesSignals: cand.placesSignals,
            offGoogle: cand.offGoogle,
            foundVia: cand.foundVia,
            industry,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || `enrich ${r.status}`);
        const result = j.result;
        cand.enrichment = result.enrichment;
        cand.confidenceScore = result.confidenceScore;
        cand.confidenceEvidence = result.confidenceEvidence;
        cand.unverified = result.unverified;
        cand.unverifiedReason = result.unverifiedReason;
        cand.verificationTier = result.verificationTier;
        cand.verificationReasons = result.verificationReasons;
        cand.verification = result.verification;
        cand.leadScore = result.leadScore;
        cand.leadTier = result.leadTier;
        cand.scoreBreakdown = result.scoreBreakdown;

        // Reflect what verification actually found back onto the label.
        // result.websiteOpportunity carries the corrected classification,
        // including a site recovered from search that Google didn't list.
        if (result.websiteOpportunity) cand.websiteOpportunity = result.websiteOpportunity;
        if (result.discoveredWebsite && !cand.website) {
          cand.website = result.discoveredWebsite;
          cand.onlinePresence = `Has a website (${result.discoveredWebsite}) — found via search`;
        } else if (result.enrichment?.websiteStatus === "none" && cand.website) {
          cand.onlinePresence = `Claimed site (${cand.website}) unreachable`;
          cand.website = null;
        }
        cand._enrichState = "done";
      } catch {
        cand.verificationTier = "partial";
        cand.verificationReasons = ["enrichment failed — could not verify"];
        cand.confidenceScore = 20;
        cand.confidenceEvidence = ["enrichment failed"];
        cand._enrichState = "failed";
      }
      setEnrichDone((n) => n + 1);
      setCandidates((cs) => [...cs]);
    });

    // Pre-select only VERIFIED candidates after enrichment.
    setCandidates((cs) => cs.map((c) => ({ ...c, _selected: c.verificationTier === "verified" })));
    setPhase("review");
  }

  // ── CSV import (Data Axle etc.) ───────────────────────────────────────────

  async function csvProposeMapping() {
    if (!csvText.trim()) return;
    setCsvBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "map", csv: csvText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `mapping failed (${res.status})`);
      setCsvHeaders(j.headers ?? []);
      setCsvMapping(j.mapping ?? null);
      setCsvRowCount(j.rowCount ?? 0);
      setPhase("csv-map");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that CSV");
    } finally {
      setCsvBusy(false);
    }
  }

  async function csvImport() {
    if (!csvMapping) return;
    setCsvBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", csv: csvText, mapping: csvMapping, type, city }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `import failed (${res.status})`);
      setDroppedExisting(j.droppedExisting ?? 0);
      setPerSource({ "csv-import": (j.candidates ?? []).length });
      const raw: Candidate[] = dedupeAgainstLoaded(j.candidates ?? []).map(
        (r: Candidate, i: number) => ({
          ...r,
          _id: `csv-${i}-${r.business}`,
          _selected: false,
          _enrichState: "pending" as const,
        }),
      );
      if (!raw.length) {
        setError("Every row matched a lead you already have (or had no usable name).");
        setCsvBusy(false);
        setPhase("csv");
        return;
      }
      setCsvBusy(false);
      await runEnrichment(raw);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setCsvBusy(false);
    }
  }

  function toggle(id: string) {
    setCandidates((cs) => cs.map((c) => (c._id === id ? { ...c, _selected: !c._selected } : c)));
  }

  function importSelected() {
    const picked = candidates.filter((c) => c._selected);
    if (!picked.length) return;
    const basePriority = (existing.reduce((m, l) => Math.max(m, l.priority), 0) || 0) + 1;

    const leads: Lead[] = picked.map((r, i) => {
      const sources = (r.sources || []).filter((s) =>
        (ALLOWED_SOURCES as string[]).includes(s),
      ) as LeadSource[];
      const opp = (ALLOWED_OPP as string[]).includes(r.websiteOpportunity)
        ? (r.websiteOpportunity as WebsiteOpportunity)
        : type;
      return {
        id: crypto.randomUUID(),
        priority: basePriority + i,
        business: r.business,
        city: r.city,
        state: r.state,
        phone: r.phone,
        owner: r.owner || undefined,
        ownerSource: r.sourceUrl || undefined,
        onlinePresence: r.onlinePresence || "Discovered via web search",
        websiteOpportunity: opp,
        quality: qualityFor(opp),
        status: "Not Called",
        sources: sources.length ? sources : ["Other"],
        notes: r.sourceUrl ? `Discovered via: ${r.sourceUrl}` : "Discovered via web search.",
        tags: ["ai-found"],
        history: [],
        enrichment: r.enrichment,
        confidenceScore: r.confidenceScore,
        confidenceEvidence: r.confidenceEvidence,
        unverified: r.unverified,
        unverifiedReason: r.unverifiedReason,
        verificationTier: r.verificationTier,
        verificationReasons: r.verificationReasons,
        verification: r.verification,
        leadScore: r.leadScore,
        leadTier: r.leadTier,
        scoreBreakdown: r.scoreBreakdown,
        foundVia: r.foundVia,
      };
    });

    addLeads(leads);
    close();
  }

  const verified = candidates.filter((c) => c.verificationTier === "verified");
  const partial = candidates.filter((c) => c.verificationTier === "partial");
  const unverified = candidates.filter((c) => c.verificationTier === "unverified");
  const selectedCount = candidates.filter((c) => c._selected).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none"
          >
            <div
              className={`bg-background border border-foreground w-full pointer-events-auto ${phase === "review" || phase === "enriching" ? "max-w-3xl" : "max-w-md"} max-h-[90vh] flex flex-col`}
            >
              <div className="flex items-center justify-between p-6 pb-4 border-b border-border">
                <div>
                  <div className="mono text-muted-foreground">— AI Generate</div>
                  <h2 className="font-display text-2xl mt-1 lowercase font-normal">
                    {phase === "review"
                      ? "review found leads"
                      : phase === "enriching"
                        ? "verifying leads"
                        : phase === "searching"
                          ? "searching"
                          : phase === "csv"
                            ? "import a lead list"
                            : phase === "csv-map"
                              ? "confirm columns"
                              : "generate leads"}
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={close}
                    className="mono text-muted-foreground hover:text-foreground"
                  >
                    [ ESC ]
                  </button>
                  <button onClick={close} aria-label="Close" className="p-1 hover:bg-foreground/10">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {phase === "form" && (
                <div className="p-6 overflow-y-auto">
                  <p className="mono text-muted-foreground mb-4">
                    Searches the live web, then{" "}
                    <span className="text-foreground">actually fetches</span> each candidate's
                    website and profile pages to verify they exist and belong to this business.
                    Slower — takes a couple of minutes for a full batch — but every claim is
                    checked.
                  </p>
                  <div className="space-y-3">
                    <Field label="Industry">
                      <input
                        value={industry}
                        onChange={(e) => setIndustry(e.target.value)}
                        className="input"
                      />
                    </Field>
                    <Field label="City, State">
                      <input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="input"
                        placeholder="Nashville, TN"
                      />
                    </Field>
                    <Field label="Number of leads">
                      <input
                        type="number"
                        min={1}
                        max={40}
                        value={count}
                        onChange={(e) => setCount(+e.target.value)}
                        className="input"
                      />
                    </Field>
                    <Field label="Lead type">
                      <select
                        value={type}
                        onChange={(e) => setType(e.target.value as WebsiteOpportunity)}
                        className="input"
                      >
                        <option>No Dedicated Website</option>
                        <option>Facebook Only</option>
                        <option>Yelp/Directory Only</option>
                        <option>Outdated Website</option>
                        <option>Social-Heavy</option>
                      </select>
                    </Field>
                  </div>

                  <div className="mt-4">
                    <span className="mono text-muted-foreground">— Sources</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {SOURCE_META.map((s) => {
                        const info = srcInfo.find((x) => x.id === s.id);
                        const configured = info ? info.configured : s.id === "places";
                        const on = selectedSources.has(s.id);
                        return (
                          <button
                            key={s.id}
                            disabled={!configured}
                            title={configured ? undefined : "add the API key in .env to enable"}
                            onClick={() =>
                              setSelectedSources((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              })
                            }
                            className={`mono border px-2 py-1 transition ${
                              !configured
                                ? "border-border text-muted-foreground/50 cursor-not-allowed"
                                : on
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                            }`}
                          >
                            [ {s.label} ]
                          </button>
                        );
                      })}
                    </div>
                    {srcInfo.some((s) => !s.configured) && (
                      <p className="mono text-muted-foreground/70 mt-1.5">
                        greyed sources need an API key in .env
                      </p>
                    )}
                    <label className="mono mt-3 flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={expandMetro}
                        onChange={(e) => setExpandMetro(e.target.checked)}
                        className="h-3.5 w-3.5 rounded-none accent-foreground"
                      />
                      [ + SURROUNDING TOWNS ]
                      <span className="text-muted-foreground/70">Knox metro fan-out</span>
                    </label>
                  </div>

                  {error && (
                    <div className="mt-3 flex items-start gap-2 border border-destructive p-3 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
                    </div>
                  )}
                  <button
                    onClick={start}
                    disabled={selectedSources.size === 0}
                    className="mono mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-foreground text-background hover:opacity-90 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> [ FIND & VERIFY ]
                  </button>
                  <button
                    onClick={() => {
                      setError(null);
                      setPhase("csv");
                    }}
                    className="mono mt-3 w-full px-4 py-2.5 border border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  >
                    [ IMPORT CSV ] — Data Axle or any business list
                  </button>
                </div>
              )}

              {phase === "searching" && (
                <div className="p-10 flex flex-col items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <div className="mono text-muted-foreground">
                    SEARCHING —{" "}
                    {SOURCE_META.filter((s) => selectedSources.has(s.id))
                      .map((s) => `${s.short} ···`)
                      .join(" · ")}
                  </div>
                </div>
              )}

              {phase === "csv" && (
                <div className="p-6 overflow-y-auto flex-1">
                  <p className="mono text-muted-foreground mb-3">
                    Paste CSV text or pick a file (Data Axle export or any list with business
                    names). Columns get AI-mapped; you confirm before anything imports.
                  </p>
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="mono text-muted-foreground mb-3 block w-full"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = () => setCsvText(String(reader.result || ""));
                      reader.readAsText(f);
                    }}
                  />
                  <textarea
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder={"Company Name,Phone Number,City,State,Web Address\n…"}
                    rows={10}
                    className="input font-mono"
                  />
                  {error && (
                    <div className="mt-3 flex items-start gap-2 border border-destructive p-3 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-between">
                    <button onClick={() => setPhase("form")} className="mono ink-link">
                      [ BACK ]
                    </button>
                    <button
                      onClick={csvProposeMapping}
                      disabled={!csvText.trim() || csvBusy}
                      className="mono inline-flex items-center gap-2 px-5 py-2.5 bg-foreground text-background hover:opacity-90 disabled:opacity-50"
                    >
                      {csvBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} [ MAP COLUMNS ]
                    </button>
                  </div>
                </div>
              )}

              {phase === "csv-map" && csvMapping && (
                <div className="p-6 overflow-y-auto flex-1">
                  <p className="mono text-muted-foreground mb-4">
                    {String(csvRowCount).padStart(3, "0")} rows found. Check the mapping — a blank
                    website column imports as “No Dedicated Website”.
                  </p>
                  <div className="space-y-3">
                    {CSV_FIELDS.map((f) => (
                      <Field key={f} label={f === "business" ? "business (required)" : f}>
                        <select
                          value={csvMapping[f] ?? ""}
                          onChange={(e) =>
                            setCsvMapping((m) => (m ? { ...m, [f]: e.target.value || null } : m))
                          }
                          className="input"
                        >
                          <option value="">— not in this file —</option>
                          {csvHeaders.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  </div>
                  {error && (
                    <div className="mt-3 flex items-start gap-2 border border-destructive p-3 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
                    </div>
                  )}
                  <div className="mt-5 flex items-center justify-between">
                    <button onClick={() => setPhase("csv")} className="mono ink-link">
                      [ BACK ]
                    </button>
                    <button
                      onClick={csvImport}
                      disabled={!csvMapping.business || csvBusy}
                      className="mono inline-flex items-center gap-2 px-5 py-2.5 bg-foreground text-background hover:opacity-90 disabled:opacity-50"
                    >
                      {csvBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} [ IMPORT{" "}
                      {String(csvRowCount).padStart(3, "0")} ROWS ]
                    </button>
                  </div>
                </div>
              )}

              {phase === "enriching" && (
                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                  <SourceCounts perSource={perSource} dropped={droppedExisting} />
                  <div className="mono text-foreground">
                    RESEARCHING {String(enrichDone).padStart(2, "0")} /{" "}
                    {String(candidates.length).padStart(2, "0")}
                  </div>
                  <div className="h-px bg-border">
                    <div
                      className="h-px bg-foreground transition-all"
                      style={{
                        width: `${candidates.length ? (enrichDone / candidates.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <ul className="divide-y divide-border border-y border-border">
                    {candidates.map((c) => (
                      <li key={c._id} className="py-2 flex items-center gap-3">
                        <span className="mono text-muted-foreground w-20 shrink-0">
                          {c._enrichState === "done"
                            ? "✓ DONE"
                            : c._enrichState === "failed"
                              ? "✗ FAIL"
                              : c._enrichState === "running"
                                ? "…"
                                : "—"}
                        </span>
                        <span className="text-sm text-foreground truncate flex-1">
                          {c.business}
                        </span>
                        {c.verificationTier && <TierChip tier={c.verificationTier} />}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {phase === "review" && (
                <>
                  <div className="p-6 pt-4 overflow-y-auto flex-1 space-y-6">
                    <SourceCounts perSource={perSource} dropped={droppedExisting} />
                    <p className="mono text-muted-foreground">
                      Only VERIFIED leads are pre-selected. PARTIAL and UNVERIFIED candidates can be
                      imported anyway with an explicit checkbox — read the reason first. OFF GOOGLE
                      finds sort first — invisible to competitors searching Google.
                    </p>
                    {verified.length > 0 && (
                      <Section
                        title={`Verified (${verified.length})`}
                        subtitle="Fetched a live site or an identity-matched profile page. Safe to import."
                      >
                        {verified.map((c) => (
                          <CandidateRow key={c._id} c={c} onToggle={toggle} />
                        ))}
                      </Section>
                    )}
                    {partial.length > 0 && (
                      <Section
                        title={`Partial (${partial.length})`}
                        subtitle="Some signals matched, but verification was incomplete. Review before importing."
                      >
                        {partial.map((c) => (
                          <CandidateRow key={c._id} c={c} onToggle={toggle} />
                        ))}
                      </Section>
                    )}
                    {unverified.length > 0 && (
                      <Section
                        title={`Unverified (${unverified.length})`}
                        subtitle="Failed verification — likely closed, wrong business, or no real presence."
                      >
                        {unverified.map((c) => (
                          <CandidateRow key={c._id} c={c} onToggle={toggle} />
                        ))}
                      </Section>
                    )}
                    {!candidates.length && (
                      <p className="text-sm text-muted-foreground">No leads to review.</p>
                    )}
                  </div>
                  <div className="p-4 border-t border-border flex items-center justify-between gap-3">
                    <button
                      onClick={() => {
                        setPhase("form");
                        setCandidates([]);
                      }}
                      className="mono ink-link"
                    >
                      [ BACK ]
                    </button>
                    <button
                      onClick={importSelected}
                      disabled={!selectedCount}
                      className="mono inline-flex items-center gap-2 px-5 py-2.5 bg-foreground text-background hover:opacity-90 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> [ IMPORT{" "}
                      {String(selectedCount).padStart(3, "0")} ]
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
          <style>{`.input{width:100%;padding:.55rem .75rem;background:transparent;border:1px solid var(--border);font-size:.875rem;color:var(--foreground)}.input:focus{outline:none;border-color:var(--foreground)}`}</style>
        </>
      )}
    </AnimatePresence>
  );
}

function SourceCounts({
  perSource,
  dropped,
}: {
  perSource: Record<string, number> | null;
  dropped: number;
}) {
  if (!perSource) return null;
  const parts = Object.entries(perSource).map(
    ([id, n]) => `${SHORT_LABEL[id] ?? id.toUpperCase()} ${String(n).padStart(2, "0")}`,
  );
  if (!parts.length) return null;
  return (
    <div className="mono text-muted-foreground border-b border-border pb-2">
      FOUND — {parts.join(" · ")}
      {dropped > 0 && (
        <span className="text-muted-foreground/70"> · {dropped} already in your book, skipped</span>
      )}
    </div>
  );
}

function ProvenanceChips({ c }: { c: Candidate }) {
  const via = c.foundVia ?? [];
  const hasAny = via.length > 0 || c.offGoogle || c.registeredAt || c.phoneInvalid;
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {c.offGoogle && (
        <span className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-1.5 py-0.5 font-medium">
          OFF GOOGLE
        </span>
      )}
      {c.registeredAt && (
        <span className="mono border border-[color:var(--frog-ink)] text-[color:var(--frog-ink)] px-1.5 py-0.5">
          NEW — REGISTERED {c.registeredAt}
        </span>
      )}
      {c.phoneInvalid && (
        <span className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-1.5 py-0.5">
          BAD PHONE
        </span>
      )}
      {via.map((s) => (
        <span key={s} className="mono border border-border text-muted-foreground px-1.5 py-0.5">
          {SHORT_LABEL[s] ?? s.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function TierChip({ tier }: { tier: VerificationTier }) {
  const cls =
    tier === "verified"
      ? "border-foreground text-foreground"
      : tier === "unverified"
        ? "border-[color:var(--sienna)] text-[color:var(--sienna)]"
        : "border-border text-muted-foreground";
  return <span className={`mono border px-1.5 py-0.5 ${cls}`}>{tier.toUpperCase()}</span>;
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 pb-2 border-b border-border">
        <div className="mono text-foreground">{title}</div>
        <p className="mono text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CandidateRow({ c, onToggle }: { c: Candidate; onToggle: (id: string) => void }) {
  const tier = c.verificationTier ?? "partial";
  const dim = tier !== "verified";
  return (
    <label
      className={`flex items-start gap-3 p-3 border cursor-pointer transition ${
        c._selected
          ? "border-foreground bg-foreground/[0.04]"
          : "border-border hover:bg-foreground/[0.02]"
      } ${dim && !c._selected ? "opacity-70" : ""}`}
    >
      <input
        type="checkbox"
        checked={c._selected}
        onChange={() => onToggle(c._id)}
        className="mt-1 h-4 w-4 rounded-none accent-foreground"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <p className="font-display text-lg truncate">{c.business}</p>
          <div className="flex items-center gap-2 mono text-muted-foreground shrink-0">
            <TierChip tier={tier} />
            {typeof c.leadScore === "number" && (
              <span className="text-foreground">SCORE {String(c.leadScore).padStart(2, "0")}</span>
            )}
            {typeof c.confidenceScore === "number" && (
              <span className="text-foreground">
                CONF {String(c.confidenceScore).padStart(2, "0")}
              </span>
            )}
            <span>{c.websiteOpportunity}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{c.onlinePresence}</p>
        <ProvenanceChips c={c} />
        {c.unverified && (
          <p className="mono mt-2 text-[color:var(--sienna)]">
            ⚠ {(c.unverifiedReason || "review before importing").toUpperCase()}
          </p>
        )}
        {(c.verificationReasons?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {c.verificationReasons!.slice(0, 6).map((chip, i) => (
              <span
                key={i}
                className={`mono border px-1.5 py-0.5 ${
                  /unreachable|didn't match|failed|closed/i.test(chip)
                    ? "border-[color:var(--sienna)] text-[color:var(--sienna)]"
                    : "border-border text-muted-foreground"
                }`}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-muted-foreground">
          {(c.city || c.state) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {c.city}
              {c.state ? `, ${c.state}` : ""}
            </span>
          )}
          {c.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {c.phone}
            </span>
          )}
          {c.website && (
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3 w-3" />
              {c.website}
            </span>
          )}
          {c.sourceUrl && (
            <a
              href={c.sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono text-muted-foreground">— {label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
