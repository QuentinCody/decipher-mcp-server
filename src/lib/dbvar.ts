import { fail, mirrorRead } from "./mirror-http";
export const DBVAR_NSTD183_CALLS = "https://ftp.ncbi.nlm.nih.gov/pub/dbVar/data/Homo_sapiens/by_study/tsv/nstd183.GRCh38.variant_call.tsv.gz";
const NATIVE_COLUMNS = ["variant_call_accession", "variant_call_id", "variant_call_type", "experiment_id", "sample_id", "sampleset_id", "assembly", "chr", "contig", "outer_start", "start", "inner_start", "inner_stop", "stop", "outer_stop", "insertion_length", "variant_region_acc", "variant_region_id", "copy_number", "description", "validation", "zygosity", "origin", "phenotype", "hgvs_name", "placement_method", "placement_rank", "placements_per_assembly", "remap_alignment", "remap_best_within_cluster", "remap_coverage", "remap_diff_chr", "remap_failure_code", "allele_count", "allele_frequency", "allele_number"];

export interface DbVarCall {
	variant_call_accession: string;
	contig: string;
	native_fields?: Record<string, string>;
	native_tsv?: string;
	source_line?: number;
	variant_call_type: string;
	assembly: string;
	chr: string;
	start: number;
	stop: number;
	/** Which column pair the coordinates came from — see resolveDbVarPlacement. */
	placement: "exact" | "inner" | "outer";
	variant_region_acc: string;
	allele_count: number | null;
	allele_frequency: number | null;
	allele_number: number | null;
}

export interface DbVarQuery {
	chr: string;
	contig?: string;
	start: number;
	end: number;
	/** Only keep calls of this type (e.g. "deletion", "duplication"). */
	variantType?: string;
	/** Only keep calls with allele_frequency >= this. */
	minAlleleFrequency?: number;
	/** Stop collecting after this many matches (matched/scanned still counted). */
	limit?: number;
}

export interface DbVarResult {
	calls: DbVarCall[];
	/** Rows read from the study file. */
	scanned: number;
	/** Rows overlapping the query region and passing the filters. */
	matched: number;
	/** True when `matched` exceeded `limit`, so `calls` is a prefix. */
	truncated: boolean;
	response_evidence?: Record<string, unknown>;
	file_scan?: Record<string, unknown>;
	query?: DbVarQuery;
	complete?: boolean;
}

/** `AC=9` / `AF=0.0106` / `AN=845` → number, or null when the column is blank. */
function parseTaggedNumber(value: string | undefined): number | null {
	if (!value || !value.trim()) return null;
	const raw = value.includes("=") ? value.slice(value.indexOf("=") + 1) : value;
	if (!raw.trim()) return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

/**
 * Resolve a dbVar call's coordinates.
 *
 * dbVar places a call in ONE of three column pairs and leaves the other two
 * blank: (start, stop), (inner_start, inner_stop) or (outer_start, outer_stop).
 * Reading only (start, stop) drops every remapped call — for nstd183 that
 * silently hides all 1,364 chr22 calls, i.e. it returns an empty, plausible,
 * WRONG answer for the 22q11.2 region. Pinned by a unit test.
 */
export function resolveDbVarPlacement(
	fields: string[],
): { start: number; stop: number; placement: DbVarCall["placement"] } | undefined {
	const num = (value: string | undefined): number | undefined => {
		if (!value) return undefined;
		const n = Number(value);
		return Number.isFinite(n) ? n : undefined;
	};
	const pairs: Array<[number | undefined, number | undefined, DbVarCall["placement"]]> = [
		[num(fields[10]), num(fields[13]), "exact"],
		[num(fields[11]), num(fields[12]), "inner"],
		[num(fields[9]), num(fields[14]), "outer"],
	];
	for (const [start, stop, placement] of pairs) {
		if (start !== undefined && stop !== undefined) return { start, stop, placement };
	}
	return undefined;
}

/** Parse one nstd183 variant_call TSV row. Returns undefined for unplaceable rows. */
export function parseDbVarCallRow(line: string): DbVarCall | undefined {
	const f = line.split("\t");
	if (f.length < 36 || !f[0].startsWith("nssv")) return undefined;
	const placed = resolveDbVarPlacement(f);
	if (!placed) return undefined;
	return {
		variant_call_accession: f[0],
		contig: f[8],
		variant_call_type: f[2],
		assembly: f[6],
		chr: f[7],
		start: placed.start,
		stop: placed.stop,
		placement: placed.placement,
		variant_region_acc: f[16],
		allele_count: parseTaggedNumber(f[33]),
		allele_frequency: parseTaggedNumber(f[34]),
		allele_number: parseTaggedNumber(f[35]),
	};
}

/** Half-open-free inclusive overlap test on 1-based genomic coordinates. */
export function overlapsRegion(
	call: Pick<DbVarCall, "chr" | "start" | "stop">,
	query: Pick<DbVarQuery, "chr" | "start" | "end">,
): boolean {
	return call.chr === query.chr && call.start <= query.end && call.stop >= query.start;
}

/** Apply a parsed row to the query filters. */
function keepCall(call: DbVarCall, query: DbVarQuery): boolean {
	if (!overlapsRegion(call, query) || call.contig !== (query.contig ?? "")) return false;
	if (query.variantType && call.variant_call_type !== query.variantType) return false;
	if (
		query.minAlleleFrequency !== undefined &&
		(call.allele_frequency === null || call.allele_frequency < query.minAlleleFrequency)
	) {
		return false;
	}
	return true;
}

export function validateDbVarQuery(query: DbVarQuery): DbVarQuery {
  const chr = String(query.chr).trim().replace(/^chr/i, "");
  if (!/^(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT)$/.test(chr)) fail("Use chromosome 1–22, X, Y or MT");
  if (!Number.isSafeInteger(query.start) || !Number.isSafeInteger(query.end) || query.start < 1 || query.end < query.start) fail("Use positive ordered integer coordinates");
  if (query.contig !== undefined && !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(query.contig)) fail("Invalid alternate contig accession");
  if (query.variantType !== undefined && !["deletion", "duplication", "copy number variation"].includes(query.variantType)) fail("Unsupported CNV type");
  if (query.minAlleleFrequency !== undefined && (!Number.isFinite(query.minAlleleFrequency) || query.minAlleleFrequency < 0 || query.minAlleleFrequency > 1)) fail("Allele frequency must be between 0 and 1");
  const limit = query.limit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) fail("limit must be 1–2000");
  return { ...query, chr, limit };
}

