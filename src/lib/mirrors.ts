/**
 * Openly-published mirrors for the DECIPHER content this server serves.
 *
 * DECIPHER's own /data/* endpoints are gated behind a same-origin Referer
 * check (see ./http.ts), so the DEFAULT data path of this server is the same
 * content as published — openly, for programmatic use, keyless — by the
 * upstream projects DECIPHER itself aggregates:
 *
 *   - EBI Gene2Phenotype  → the g2p / G2PAssociations block (gene locus, ids,
 *     synonyms, and the curated disease records with confidence, allelic
 *     requirement and molecular mechanism).
 *     https://www.ebi.ac.uk/gene2phenotype/api/  (JSON, keyless)
 *   - ClinGen dosage curation → the recurrent CNV-syndrome regions with GRCh38
 *     coordinates and haploinsufficiency / triplosensitivity scores.
 *     https://ftp.clinicalgenome.org/ClinGen_region_curation_list_GRCh38.tsv
 *   - dbVar nstd183 "DECIPHER Consensus CNVs" → population CNV frequency
 *     (AC / AF / AN) for a genomic region. This IS DECIPHER's own CNV set,
 *     deposited by DECIPHER at NCBI for public redistribution.
 *     https://ftp.ncbi.nlm.nih.gov/pub/dbVar/data/Homo_sapiens/by_study/tsv/
 *
 * What no mirror reproduces: DECIPHER's own composite gene record (hi_score,
 * p_hi/p_ts, s_het, protein_mechanism_data, EpiSignatures) and its patient
 * records. The first needs the DECIPHER_SEND_REFERER opt-in or a Client API
 * Key; the second is out of scope entirely (robots.txt + Terms clause 5).
 */

import { restFetch } from "@bio-mcp/shared/http/rest-fetch";

export const G2P_BASE = "https://www.ebi.ac.uk/gene2phenotype/api";
export const CLINGEN_REGION_TSV =
	"https://ftp.clinicalgenome.org/ClinGen_region_curation_list_GRCh38.tsv";
export const DBVAR_NSTD183_CALLS =
	"https://ftp.ncbi.nlm.nih.gov/pub/dbVar/data/Homo_sapiens/by_study/tsv/nstd183.GRCh38.variant_call.tsv.gz";

const MIRROR_UA =
	"decipher-mcp-server/1.0 (bio-mcp; https://github.com/QuentinCody/decipher-mcp-server)";

// ── EBI Gene2Phenotype ───────────────────────────────────────────────────

export interface G2pGeneRecord {
	gene_symbol: string;
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
}

export interface G2pGeneResult {
	found: boolean;
	/** Upstream status of the gene lookup (404 means "no such gene in G2P"). */
	status: number;
	gene?: G2pGeneRecord;
	/** Raw upstream error body, when the lookup failed. */
	error?: string;
}

/**
 * Look up one gene in EBI Gene2Phenotype: the gene record (locus, HGNC/Ensembl/
 * OMIM ids, synonyms) plus its curated disease records.
 *
 * G2P returns 404 {"error":"No matching Gene found for: X"} for an unknown
 * symbol, which the caller maps to NOT_FOUND.
 */
