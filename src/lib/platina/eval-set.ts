/**
 * Retrieval evaluation set (R5.2). Hand-labelled query → expected-record
 * pairs over a small Waters-domain corpus. This is the regression gate for
 * every chunking, prompt, threshold, or retrieval change: improvement and
 * regression become distinguishable.
 *
 * Categories:
 *  - exact:    instrument model numbers, method codes, catalogue references —
 *              the cases pure vector search misses (R4.4 motivation).
 *  - semantic: conceptual matches with no shared keywords.
 *  - negative: queries with no correct record; the right answer is the
 *              insufficient-relevance state (R4.2), not a forced match.
 *
 * Live mode seeds the corpus into the e2e-fixture workspace tagged
 * `eval://` and cleans up after itself. CI runs integrity + runner tests
 * without embeddings.
 */

export type EvalRecord = { key: string; content: string };

export const EVAL_SOURCE_PREFIX = "eval://";

export const EVAL_CORPUS: EvalRecord[] = [
  {
    key: "xevo-tq-gc",
    content:
      "Xevo TQ-GC triple quadrupole GC-MS/MS system for pesticide residue and environmental contaminant analysis",
  },
  {
    key: "acquity-premier",
    content:
      "ACQUITY Premier UPLC system with MaxPeak High Performance Surfaces for metal-sensitive analytes",
  },
  {
    key: "bioaccord",
    content:
      "BioAccord LC-MS system for biopharmaceutical product attribute monitoring and quality control",
  },
  {
    key: "alliance-is",
    content:
      "Alliance iS HPLC system for routine quality control testing with intuitive operation",
  },
  {
    key: "qda",
    content:
      "QDa single quadrupole mass detector for routine LC-MS screening in pharmaceutical labs",
  },
  {
    key: "arc-hplc",
    content:
      "Arc HPLC system for method transfer from legacy HPLC platforms with reproducible retention times",
  },
  {
    key: "asms-2026",
    content:
      "ASMS 2026 annual conference on mass spectrometry and allied topics, June 2026",
  },
  {
    key: "pittcon-2026",
    content:
      "Pittcon 2026 conference and exposition for laboratory science and analytical chemistry",
  },
  {
    key: "epa-9056",
    content:
      "EPA Method 9056A determination of inorganic anions by ion chromatography",
  },
  {
    key: "usp-621",
    content:
      "USP general chapter 621 chromatography compliance requirements for system suitability",
  },
  {
    key: "outcome-q1-webinar",
    content:
      "Q1 webinar campaign outcome: 42 leads, 17 qualified leads, 40.5% conversion rate, pipeline contribution recorded",
  },
  {
    key: "empower-cds",
    content:
      "Empower chromatography data system (CDS) for compliance, audit trails, and laboratory data management",
  },
];

export type EvalPair = {
  query: string;
  /** Corpus key expected in the top-k, or null when no record should match. */
  expect: string | null;
  category: "exact" | "semantic" | "negative";
};

export const EVAL_PAIRS: EvalPair[] = [
  // exact — model numbers and codes
  { query: "Xevo TQ-GC", expect: "xevo-tq-gc", category: "exact" },
  { query: "ACQUITY Premier", expect: "acquity-premier", category: "exact" },
  { query: "BioAccord", expect: "bioaccord", category: "exact" },
  { query: "Alliance iS", expect: "alliance-is", category: "exact" },
  { query: "QDa detector", expect: "qda", category: "exact" },
  { query: "Arc HPLC", expect: "arc-hplc", category: "exact" },
  { query: "EPA 9056A", expect: "epa-9056", category: "exact" },
  { query: "USP <621>", expect: "usp-621", category: "exact" },
  { query: "Empower CDS", expect: "empower-cds", category: "exact" },
  { query: "ASMS 2026", expect: "asms-2026", category: "exact" },
  // semantic — no shared keywords
  { query: "triple quadrupole instrument for pesticide testing", expect: "xevo-tq-gc", category: "semantic" },
  { query: "liquid chromatography for metal-sensitive compounds", expect: "acquity-premier", category: "semantic" },
  { query: "monitoring biologic drug attributes", expect: "bioaccord", category: "semantic" },
  { query: "routine QC chromatography system", expect: "alliance-is", category: "semantic" },
  { query: "entry-level mass detection for screening", expect: "qda", category: "semantic" },
  { query: "moving methods off an aging HPLC", expect: "arc-hplc", category: "semantic" },
  { query: "mass spec society annual meeting", expect: "asms-2026", category: "semantic" },
  { query: "lab science expo", expect: "pittcon-2026", category: "semantic" },
  { query: "anion testing by ion chromatography", expect: "epa-9056", category: "semantic" },
  { query: "chromatography system suitability rules", expect: "usp-621", category: "semantic" },
  { query: "how did the webinar campaign perform", expect: "outcome-q1-webinar", category: "semantic" },
  { query: "audit trail software for the lab", expect: "empower-cds", category: "semantic" },
  // negative — the honest answer is no match
  { query: "NMR spectroscopy training courses", expect: null, category: "negative" },
  { query: "atomic absorption spectrometer parts", expect: null, category: "negative" },
  { query: "laboratory balance calibration weights", expect: null, category: "negative" },
  { query: "PCR thermal cycler pricing", expect: null, category: "negative" },
  { query: "electron microscope service contract", expect: null, category: "negative" },
  { query: "centrifuge rotor replacement", expect: null, category: "negative" },
  { query: "pH electrode storage solution", expect: null, category: "negative" },
  { query: "gas cylinder regulator safety", expect: null, category: "negative" },
];
