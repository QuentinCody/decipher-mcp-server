import { mirrorJson, record } from "./mirror-http";
export const G2P_BASE = "https://www.ebi.ac.uk/gene2phenotype/api";
export * from "./clingen-regions";
export * from "./dbvar";

export interface G2pGeneRecord {
	gene_symbol: string;
	native?: Record<string, unknown>;
	response_evidence?: Record<string, unknown>;
	location?: Record<string, unknown>;
	ids?: Record<string, unknown>;
	synonyms?: unknown;
	last_updated?: unknown;
	/**
	 * Curated disease records from /gene/{symbol}/summary/.
	 *
	 * EMPTY IS AMBIGUOUS UNTIL `records_available` IS READ: an empty array is
	 * "G2P curates no disease for this gene" only when `records_available` is
	 * true. Every caller must branch on the flag, never on `records.length`.
	 */
	records: unknown[];
	/** True only when the summary call answered 200 WITH a records_summary array. */
	records_available: boolean;
	/** HTTP status of the summary call; 0 when the request itself never completed. */
	records_status: number;
	/** Why the records are missing, when `records_available` is false. */
	records_error?: string;
	evidence?: unknown;
}

export interface G2pGeneResult {
	found: boolean;
	/** Upstream status of the gene lookup (404 means "no such gene in G2P"). */
	status: number;
	gene?: G2pGeneRecord;
	/** Raw upstream error body, when the lookup failed. */
	error?: string;
	evidence?: unknown;
}

export async function fetchG2pGene(symbol: string): Promise<G2pGeneResult> {
  const base = `${G2P_BASE}/gene/${encodeURIComponent(symbol)}/`; const deadline = Date.now() + 45000;
  let first: Awaited<ReturnType<typeof mirrorJson>>;
  try { first = await mirrorJson(base, undefined, deadline); }
  catch (error) { return { found: false, status: record(error) && typeof error.status === "number" ? error.status : 502, error: error instanceof Error ? error.message : "Gene lookup failed", evidence: record(error) ? error.data : undefined }; }
  const gene = first.data;
  if (!record(gene) || typeof gene.gene_symbol !== "string") return { found: false, status: 502, error: "Unrecognized G2P gene response", evidence: { native: gene, response_evidence: first.evidence } };
  let summary: unknown; let evidence: unknown; let status = 0; let errorMessage: string | undefined;
  try {
    const second = await mirrorJson(base + "summary/", undefined, deadline); summary = second.data; evidence = second.evidence; status = second.status;
    if (!record(summary) || !Array.isArray(summary.records_summary)) errorMessage = "HTTP 200 without a records_summary array (upstream response shape changed)";
  } catch (error) {
    status = record(error) && typeof error.status === "number" ? error.status : 502;
    errorMessage = `HTTP ${status}: ${error instanceof Error ? error.message : "summary unavailable"}`;
    evidence = record(error) ? error.data : undefined;
  }
  const available = !errorMessage && record(summary) && Array.isArray(summary.records_summary);
  return { found: true, status: first.status, gene: {
    gene_symbol: gene.gene_symbol, location: { assembly: gene.reference, chr: gene.sequence, start: gene.start, end: gene.end, strand: gene.strand },
    ids: record(gene.ids) ? gene.ids : {}, synonyms: gene.synonyms, last_updated: gene.last_updated,
    records: available && record(summary) ? summary.records_summary as unknown[] : [], records_available: Boolean(available), records_status: status,
    ...(errorMessage ? { records_error: errorMessage } : {}), native: { gene, summary: summary ?? null }, response_evidence: { gene: first.evidence, summary: evidence },
  } };
}
