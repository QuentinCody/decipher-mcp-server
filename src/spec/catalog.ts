/**
 * DECIPHER internal data API catalog — reverse-engineered from the
 * deciphergenomics.org Nuxt.js frontend's /data/ endpoints.
 *
 * IMPORTANT: DECIPHER does NOT have a documented public REST API.
 * The original "open-access API" at /ddd/openaccess/api does NOT exist.
 * These endpoints are the internal data layer used by the Nuxt SSR frontend.
 * They return JSON and are accessible without authentication for open-access data,
 * but they are undocumented and may change without notice.
 *
 * DECIPHER (Database of Chromosomal Imbalance and Phenotype in Humans Using
 * Ensembl Resources) provides genomic variant and clinical phenotype data
 * for rare disease research.
 *
 * Verified working endpoints (March 2026):
 *   /data/patient/{id}, /data/patient/{id}/phenotypes, /data/patient/{id}/variants,
 *   /data/gene/{symbol}, /data/gene/{symbol}/g2p,
 *   /data/syndromes, /data/syndrome/{id}
 */

import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const decipherCatalog: ApiCatalog = {
	name: "DECIPHER Internal Data",
	baseUrl: "https://www.deciphergenomics.org",
	version: "undocumented",
	auth: "none",
	endpointCount: 7,
	notes:
		"- DECIPHER does NOT have a documented public REST API — these are internal Nuxt.js data endpoints\n" +
		"- All endpoints are under /data/ and return JSON without authentication for open-access data\n" +
		"- These endpoints may change without notice — they are not officially supported\n" +
		"- Gene data uses GRCh38 coordinates; syndromes may have GRCh37 alternative_positions\n" +
		"- Patient IDs are numeric (e.g. 255882); only open-access consented patients are accessible\n" +
		"- Gene lookups use HGNC symbols (e.g. BRCA1, TP53)\n" +
		"- Syndrome IDs are numeric (e.g. 1 = Wolf-Hirschhorn, 14 = Prader-Willi Type 1)\n" +
		"- Gene endpoint includes HI/TS scores, pLI, LOEUF, constraint metrics, OMIM diseases, G2P, GenCC\n" +
		"- Phenotypes use HPO (Human Phenotype Ontology) term IDs (e.g. HP:0001250)\n" +
		"- Patient variant data includes CNV coordinates, mean_ratio, dosage sensitivity scores\n" +
		"- There is NO search endpoint — you must know the patient ID, gene symbol, or syndrome ID\n" +
		"- For bulk data access, DECIPHER provides file downloads at /about/downloads/data (not via API)",
	endpoints: [
		// === Patient ===
		{
			method: "GET",
			path: "/data/patient/{id}",
			summary:
				"Get open-access patient details including demographics (age, sex), family members, " +
				"project info, and counts of genotypes, phenotypes, and assessments. " +
				"Only open-access consented patients are accessible without login.",
			category: "patient",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "DECIPHER patient ID (numeric, e.g. 255882)",
				},
			],
		},
		{
			method: "GET",
			path: "/data/patient/{id}/phenotypes",
			summary:
				"Get all HPO phenotypes for a specific open-access patient. Returns phenotype records " +
				"with HPO term IDs, presence status, and HPO graph path mappings to top-level categories.",
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
			path: "/data/patient/{id}/variants",
			summary:
				"Get all variants (primarily CNVs) for a specific open-access patient. Returns variant " +
				"details including chromosome, start/end coordinates (GRCh38), variant class (duplication/deletion), " +
				"mean_ratio, genotype, inheritance, pathogenicity, and dosage sensitivity scores. " +
				"May include GRCh37 alternative_positions with liftover scores.",
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

		// === Gene ===
		{
			method: "GET",
			path: "/data/gene/{symbol}",
			summary:
				"Get comprehensive gene information by HGNC symbol. Returns Ensembl IDs, genomic " +
				"coordinates (GRCh38), HI score (haploinsufficiency 0-1), pLI, LOEUF, missense Z-score, " +
				"constraint metrics, OMIM disease associations with inheritance patterns, ClinGen " +
				"actionability reports, GenCC classifications, ACMG secondary findings status, " +
				"G2P associations, protein function, PDB structures, and PubMed references.",
			category: "gene",
			pathParams: [
				{
					name: "symbol",
					type: "string",
					required: true,
					description: "HGNC gene symbol (e.g. BRCA1, TP53, BRAF)",
				},
			],
		},
		{
			method: "GET",
			path: "/data/gene/{symbol}/g2p",
			summary:
				"Get Gene2Phenotype (G2P) associations for a gene. Returns disease-gene relationships " +
				"with confidence level (definitive/strong/moderate), allelic requirement " +
				"(monoallelic/biallelic), molecular mechanism (loss of function, gain of function), " +
				"variant consequences, and associated clinical panels (Cancer, DD, Skeletal, etc.).",
			category: "gene",
			pathParams: [
				{
					name: "symbol",
					type: "string",
					required: true,
					description: "HGNC gene symbol (e.g. BRCA1, TP53)",
				},
			],
		},

		// === Syndrome ===
		{
			method: "GET",
			path: "/data/syndromes",
			summary:
				"Get all known microdeletion/microduplication syndromes in DECIPHER. Returns ~96 " +
				"syndromes with their IDs, names, grades, draft status, and associated variants " +
				"(deletion/duplication with GRCh38 coordinates, genotype, copy number). " +
				"Variants may include GRCh37 alternative_positions with liftover scores.",
			category: "syndrome",
		},
		{
			method: "GET",
			path: "/data/syndrome/{id}",
			summary:
				"Get detailed information for a specific syndrome including name, description, " +
				"grade, associated genomic variants (deletions/duplications with coordinates), " +
				"affected genes (with Ensembl IDs, constraint scores, HI scores, disease associations), " +
				"phenotypes, mortality data, and links to patient support resources. " +
				"Example: id=1 is Wolf-Hirschhorn Syndrome, id=14 is Prader-Willi Type 1.",
			category: "syndrome",
			pathParams: [
				{
					name: "id",
					type: "string",
					required: true,
					description: "DECIPHER syndrome ID (numeric, e.g. 1, 14)",
				},
			],
		},
	],
};