/** Scan one bounded gzip file, preserving native rows and sequence-specific placements. */
export async function fetchDbVarCnvCalls(input: DbVarQuery): Promise<DbVarResult> {
  const query = validateDbVarQuery(input);
  const result = await mirrorRead(DBVAR_NSTD183_CALLS, { accept: "application/octet-stream", maxBytes: 8 * 1024 * 1024, deadline: Date.now() + 45000 });
  const reader = new Response(result.bytes).body?.pipeThrough(new DecompressionStream("gzip")).getReader();
  if (!reader) fail("Empty dbVar gzip", 502);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const calls: DbVarCall[] = []; const accessions = new Set<string>();
  let carry = ""; let expanded = 0;
  const collector = createDbVarCollector(accessions, query, calls);
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      expanded += part.value.byteLength;
      if (expanded > 64 * 1024 * 1024) fail("Expanded dbVar response exceeds 64 MiB", 502);
      const lines = (carry + decoder.decode(part.value, { stream: true })).split("\n"); carry = lines.pop() ?? "";
      if (carry.length > 1024 * 1024) fail("dbVar line exceeds byte bound", 502);
      for (const line of lines) collector.consume(line);
    }
    carry += decoder.decode(); if (carry) collector.consume(carry);
    if (!collector.headers || collector.scanned === 0) fail("No dbVar TSV records", 502);
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  return { calls, scanned: collector.scanned, matched: collector.matched, truncated: collector.matched > calls.length, query, complete: false,
    response_evidence: result.evidence,
    file_scan: { complete: true, expanded_bytes: expanded, columns: collector.headers, placement_rows: collector.scanned, unique_call_accessions: accessions.size, alternate_contig_rows: collector.alternate, unplaced_rows: collector.unplaced,
      query_sequence: query.contig ?? "primary chromosome", coordinate_scope: "1-based inclusive; alternate contigs require their exact accession; placement rows are not distinct variants or people; AF denominators remain study-specific" } };
}

function createDbVarCollector(accessions: Set<string>, query: DbVarQuery, calls: DbVarCall[]) {
  let headers: string[] | undefined; let scanned = 0; let matched = 0; let lineNumber = 0; let unplaced = 0; let alternate = 0;
  const consume = (rawLine: string) => {
    if (rawLine.length > 1024 * 1024) fail("dbVar line exceeds byte bound", 502);
    lineNumber++; const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("#variant_call_accession\t")) {
      headers = line.slice(1).split("\t");
      if (new Set(headers).size !== headers.length || NATIVE_COLUMNS.some((key, index) => headers?.[index] !== key)) fail("Unexpected dbVar TSV columns", 502);
      return;
    }
    if (!line || line.startsWith("#")) return;
    const fields = line.split("\t");
    if (!headers || fields.length !== headers.length || !/^nssv[0-9]+$/.test(fields[0]) || !/^GRCh38(?:\.|$)/.test(fields[6])) fail(`Malformed dbVar row ${lineNumber}`, 502);
    scanned++; accessions.add(fields[0]); if (fields[8]) alternate++;
    const call = parseDbVarCallRow(line);
    if (!call) { unplaced++; return; }
    if (!keepCall(call, query)) return;
    matched++;
    if (calls.length < (query.limit ?? 200)) calls.push({ ...call, source_line: lineNumber, native_tsv: line,
      native_fields: Object.fromEntries(headers.map((key, index) => [key, fields[index]])) });
  };
  return { consume, get headers() { return headers; }, get scanned() { return scanned; }, get matched() { return matched; }, get alternate() { return alternate; }, get unplaced() { return unplaced; } };
}
