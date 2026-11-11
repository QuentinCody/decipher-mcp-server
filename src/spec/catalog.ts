/**
 * Catalog for the DECIPHER server's Code Mode surface.
 *
 * ACCESS, corrected 2026-08-27 (the previous `auth: "none"` and "accessible
 * without authentication" notes are false):
 *
 *   - DECIPHER's /data/* endpoints enforce a SAME-ORIGIN Referer check. Without
 *     `Referer: https://www.deciphergenomics.org/` every path returns
 *     403 {"error":"Access Denied"}; a foreign Referer is rejected too. This
 *     server sends no Referer unless the deployment opts in with
 *     DECIPHER_SEND_REFERER=1, so /data/* paths are 403 by default.
 *   - DECIPHER's sanctioned JSON:API at /api/* returns
 *     403 {"detail":"Client key not provided"} until DECIPHER_CLIENT_KEY holds
 *     a Client API Key, which is requested from DECIPHER. How a key is granted
 *     is UNCONFIRMED from outside — see the note in ../lib/http.ts.
 *   - The DEFAULT data path is /mirror/* — related public datasets from EBI
 *     Gene2Phenotype, ClinGen and NCBI dbVar. They are not interchangeable
 *     with DECIPHER composite or patient records. No origin is asserted.
 *
 * ROBOTS.TXT (fetched live 2026-08-27) disallows /data/patient/, /patient/,
 * the per-gene "protein" and "phenotypes" sub-paths — and also /api/. The
 * protein and phenotypes sub-paths are therefore not listed here at all.
 *
 * Two robots-disallowed paths ARE listed, each for a reason that is not
 * "advertise the data":
 *
 *   - /api/{resource} and /api/{resource}/{id} — robots.txt speaks to
 *     CRAWLERS. /api/* is DECIPHER's own sanctioned PROGRAMMATIC surface,
 *     reached under a Client API Key rather than by crawling, so the crawler
 *     exclusion does not govern a keyed API call. Without a key every path
 *     answers 403 {"detail":"Client key not provided"}, which is what a caller
 *     gets today.
 *   - /data/patient/{id} — listed so that the isolate reaches this server's
 *     REFUSAL. The catalog validator (preflightUnknownEndpoint in
 *     @bio-mcp/shared) rejects any path with no catalog entry BEFORE the
 *     adapter runs, so with no entry a Code Mode caller got
 *     "Unknown endpoint … does not exist" — false, and it hides the reason.
 *     With the entry, api.get() reaches createDecipherApiFetch, which refuses
 *     with 451 and the robots.txt + Terms of Use clause 5 explanation. The
 *     entry can never return patient data: the refusal precedes every fetch.
 */

import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";
import { g2pEvidenceEndpoints } from "./g2p";

