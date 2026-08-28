/**
 * decipher_syndromes — recurrent CNV syndrome regions with genomic coordinates.
 *
 * Two data paths, chosen by DECIPHER_SEND_REFERER (see ../lib/http.ts):
 *
 *   OFF (default) — ClinGen's dosage-sensitivity region curation list: the
 *     openly-published recurrent CNV regions with GRCh38 coordinates and
 *     haploinsufficiency / triplosensitivity scores, evidence descriptions and
 *     PMIDs. Regions are identified by ISCA ID (e.g. ISCA-46755).
 *   ON — DECIPHER's own /data/syndromes and /data/syndrome/{id}, which need the
 *     same-origin Referer opt-in and use DECIPHER's numeric syndrome IDs.
 *
 * The full list is staged (ClinGen ~513 regions, DECIPHER ~96 syndromes).
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { type DecipherAccess, decipherFetch } from "../lib/http";
import {
	CLINGEN_REGION_TSV,
	type ClinGenRegion,
	fetchClinGenRegions,
} from "../lib/mirrors";
import {
	createCodeModeResponse,
	createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import {
	shouldStage,
	stageToDoAndRespond,
} from "@bio-mcp/shared/staging/utils";

interface SyndromeEnv {
	DECIPHER_DATA_DO: DurableObjectNamespace;
}

export function registerSyndromes(
	server: McpServer,
	env: SyndromeEnv,
	access: DecipherAccess,
): void {
	const register = (name: string) =>
		server.registerTool(
			name,
			{
				title: "Get CNV Syndrome Regions",
				description:
					"Get recurrent microdeletion/microduplication CNV syndrome regions.\n\n" +
					"Default source (no credential, no origin assertion): ClinGen's dosage-" +
					"sensitivity region curation list — ~513 recurrent regions with GRCh38 " +
					"coordinates, cytoband, haploinsufficiency and triplosensitivity scores, " +
					"the evidence description and its PMIDs. ClinGen's score codes: 0 no " +
					"evidence, 1 little, 2 some, 3 sufficient evidence for dosage pathogenicity, " +
					"30 associated with autosomal recessive phenotype, 40 dosage sensitivity " +
					"unlikely. Regions are identified by ISCA ID (e.g. ISCA-46755).\n\n" +
					"  - Without syndrome_id: returns every region (staged for SQL).\n" +
					"  - With syndrome_id: matches an ISCA ID, or any region whose name contains " +
					"the string (e.g. '22q11.2', 'Williams').\n\n" +
					"When the deployment sets DECIPHER_SEND_REFERER=1, this tool instead returns " +
					"DECIPHER's own ~96 syndromes, keyed by DECIPHER's numeric syndrome IDs " +
					"(1=Wolf-Hirschhorn, 14=Prader-Willi Type 1, 2=Cri du Chat, 15=Angelman).",
				inputSchema: {
					syndrome_id: z
						.string()
						.optional()
						.describe(
							"ClinGen ISCA ID or region-name substring (default path), or a " +
							"DECIPHER numeric syndrome ID when DECIPHER_SEND_REFERER=1. " +
							"If omitted, returns every region/syndrome.",
						),
				},
			},
			async (args, extra) => {
				try {
					const syndromeId = args.syndrome_id
						? String(args.syndrome_id).trim()
						: undefined;

					const fetched = access.sendReferer
						? await fetchFromDecipher(syndromeId, access)
						: await fetchFromClinGen(syndromeId);

					if ("error" in fetched) return fetched.error;

					const { data, stageData, source, textSummary, stageLabel } = fetched;
					const responseBytes = JSON.stringify(data).length;

					// Stage large responses
					if (shouldStage(responseBytes) && env.DECIPHER_DATA_DO) {
						const sessionId = (extra as Record<string, unknown>);
						const stageResult = await stageToDoAndRespond(
							stageData,
							env.DECIPHER_DATA_DO,
							stageLabel,
							undefined,
							{
								toolName: name,
								serverName: "decipher",
								args: syndromeId ? { syndrome_id: syndromeId } : {},
							},
							"decipher",
							sessionId,
						);

						const stagedResponse = {
							...(syndromeId ? { syndrome_id: syndromeId } : {}),
							source,
							staged: true,
							data_access_id: stageResult.dataAccessId,
							schema: stageResult.schema,
							tables_created: stageResult.tablesCreated,
							total_rows: stageResult.totalRows,
							message:
								`Response staged (${Math.round(responseBytes / 1024)}KB). ` +
								`Use 'decipher_query_data' with data_access_id '${stageResult.dataAccessId}' to query with SQL.`,
						};

						const result = createCodeModeResponse(stagedResponse, {
							textSummary:
								textSummary +
								`\nData staged as ${stageResult.dataAccessId}.`,
							meta: {
								staged: true,
								data_access_id: stageResult.dataAccessId,
								source,
							},
						});

						if (result.structuredContent) {
							(result.structuredContent as Record<string, unknown>)._staging =
								stageResult._staging;
						}

						return result;
					}

					// Inline response
					return createCodeModeResponse(data, {
						textSummary,
						meta: { fetched_at: new Date().toISOString(), source },
					});
				} catch (err) {
					const msg =
						err instanceof Error ? err.message : String(err);
					return createCodeModeError(
						"API_ERROR",
						`decipher_syndromes failed: ${msg}`,
					);
				}
			},
		);

	register("decipher_syndromes");
	register("mcp_decipher_syndromes");
}

type SyndromeFetch =
	| {
			data: unknown;
			stageData: unknown;
			source: Record<string, unknown>;
			textSummary: string;
			stageLabel: string;
	  }
	| { error: ReturnType<typeof createCodeModeError> };

/** Match an ISCA ID exactly (bare digits are accepted), else a name substring. */
function selectRegions(
	regions: ClinGenRegion[],
	query: string,
): ClinGenRegion[] {
	const wanted = /^\d+$/.test(query) ? `ISCA-${query}` : query;
	const exact = regions.filter(
		(r) => r.isca_id.toLowerCase() === wanted.toLowerCase(),
	);
	if (exact.length > 0) return exact;
	const needle = query.toLowerCase();
	return regions.filter((r) => r.name.toLowerCase().includes(needle));
}

