/**
 * DecipherDataDO — Durable Object for staging large responses.
 *
 * Extends RestStagingDO with schema hints for both data paths: the openly-
 * published mirrors this server reads by default (ClinGen dosage regions,
 * dbVar nstd183 CNV calls, Gene2Phenotype records) and DECIPHER's own /data/
 * shapes behind the DECIPHER_SEND_REFERER opt-in.
 */

import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class DecipherDataDO extends RestStagingDO {
	protected getSchemaHints(data: unknown): SchemaHints | undefined {
		if (!data || typeof data !== "object") return undefined;

		const obj = data as Record<string, unknown>;

		// /data/syndromes → { content: { "1": { syndrome_id, name, Variants }, "2": ... } }
		if (obj.content && typeof obj.content === "object" && !Array.isArray(obj.content)) {
			const contentObj = obj.content as Record<string, unknown>;
			const keys = Object.keys(contentObj);
			if (keys.length > 0) {
				const sample = contentObj[keys[0]] as Record<string, unknown> | undefined;
				if (sample && typeof sample === "object") {
					// Syndrome list entries
					if ("syndrome_id" in sample && "name" in sample) {
						return {
							tableName: "syndromes",
							indexes: ["syndrome_id", "name", "grade"],
						};
					}

					// Patient variant response: { content: { Variants: {...}, ... } }
					if ("Variants" in sample || "variant_class" in sample) {
						return {
							tableName: "variants",
							indexes: ["chr", "start", "end", "variant_class", "pathogenicity"],
						};
					}
				}
			}
		}

		// /data/patient/{id}/phenotypes → { Phenotypes: [...], HPOGraphPath: [...] }
		if (Array.isArray(obj.Phenotypes)) {
			return {
				tableName: "phenotypes",
				indexes: ["hpo_term_id", "person_id", "is_present"],
			};
		}

		// /data/patient/{id}/variants → { content: { Variants: {...}, ... } }
		if (obj.content && typeof obj.content === "object") {
			const content = obj.content as Record<string, unknown>;
			if (content.Variants || content.VariantDosageSensitivity) {
				return {
					tableName: "variants",
					indexes: ["chr", "start", "end", "variant_class"],
				};
			}
		}

		// /data/gene/{symbol} → large gene object with many nested fields
		if (
			obj.ensembl_gene_ensg &&
			obj.ensembl_hgnc_symbol &&
			("hi_score" in obj || "p_li" in obj)
		) {
			return {
				tableName: "genes",
				indexes: ["ensembl_hgnc_symbol", "chr", "hi_score", "p_li"],
			};
		}

		// /data/gene/{symbol}/g2p → { content: { g2p: [...] } }
		if (obj.content && typeof obj.content === "object") {
			const content = obj.content as Record<string, unknown>;
			if (Array.isArray(content.g2p)) {
				return {
					tableName: "g2p_associations",
					indexes: ["hgnc_symbol", "disease_name", "confidence", "allelic_requirement"],
				};
			}
		}

		// /data/syndrome/{id} → single syndrome with Genes array
		if (obj.syndrome_id && obj.name && (obj.Genes || obj.Variants)) {
			return {
				tableName: "syndrome_detail",
				indexes: ["syndrome_id", "name"],
				flatten: { Genes: 1, Variants: 1 },
			};
		}

		// Array fallback — check first element
		if (Array.isArray(data)) {
			const sample = data[0];
			if (!sample || typeof sample !== "object") return undefined;

			// ClinGen dosage-sensitivity regions (default syndromes path)
			if ("isca_id" in sample) {
				return {
					tableName: "clingen_regions",
					indexes: [
						"isca_id",
						"chr",
						"start",
						"haploinsufficiency_score",
						"triplosensitivity_score",
					],
				};
			}
			// dbVar nstd183 CNV calls (decipher_cnv_frequency)
			if ("variant_call_accession" in sample) {
				return {
					tableName: "cnv_calls",
					indexes: [
						"variant_call_accession",
						"chr",
						"start",
						"variant_call_type",
						"allele_frequency",
					],
				};
			}
			if ("syndrome_id" in sample) {
				return {
					tableName: "syndromes",
					indexes: ["syndrome_id", "name", "grade"],
				};
			}
			if ("hpo_term_id" in sample) {
				return {
					tableName: "phenotypes",
					indexes: ["hpo_term_id", "person_id", "is_present"],
				};
			}
			if ("ensembl_gene_ensg" in sample || "ensembl_hgnc_symbol" in sample) {
				return {
					tableName: "genes",
					indexes: ["ensembl_hgnc_symbol", "chr", "hi_score"],
				};
			}
		}

		return undefined;
	}
}