export async function fetchG2pGene(symbol: string): Promise<G2pGeneResult> {
	const encoded = encodeURIComponent(symbol);
	const geneResponse = await restFetch(G2P_BASE, `/gene/${encoded}/`, undefined, {
		userAgent: MIRROR_UA,
		timeout: 15_000,
		deadlineMs: 30_000,
	});

	if (!geneResponse.ok) {
		return {
			found: false,
			status: geneResponse.status,
			error: (await geneResponse.text().catch(() => "")).slice(0, 200),
		};
	}

	const gene = (await geneResponse.json()) as Record<string, unknown>;

	// The disease records live on a SECOND endpoint. A failure there is not
	// fatal — the locus/ids block is still real data — but it must never be
	// rendered as "zero curated records": that is byte-identical to a gene G2P
	// genuinely curates nothing for. So the outcome of this call is carried out
	// of here as records_available / records_status / records_error, and the
	// caller decides what to show.
	let records: unknown[] = [];
	let recordsAvailable = false;
	let recordsStatus = 0;
	let recordsError: string | undefined;

	const summaryResponse = await restFetch(G2P_BASE, `/gene/${encoded}/summary/`, undefined, {
		userAgent: MIRROR_UA,
		timeout: 15_000,
		deadlineMs: 30_000,
	}).catch((err: unknown) => {
		recordsError = `request failed: ${err instanceof Error ? err.message : String(err)}`;
		return undefined;
	});

	if (summaryResponse) {
		recordsStatus = summaryResponse.status;
		if (!summaryResponse.ok) {
			// Collapse the body to one line: some G2P failures answer with an
			// HTML page, and a multi-line blob buries the flag that matters.
			const body = (await summaryResponse.text().catch(() => ""))
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 200);
			recordsError = `HTTP ${summaryResponse.status}${body ? ` - ${body}` : ""}`;
		} else {
			const summary = await summaryResponse
				.json()
				.then((value) => value as Record<string, unknown>)
				.catch((err: unknown) => {
					recordsError = `unparseable JSON: ${err instanceof Error ? err.message : String(err)}`;
					return undefined;
				});
			if (summary) {
				if (Array.isArray(summary.records_summary)) {
					records = summary.records_summary;
					recordsAvailable = true;
				} else {
					// 200 without the array is an upstream SHAPE change, not an
					// empty curation set. Reporting it as zero records would be
					// the same silent empty by a different route.
					recordsError =
						"HTTP 200 without a records_summary array (upstream response shape changed)";
				}
			}
		}
	}

	return {
		found: true,
		status: geneResponse.status,
		gene: {
			gene_symbol: String(gene.gene_symbol ?? symbol),
			location: {
				assembly: gene.reference,
				chr: gene.sequence,
				start: gene.start,
				end: gene.end,
				strand: gene.strand,
			},
			ids: (gene.ids as Record<string, unknown>) ?? {},
			synonyms: gene.synonyms ?? [],
			last_updated: gene.last_updated,
			records,
			records_available: recordsAvailable,
			records_status: recordsStatus,
			...(recordsError ? { records_error: recordsError } : {}),
		},
	};
}

// ── ClinGen dosage-sensitivity region curation ───────────────────────────

export interface ClinGenRegion {
	isca_id: string;
	name: string;
	cytoband: string;
	assembly: "GRCh38";
	chr: string;
	start: number | null;
	end: number | null;
	genomic_location: string;
	haploinsufficiency_score: string;
	haploinsufficiency_description: string;
	haploinsufficiency_pmids: string[];
	triplosensitivity_score: string;
	triplosensitivity_description: string;
	triplosensitivity_pmids: string[];
	date_last_evaluated: string;
}

/** `chr16:16762939-18073544` → { chr: "16", start, end } */
function parseGenomicLocation(location: string): {
	chr: string;
	start: number | null;
	end: number | null;
} {
	const match = /^chr([^:]+):(\d+)-(\d+)$/.exec(location.trim());
	if (!match) return { chr: "", start: null, end: null };
	return { chr: match[1], start: Number(match[2]), end: Number(match[3]) };
}

/**
 * Parse the ClinGen region curation TSV.
 *
 * Layout: five `#`-prefixed provenance lines, then a `#`-prefixed HEADER line,
 * then the rows. The header is commented like the provenance lines, so a naive
 * "drop every # line" reader silently loses the column names — hence the
 * column indexes below are pinned by a unit test against a real header.
 */
export function parseClinGenRegionTsv(tsv: string): ClinGenRegion[] {
	const regions: ClinGenRegion[] = [];
	for (const rawLine of tsv.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (!line || line.startsWith("#")) continue;
		const f = line.split("\t");
		if (f.length < 21 || !f[0].startsWith("ISCA-")) continue;
		const pmids = (from: number) =>
			f.slice(from, from + 6).filter((v) => v && v.trim().length > 0);
		const { chr, start, end } = parseGenomicLocation(f[3] ?? "");
		regions.push({
			isca_id: f[0],
			name: f[1] ?? "",
			cytoband: f[2] ?? "",
			assembly: "GRCh38",
			chr,
			start,
			end,
			genomic_location: f[3] ?? "",
			haploinsufficiency_score: f[4] ?? "",
			haploinsufficiency_description: f[5] ?? "",
			haploinsufficiency_pmids: pmids(6),
			triplosensitivity_score: f[12] ?? "",
			triplosensitivity_description: f[13] ?? "",
			triplosensitivity_pmids: pmids(14),
			date_last_evaluated: f[20] ?? "",
		});
	}
	return regions;
}