/** Default path: ClinGen dosage-sensitivity region curation. */
async function fetchFromClinGen(
	syndromeId: string | undefined,
): Promise<SyndromeFetch> {
	const regions = await fetchClinGenRegions();
	const source = {
		id: "clingen-dosage",
		name: "ClinGen dosage sensitivity — region curation (GRCh38)",
		url: CLINGEN_REGION_TSV,
		why:
			"DECIPHER's own /data/syndromes endpoint enforces a same-origin Referer check; " +
			"ClinGen publishes the equivalent recurrent-CNV regions openly.",
	};

	if (!syndromeId) {
		return {
			data: { region_count: regions.length, regions, source },
			stageData: regions,
			source,
			textSummary:
				`ClinGen dosage-sensitivity regions: ${regions.length} recurrent CNV regions (GRCh38)\n` +
				"  Identify a region by its ISCA ID; each carries a haploinsufficiency and a " +
				"triplosensitivity score (0-3 evidence levels, 30 = autosomal recessive, 40 = unlikely).",
			stageLabel: "clingen_cnv_regions",
		};
	}

	const matches = selectRegions(regions, syndromeId);
	if (matches.length === 0) {
		return {
			error: createCodeModeError(
				"NOT_FOUND",
				`No ClinGen CNV region matches '${syndromeId}'. Use an ISCA ID (e.g. ISCA-46755) or a ` +
					"name substring (e.g. '22q11.2', 'Williams'), or call this tool with no argument " +
					"to list every region.",
			),
		};
	}

	const first = matches[0];
	return {
		data: { query: syndromeId, match_count: matches.length, regions: matches, source },
		stageData: matches,
		source,
		textSummary:
			`ClinGen CNV region match for '${syndromeId}': ${matches.length}\n` +
			`  ${first.isca_id} ${first.name} — ${first.genomic_location} (${first.cytoband})\n` +
			`  Haploinsufficiency: ${first.haploinsufficiency_score || "n/a"}, ` +
			`triplosensitivity: ${first.triplosensitivity_score || "n/a"}`,
		stageLabel: "clingen_cnv_regions",
	};
}

/** Opt-in path: DECIPHER's own syndrome list/detail. */
async function fetchFromDecipher(
	syndromeId: string | undefined,
	access: DecipherAccess,
): Promise<SyndromeFetch> {
	const path = syndromeId
		? `/data/syndrome/${encodeURIComponent(syndromeId)}`
		: "/data/syndromes";

	const response = await decipherFetch(path, undefined, { access });

	if (!response.ok) {
		if (response.status === 404) {
			return {
				error: createCodeModeError(
					"NOT_FOUND",
					syndromeId
						? `Syndrome ID '${syndromeId}' not found in DECIPHER. Use numeric IDs (e.g. 1=Wolf-Hirschhorn, 14=Prader-Willi Type 1).`
						: "DECIPHER syndromes endpoint not found.",
				),
			};
		}
		const body = await response.text().catch(() => "");
		return {
			error: createCodeModeError(
				"API_ERROR",
				`DECIPHER API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
			),
		};
	}

	const data = (await response.json()) as Record<string, unknown>;
	const responseBytes = JSON.stringify(data).length;
	const source = {
		id: "decipher",
		name: "DECIPHER",
		url: `https://www.deciphergenomics.org${path}`,
		access: "DECIPHER_SEND_REFERER opt-in (same-origin Referer sent)",
	};

	if (!syndromeId) {
		// All syndromes: data is { content: { "1": {...}, "2": {...}, ... } }
		const content = (data.content ?? data) as Record<string, unknown>;
		const syndromeCount =
			content && typeof content === "object" ? Object.keys(content).length : 0;
		return {
			data,
			stageData: Object.values(content),
			source,
			textSummary: `DECIPHER: ${syndromeCount} syndromes returned (${Math.round(responseBytes / 1024)}KB)`,
			stageLabel: "decipher_syndromes",
		};
	}

	// Single syndrome detail — unwrap .content wrapper
	const detail = (data.content ?? data) as Record<string, unknown>;
	const syndromeName = detail?.name || `Syndrome ${syndromeId}`;
	const geneCount = Array.isArray(detail?.Genes) ? detail.Genes.length : 0;
	const phenoCount = Array.isArray(detail?.Phenotypes)
		? detail.Phenotypes.length
		: 0;

	return {
		data,
		stageData: detail,
		source,
		textSummary:
			`DECIPHER syndrome ${syndromeId}: ${syndromeName}\n` +
			`  Genes: ${geneCount}, Phenotypes: ${phenoCount}\n` +
			`  Response size: ${Math.round(responseBytes / 1024)}KB`,
		stageLabel: `decipher_syndrome_${syndromeId}`,
	};
}
