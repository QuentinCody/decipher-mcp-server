/**
 * DECIPHER open-access API catalog — hand-built from
 * https://www.deciphergenomics.org/ddd/openaccess/api documentation.
 *
 * Covers patient CNVs, syndromes, HI/TS predictions, and population CNV data.
 * DECIPHER (Database of Chromosomal Imbalance and Phenotype in Humans Using
 * Ensembl Resources) provides open-access genomic variant data for rare disease
 * research.
 */

import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const decipherCatalog: ApiCatalog = {
	name: "DECIPHER Open Access",
	baseUrl: "https://www.deciphergenomics.org/ddd/openaccess/api",
	version: "1.0",
	auth: "none",
	endpointCount: 14,
	notes:
		"- DECIPHER uses GRCh37/hg19 coordinates (NOT GRCh38) — convert coordinates if needed\n" +
		"- CNV types: deletion, duplication, insertion\n" +
		"- Pathogenicity classes: pathogenic, likely_pathogenic, uncertain, likely_benign, benign\n" +
		"- Phenotypes use HPO (Human Phenotype Ontology) terms (e.g. HP:0001250 for seizures)\n" +
		"- Patient data is open-access consented subset only — not all DECIPHER patients are included\n" +
		"- Chromosomal coordinates use 'chr' as string (e.g. '1', '2', ..., 'X', 'Y')\n" +
		"- Large result sets may be paginated — check for 'next' or 'offset' in responses\n" +
		"- No authentication required — all endpoints are publicly accessible",
	endpoints: [
		// === Patient ===
		{
			method: "GET",
			path: "/patients",
			summary: "List open-access patients with their CNVs and phenotypes",
			category: "patient",
			queryParams: [
				{
					name: "has_phenotype",
					type: "boolean",
					required: false,
					description: "Filter to patients with phenotype data",
				},
				{
					name: "sex",
					type: "string",
					required: false,
					description: "Filter by sex",
					enum: ["male", "female", "unknown"],
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max number of patients to return (default: 100)",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination (0-based)",
				},
			],
		},
		{
			method: "GET",
			path: "/patients/{id}",
			summary:
				"Get a specific patient by DECIPHER ID, including their CNVs, phenotypes, and inheritance",
			category: "patient",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "DECIPHER patient ID (numeric)",
				},
			],
		},
		{
			method: "GET",
			path: "/patients/{id}/cnvs",
			summary: "Get all CNVs for a specific patient",
			category: "patient",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "DECIPHER patient ID",
				},
			],
		},
		{
			method: "GET",
			path: "/patients/{id}/phenotypes",
			summary: "Get all phenotypes (HPO terms) for a specific patient",
			category: "patient",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "DECIPHER patient ID",
				},
			],
		},

		// === CNV ===
		{
			method: "GET",
			path: "/cnvs",
			summary:
				"Search CNVs by genomic region, type, and pathogenicity. Returns copy number variants with associated patient and phenotype data.",
			category: "cnv",
			queryParams: [
				{
					name: "chr",
					type: "string",
					required: false,
					description:
						"Chromosome (e.g. '1', '2', ..., '22', 'X', 'Y'). Required for region searches.",
				},
				{
					name: "start",
					type: "number",
					required: false,
					description: "Start position (GRCh37/hg19 coordinates). Use with chr and end.",
				},
				{
					name: "end",
					type: "number",
					required: false,
					description: "End position (GRCh37/hg19 coordinates). Use with chr and start.",
				},
				{
					name: "type",
					type: "string",
					required: false,
					description: "CNV type filter",
					enum: ["deletion", "duplication", "insertion"],
				},
				{
					name: "pathogenicity",
					type: "string",
					required: false,
					description: "Pathogenicity classification filter",
					enum: [
						"pathogenic",
						"likely_pathogenic",
						"uncertain",
						"likely_benign",
						"benign",
					],
				},
				{
					name: "mean_ratio_min",
					type: "number",
					required: false,
					description: "Minimum mean ratio (log2) filter",
				},
				{
					name: "mean_ratio_max",
					type: "number",
					required: false,
					description: "Maximum mean ratio (log2) filter",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max results to return (default: 100)",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},
		{
			method: "GET",
			path: "/cnvs/{id}",
			summary: "Get details for a specific CNV by ID, including genomic coordinates and annotations",
			category: "cnv",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "CNV identifier",
				},
			],
		},

		// === Syndrome ===
		{
			method: "GET",
			path: "/syndromes",
			summary:
				"List known microdeletion/microduplication syndromes with their genomic regions and phenotypes",
			category: "syndrome",
			queryParams: [
				{
					name: "chr",
					type: "string",
					required: false,
					description: "Filter syndromes by chromosome",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max syndromes to return",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},
		{
			method: "GET",
			path: "/syndromes/{id}",
			summary:
				"Get detailed information for a specific syndrome including genomic coordinates, genes, and phenotypes",
			category: "syndrome",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "Syndrome ID",
				},
			],
		},
		{
			method: "GET",
			path: "/syndromes/{id}/patients",
			summary: "Get patients associated with a specific syndrome",
			category: "syndrome",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "Syndrome ID",
				},
			],
			queryParams: [
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max patients to return",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},

		// === Prediction ===
		{
			method: "GET",
			path: "/hi-predictions",
			summary:
				"Get haploinsufficiency (HI) and triplosensitivity (TS) predictions by gene or region. " +
				"Scores range from 0-100%, higher = more likely to be dosage sensitive.",
			category: "prediction",
			queryParams: [
				{
					name: "gene",
					type: "string",
					required: false,
					description: "Gene symbol (e.g. BRAF, TP53) to look up HI/TS predictions",
				},
				{
					name: "chr",
					type: "string",
					required: false,
					description: "Chromosome for region-based lookup",
				},
				{
					name: "start",
					type: "number",
					required: false,
					description: "Start position (GRCh37)",
				},
				{
					name: "end",
					type: "number",
					required: false,
					description: "End position (GRCh37)",
				},
				{
					name: "hi_threshold",
					type: "number",
					required: false,
					description: "Minimum HI score threshold (0-100)",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max results to return",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},

		// === Population ===
		{
			method: "GET",
			path: "/population-cnvs",
			summary:
				"Get population frequency of CNVs from control datasets. " +
				"Useful for filtering rare vs common variants.",
			category: "population",
			queryParams: [
				{
					name: "chr",
					type: "string",
					required: false,
					description: "Chromosome",
				},
				{
					name: "start",
					type: "number",
					required: false,
					description: "Start position (GRCh37)",
				},
				{
					name: "end",
					type: "number",
					required: false,
					description: "End position (GRCh37)",
				},
				{
					name: "type",
					type: "string",
					required: false,
					description: "CNV type filter",
					enum: ["deletion", "duplication"],
				},
				{
					name: "min_frequency",
					type: "number",
					required: false,
					description: "Minimum population frequency (0-1)",
				},
				{
					name: "max_frequency",
					type: "number",
					required: false,
					description: "Maximum population frequency (0-1)",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max results to return",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},
		{
			method: "GET",
			path: "/population-cnvs/{id}",
			summary: "Get details for a specific population CNV by ID",
			category: "population",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "Population CNV identifier",
				},
			],
		},

		// === Search ===
		{
			method: "GET",
			path: "/search",
			summary:
				"Full-text search across patients, CNVs, syndromes, and genes. " +
				"Accepts gene names, HPO terms, syndrome names, or genomic regions.",
			category: "search",
			queryParams: [
				{
					name: "q",
					type: "string",
					required: true,
					description:
						"Search query — gene name, HPO term (e.g. HP:0001250), syndrome name, " +
						"region (e.g. 1:100000-200000), or free text",
				},
				{
					name: "type",
					type: "string",
					required: false,
					description: "Restrict search to a specific entity type",
					enum: ["patient", "cnv", "syndrome", "gene"],
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max results to return",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},
		{
			method: "GET",
			path: "/search/phenotype",
			summary:
				"Search by HPO phenotype term to find patients and CNVs associated with that phenotype",
			category: "search",
			queryParams: [
				{
					name: "hpo",
					type: "string",
					required: true,
					description:
						"HPO term ID (e.g. HP:0001250 for seizures, HP:0001249 for intellectual disability)",
				},
				{
					name: "include_descendants",
					type: "boolean",
					required: false,
					description:
						"Include descendant HPO terms in search (broader phenotype matching)",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Max results to return",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},
	],
};