/** Fetch and parse the ClinGen GRCh38 region curation list (~99KB). */
export async function fetchClinGenRegions(): Promise<ClinGenRegion[]> {
	const response = await restFetch(CLINGEN_REGION_TSV, "", undefined, {
		headers: { Accept: "text/tab-separated-values" },
		userAgent: MIRROR_UA,
		timeout: 20_000,
		deadlineMs: 40_000,
		cache: { ttl: 86_400 },
	});
	if (!response.ok) {
		const body = (await response.text().catch(() => "")).slice(0, 200);
		throw new Error(
			`ClinGen region curation list unavailable: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
		);
	}
	return parseClinGenRegionTsv(await response.text());
}

// ── dbVar nstd183 (DECIPHER Consensus CNVs) ──────────────────────────────

export interface DbVarCall {
	variant_call_accession: string;
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
}

/** `AC=9` / `AF=0.0106` / `AN=845` → number, or null when the column is blank. */
function parseTaggedNumber(value: string | undefined): number | null {
	if (!value) return null;
	const n = Number(value.includes("=") ? value.slice(value.indexOf("=") + 1) : value);
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
	if (!overlapsRegion(call, query)) return false;
	if (query.variantType && call.variant_call_type !== query.variantType) return false;
	if (
		query.minAlleleFrequency !== undefined &&
		(call.allele_frequency === null || call.allele_frequency < query.minAlleleFrequency)
	) {
		return false;
	}
	return true;
}

/**
 * Stream the nstd183 GRCh38 variant-call file and keep the calls overlapping a
 * region.
 *
 * The study file is 3,199,833 bytes gzipped (Content-Length, 2026-08-27) with
 * 67,142 calls, and dbVar publishes no region query for it, so it is
 * decompressed and filtered as a stream — nothing but the matched rows is ever
 * held in memory.
 *
 * KNOWN LIMIT — every call re-downloads and re-parses the whole file. Two
 * successive local calls for chr22:18,900,000-21,500,000 each reported
 * scanned=67142 (0.94s then 0.67s wall through the MCP tool under
 * `wrangler dev`, measured 2026-08-27), so there is no reuse between calls.
 *
 * It is NOT routed through restFetch's Worker cache (as fetchClinGenRegions is)
 * on purpose: that path stores `response.clone()` and awaits the store before
 * handing the body back, which makes the runtime buffer a 3.2 MB branch on a
 * streaming response — and `caches.default` is a no-op under local
 * `wrangler dev`, so the change could not be verified anywhere this server is
 * run today. Fixing it properly means a size-aware cache store in
 * @bio-mcp/shared, which is outside this file. Until then the cost is
 * one 3.2 MB GET + 67k parsed rows per query.
 */
export async function fetchDbVarCnvCalls(query: DbVarQuery): Promise<DbVarResult> {
	const response = await fetch(DBVAR_NSTD183_CALLS, {
		headers: { "User-Agent": MIRROR_UA },
		signal: AbortSignal.timeout(60_000),
	});
	if (!response.ok || !response.body) {
		throw new Error(`dbVar nstd183 study file unavailable: HTTP ${response.status}`);
	}

	const limit = query.limit ?? 200;
	const reader = response.body
		.pipeThrough(new DecompressionStream("gzip"))
		.pipeThrough(new TextDecoderStream())
		.getReader();

	const calls: DbVarCall[] = [];
	let scanned = 0;
	let matched = 0;
	let carry = "";

	const consume = (line: string) => {
		if (!line || line.startsWith("#")) return;
		scanned++;
		const call = parseDbVarCallRow(line);
		if (!call || !keepCall(call, query)) return;
		matched++;
		if (calls.length < limit) calls.push(call);
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		const parts = (carry + value).split("\n");
		carry = parts.pop() ?? "";
		for (const line of parts) consume(line);
	}
	consume(carry);

	return { calls, scanned, matched, truncated: matched > calls.length };
}
