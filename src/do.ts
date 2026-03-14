/**
 * DecipherDataDO — Durable Object for staging large DECIPHER responses.
 *
 * Extends RestStagingDO with patient, CNV, and syndrome-specific schema hints.
 */

import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class DecipherDataDO extends RestStagingDO {
	protected getSchemaHints(data: unknown): SchemaHints | undefined {
		if (!data || typeof data !== "object") return undefined;

		// Array of patient records
		if (Array.isArray(data)) {
			const sample = data[0];
			if (!sample || typeof sample !== "object") return undefined;

			// Patient records — have phenotypes and/or CNVs
			if ("patient_id" in sample || ("sex" in sample && "phenotypes" in sample)) {
				return {
					tableName: "patients",
					indexes: ["patient_id", "sex", "phenotypes"],
					flatten: { cnvs: 1, phenotypes: 1 },
				};
			}

			// CNV records — have chr, start, end, mean_ratio
			if ("chr" in sample && "start" in sample && "end" in sample) {
				return {
					tableName: "cnvs",
					indexes: ["chr", "start", "end", "type", "pathogenicity"],
				};
			}

			// Syndrome records — have name and genomic coordinates
			if ("syndrome_name" in sample || ("name" in sample && "chr" in sample)) {
				return {
					tableName: "syndromes",
					indexes: ["name", "chr", "syndrome_id"],
				};
			}

			// HI/TS prediction records
			if ("hi_score" in sample || "ts_score" in sample || "haploinsufficiency" in sample) {
				return {
					tableName: "predictions",
					indexes: ["gene", "hi_score", "ts_score"],
				};
			}

			// Population CNV records
			if ("population_cnv_id" in sample || "frequency" in sample) {
				return {
					tableName: "population_cnvs",
					indexes: ["chr", "start", "end", "frequency"],
				};
			}
		}

		// Wrapped responses (e.g. { results: [...] })
		const obj = data as Record<string, unknown>;

		if (Array.isArray(obj.results)) {
			const sample = obj.results[0];
			if (sample && typeof sample === "object") {
				if ("patient_id" in sample || ("sex" in sample && "phenotypes" in sample)) {
					return {
						tableName: "patients",
						indexes: ["patient_id", "sex", "phenotypes"],
						flatten: { cnvs: 1, phenotypes: 1 },
					};
				}
				if ("chr" in sample && "start" in sample && "end" in sample) {
					return {
						tableName: "cnvs",
						indexes: ["chr", "start", "end", "type", "pathogenicity"],
					};
				}
			}
		}

		if (Array.isArray(obj.patients)) {
			return {
				tableName: "patients",
				indexes: ["patient_id", "sex", "phenotypes"],
				flatten: { cnvs: 1, phenotypes: 1 },
			};
		}

		if (Array.isArray(obj.cnvs)) {
			return {
				tableName: "cnvs",
				indexes: ["chr", "start", "end", "type", "pathogenicity"],
			};
		}

		if (Array.isArray(obj.syndromes)) {
			return {
				tableName: "syndromes",
				indexes: ["name", "chr", "syndrome_id"],
			};
		}

		return undefined;
	}
}