export const decipherCatalog: ApiCatalog = {
	name: "DECIPHER (open mirrors + gated DECIPHER endpoints)",
	baseUrl: "https://www.deciphergenomics.org",
	version: "undocumented",
	auth: "mirrors: none; /data/*: DECIPHER_SEND_REFERER opt-in; /api/*: DECIPHER_CLIENT_KEY",
	endpointCount: 16,
	notes:
		"- DEFAULT PATH is /mirror/* — keyless, openly published, no origin assertion\n" +
		"- /mirror/g2p/{path} proxies EBI Gene2Phenotype (https://www.ebi.ac.uk/gene2phenotype/api)\n" +
		"- Gene summaries are not full LGMDE records: follow stable_id to /mirror/g2p/lgd/{stable_id}/ for mechanism evidence, synopsis, variant details and review dates.\n" +
		"- Public alternatives are not DECIPHER patient-level data. Keep G2P, ClinGen and dbVar source identities separate when joining.\n" +
		"- /mirror/clingen/regions returns ClinGen's parsed GRCh38 region curation list\n" +
		"- /mirror/dbvar/nstd183/calls streams DECIPHER's consensus CNVs from NCBI dbVar and filters by region\n" +
		"- /data/* returns 403 {\"error\":\"Access Denied\"} unless DECIPHER_SEND_REFERER=1 (same-origin Referer check)\n" +
		"- /api/* returns 403 {\"detail\":\"Client key not provided\"} unless DECIPHER_CLIENT_KEY is set\n" +
		"- /data/patient/* is REFUSED by this server with HTTP 451 (robots.txt + Terms of Use clause 5) — it is listed only so the refusal, not a bogus 404, reaches you\n" +
		"- DECIPHER wraps its own /data/ responses in { content: { ... } }; the mirrors do not\n" +
		"- ClinGen/dbVar routes select GRCh38; retain the G2P record's native reference assembly. DECIPHER syndrome variants may carry GRCh37 alternative_positions\n" +
		"- Gene lookups use HGNC symbols (e.g. BRCA1, TP53); ClinGen regions use ISCA IDs (e.g. ISCA-46755)\n" +
		"- dbVar allele columns arrive tagged (AC=9, AF=0.0106, AN=845) and are parsed to numbers here",
	endpoints: [
		...g2pEvidenceEndpoints,
		// === Open mirrors (default path) ===
		{
			method: "GET",
			path: "/mirror/g2p/gene/{symbol}/",
			summary:
				"EBI Gene2Phenotype gene record: GRCh38 locus, HGNC/Ensembl/OMIM ids, " +
				"synonyms, last_updated. Keyless. 404 for a symbol G2P does not curate.",
			category: "gene",
			featured: true,
			pathParams: [
				{
					name: "symbol",
					type: "string",
					required: true,
					description: "HGNC gene symbol (e.g. BRCA1, ARID1B)",
				},
			],
			example: "return await api.get('/mirror/g2p/gene/BRCA1/');",
		},
		{
			method: "GET",
			path: "/mirror/g2p/gene/{symbol}/summary/",
			summary:
				"EBI Gene2Phenotype curated disease records for a gene — the openly-published " +
				"source also used by DECIPHER. Summaries carry disease, " +
				"genotype (monoallelic/biallelic), confidence (definitive/strong/moderate/limited), " +
				"molecular_mechanism, variant_consequence, panels and stable_id (G2P00119).",
			category: "gene",
			featured: true,
			pathParams: [
				{
					name: "symbol",
					type: "string",
					required: true,
					description: "HGNC gene symbol (e.g. BRCA1)",
				},
			],
			coveredByTool: "decipher_gene_lookup",
			example:
				"const g = await api.get('/mirror/g2p/gene/BRCA1/summary/');\nreturn g.records_summary;",
		},
		{
			method: "GET",
			path: "/mirror/g2p/search/",
			summary:
				"Search Gene2Phenotype records by gene, disease, phenotype or stable ID; optional panel filter and page. " +
				"Retain count, next and previous: one page is not a complete search. Returns { count, results: [{ stable_id, gene, genotype, " +
				"disease, mechanism, panel, confidence }] }.",
			category: "gene",
			queryParams: [
				{
					name: "type",
					type: "string",
					required: false,
					description: "Omit for generic search; panel is a separate filter",
					enum: ["gene", "disease", "phenotype", "stable_id"],
				},
				{
					name: "query",
					type: "string",
					required: true,
					description: "Search term (e.g. ARID1B)",
				},
				{ name: "panel", type: "string", required: false, description: "Exact panel name from /mirror/g2p/panels/ (e.g. DD)" },
				{ name: "page", type: "number", required: false, description: "1-based result page; preserve native next/previous/count" },
			],
			example:
				"return await api.get('/mirror/g2p/search/', { type: 'gene', query: 'ARID1B' });",
		},
		{
			method: "GET",
			path: "/mirror/g2p/panels/",
			summary:
				"List Gene2Phenotype panels (Cancer, DD, Skeletal, Skin, Eye, …) with per-panel " +
				"record/gene counts, a confidence breakdown, and last_updated.",
			category: "gene",
			example: "return await api.get('/mirror/g2p/panels/');",
		},
		{
			method: "GET",
			path: "/mirror/clingen/regions",
			summary:
				"ClinGen dosage-sensitivity region curation (GRCh38), parsed with the complete native TSV: " +
				"CNV regions with isca_id, name, cytoband, chr/start/end, haploinsufficiency and " +
				"triplosensitivity score + description + PMIDs, disease IDs and date_last_evaluated. This is the " +
				"independent ClinGen curation, not DECIPHER's syndrome catalog or patient data.",
			category: "syndrome",
			featured: true,
			coveredByTool: "decipher_syndromes",
			responseShape:
				"{ region_count: number, regions: Array<{ isca_id, name, cytoband, chr, start, end, haploinsufficiency_score, triplosensitivity_score, ... }> }",
			example:
				"const r = await api.get('/mirror/clingen/regions');\nreturn r.regions.filter(x => x.name.includes('22q11.2'));",
		},
		{
			method: "GET",
			path: "/mirror/dbvar/nstd183/calls",
			summary:
				"Population CNV frequency from NCBI dbVar nstd183 'DECIPHER Consensus CNVs' " +
				"(GRCh38.p12 remap of the February 2020 control-set submission), filtered to a region. Placement rows are not distinct variants or people. Each row carries accession, type, " +
				"coordinates, and allele_count / allele_frequency / allele_number. The study file " +
				"is bounded, scanned and filtered per call; all native columns and the gzip hash are retained. Primary chromosome coordinates only unless contig is specified.",
			category: "cnv",
			featured: true,
			coveredByTool: "decipher_cnv_frequency",
			queryParams: [
				{
					name: "chr",
					type: "string",
					required: true,
					description: "Chromosome without prefix (e.g. '22')",
				},
				{ name: "contig", type: "string", required: false, description: "Exact alternate contig accession; omission selects primary chromosome placements only" },
				{
					name: "start",
					type: "number",
					required: true,
					description: "Region start (GRCh38, 1-based)",
				},
				{
					name: "end",
					type: "number",
					required: true,
					description: "Region end (GRCh38, 1-based)",
				},
				{
					name: "variant_type",
					type: "string",
					required: false,
					description: "deletion | duplication",
				},
				{
					name: "min_allele_frequency",
					type: "number",
					required: false,
					description: "Keep only calls with AF >= this value",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Maximum calls returned (default 200)",
				},
			],
			example:
				"return await api.get('/mirror/dbvar/nstd183/calls', { chr: '22', start: 18900000, end: 21500000, variant_type: 'deletion' });",
		},

		// === DECIPHER's own endpoints (gated) ===
		{
			method: "GET",
			path: "/data/gene/{symbol}",
			summary:
				"DECIPHER's composite gene record — haploinsufficiency (HI) score, p_hi/p_ts, " +
				"s_het, pLI, LOEUF, missense Z-score, OMIM morbid diseases, ClinGen actionability, " +
				"GenCC, ACMG secondary findings, protein mechanism evidence. No open mirror " +
				"reproduces these scores. REQUIRES DECIPHER_SEND_REFERER=1; otherwise 403 " +
				'{"error":"Access Denied"}.',
			category: "gene",
			pathParams: [
				{
					name: "symbol",
					type: "string",
					required: true,
					description: "HGNC gene symbol (e.g. BRCA1)",
				},
			],
			usageHint:
				"Try /mirror/g2p/gene/{symbol}/summary/ first — it is keyless. Use this only " +
				"when the deployment has opted into the Referer and you need DECIPHER's own scores.",
		},
		{
			method: "GET",
			path: "/data/syndromes",
			summary:
				"DECIPHER's ~96 microdeletion/microduplication syndromes with numeric syndrome " +
				"IDs, grades and variant coordinates. REQUIRES DECIPHER_SEND_REFERER=1; " +
				'otherwise 403 {"error":"Access Denied"}. /data/syndrome/{id} returns one ' +
				"syndrome with its genes, phenotypes and mortality data.",
			category: "syndrome",
			usageHint:
				"Prefer the keyless /mirror/clingen/regions unless the deployment has opted in.",
		},
		{
			method: "GET",
			path: "/data/gene/{symbol}/g2p",
			summary:
				"DECIPHER's own G2P association block for one gene. REQUIRES " +
				'DECIPHER_SEND_REFERER=1; otherwise 403 {"error":"Access Denied"}. Not ' +
				"robots-disallowed. The keyless equivalent is /mirror/g2p/gene/{symbol}/summary/.",
			category: "gene",
			pathParams: [
				{
					name: "symbol",
					type: "string",
					required: true,
					description: "HGNC gene symbol (e.g. BRCA1)",
				},
			],
			usageHint:
				"Prefer the keyless /mirror/g2p/gene/{symbol}/summary/ — same curation, no origin assertion.",
			example: "return await api.get('/data/gene/BRCA1/g2p');",
		},
		{
			method: "GET",
			path: "/data/syndrome/{id}",
			summary:
				"One DECIPHER syndrome with its genes, phenotypes and mortality data. " +
				'REQUIRES DECIPHER_SEND_REFERER=1; otherwise 403 {"error":"Access Denied"}. ' +
				"Not robots-disallowed.",
			category: "syndrome",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "Numeric DECIPHER syndrome id (from /data/syndromes)",
				},
			],
			usageHint:
				"Prefer the keyless /mirror/clingen/regions unless the deployment has opted in.",
			example: "return await api.get('/data/syndrome/1');",
		},
		{
			method: "GET",
			path: "/data/patient/{id}",
			summary:
				"REFUSED BY THIS SERVER — returns 451 without contacting DECIPHER. " +
				"robots.txt disallows /data/patient/ and Terms of Use clause 5 forbids copying " +
				"patient data from the website; bulk access goes through a DECIPHER Data Access " +
				"Agreement. Listed only so this refusal reaches you instead of a misleading 404. " +
				"The DECIPHER_SEND_REFERER opt-in does NOT re-open it.",
			category: "patient",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "DECIPHER patient id — refused whatever the value",
				},
			],
			usageHint:
				"Use /mirror/dbvar/nstd183/calls for population CNV frequency instead. Do not retry this path.",
		},
		{
			method: "GET",
			path: "/api/{resource}",
			summary:
				"DECIPHER's sanctioned JSON:API, collection level (e.g. /api/genes). REQUIRES a " +
				"Client API Key in DECIPHER_CLIENT_KEY; without one it returns 403 " +
				'{"detail":"Client key not provided"}. A key is issued through DECIPHER, not by ' +
				"signup — see https://www.deciphergenomics.org/api-docs.",
			category: "decipher-api",
			pathParams: [
				{
					name: "resource",
					type: "string",
					required: true,
					description:
						"ONE JSON:API collection segment (e.g. genes). A member path such as " +
						"genes/BRCA1 belongs to /api/{resource}/{id} — a path param never spans a slash.",
				},
			],
			example: "return await api.get('/api/genes');",
		},
		{
			method: "GET",
			path: "/api/{resource}/{id}",
			summary:
				"DECIPHER's sanctioned JSON:API, member level (e.g. /api/genes/BRCA1). REQUIRES a " +
				"Client API Key in DECIPHER_CLIENT_KEY; without one it returns 403 " +
				'{"detail":"Client key not provided"}.',
			category: "decipher-api",
			pathParams: [
				{
					name: "resource",
					type: "string",
					required: true,
					description: "JSON:API collection (e.g. genes)",
				},
				{
					name: "id",
					type: "string",
					required: true,
					description: "Member id (e.g. BRCA1)",
				},
			],
			example: "return await api.get('/api/genes/BRCA1');",
		},
	],
};
