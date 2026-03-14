/**
 * decipher_syndromes — List all DECIPHER CNV syndromes or get details for one.
 *
 * Two modes:
 *   - No ID: fetches all ~96 syndromes from /data/syndromes
 *   - With ID: fetches detailed syndrome info from /data/syndrome/{id}
 *
 * The full syndrome list is always staged (typically ~80KB+).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { decipherFetch } from "../lib/http";
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

export function registerSyndromes(server: McpServer, env: SyndromeEnv) {
	const register = (name: string) =>
		server.registerTool(
			name,
			{
				title: "Get DECIPHER Syndromes",
				description:
					"Get DECIPHER microdeletion/microduplication CNV syndromes.\n\n" +
					"Two modes:\n" +
					"  - Without syndrome_id: returns all ~96 syndromes with IDs, names, grades, " +
					"and associated genomic variants (deletions/duplications with GRCh38 coordinates).\n" +
					"  - With syndrome_id: returns detailed info for one syndrome including name, " +
					"description, associated genes (with Ensembl IDs, constraint scores, HI scores), " +
					"phenotypes, mortality data, and patient support links.\n\n" +
					"Well-known syndromes: 1=Wolf-Hirschhorn, 14=Prader-Willi Type 1, " +
					"2=Cri du Chat, 15=Angelman, 3=Williams-Beuren.",
				inputSchema: {
					syndrome_id: z
						.string()
						.optional()
						.describe(
							"DECIPHER syndrome ID (numeric, e.g. 1, 14). " +
							"If omitted, returns all syndromes.",
						),
				},
			},
			async (args, extra) => {
				try {
					const syndromeId = args.syndrome_id
						? String(args.syndrome_id).trim()
						: undefined;

					let path: string;
					let label: string;

					if (syndromeId) {
						path = `/data/syndrome/${encodeURIComponent(syndromeId)}`;
						label = `syndrome ${syndromeId}`;
					} else {
						path = "/data/syndromes";
						label = "all syndromes";
					}

					const response = await decipherFetch(path);

					if (!response.ok) {
						if (response.status === 404) {
							return createCodeModeError(
								"NOT_FOUND",
								syndromeId
									? `Syndrome ID '${syndromeId}' not found in DECIPHER. Use numeric IDs (e.g. 1=Wolf-Hirschhorn, 14=Prader-Willi Type 1).`
									: "DECIPHER syndromes endpoint not found.",
							);
						}
						const body = await response.text().catch(() => "");
						return createCodeModeError(
							"API_ERROR",
							`DECIPHER API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
						);
					}

					const data = await response.json();
					const responseBytes = JSON.stringify(data).length;

					// For all syndromes, count them
					let syndromeCount = 0;
					let textSummary: string;

					if (!syndromeId) {
						// All syndromes: data is { content: { "1": {...}, "2": {...}, ... } }
						const content =
							data && typeof data === "object" && (data as any).content
								? (data as any).content
								: data;
						if (content && typeof content === "object") {
							syndromeCount = Object.keys(content).length;
						}
						textSummary = `DECIPHER: ${syndromeCount} syndromes returned (${Math.round(responseBytes / 1024)}KB)`;
					} else {
						// Single syndrome detail — unwrap .content wrapper
						const detail = (data as any)?.content ?? data;
						const syndromeName =
							detail?.name || `Syndrome ${syndromeId}`;
						const geneCount = Array.isArray(detail?.Genes)
							? detail.Genes.length
							: 0;
						const phenoCount = Array.isArray(detail?.Phenotypes)
							? detail.Phenotypes.length
							: 0;
						textSummary =
							`DECIPHER syndrome ${syndromeId}: ${syndromeName}\n` +
							`  Genes: ${geneCount}, Phenotypes: ${phenoCount}\n` +
							`  Response size: ${Math.round(responseBytes / 1024)}KB`;
					}

					// Stage large responses
					if (shouldStage(responseBytes) && env.DECIPHER_DATA_DO) {
						const sessionId = (
							extra as { sessionId?: string }
						)?.sessionId;

						// Unwrap .content wrapper and flatten keyed objects into arrays
						let stageData: unknown = (data as any)?.content ?? data;
						if (
							!syndromeId &&
							stageData &&
							typeof stageData === "object" &&
							!Array.isArray(stageData)
						) {
							stageData = Object.values(stageData as Record<string, unknown>);
						}

						const stageResult = await stageToDoAndRespond(
							stageData,
							env.DECIPHER_DATA_DO,
							syndromeId
								? `decipher_syndrome_${syndromeId}`
								: "decipher_syndromes",
							undefined,
							{
								toolName: name,
								serverName: "decipher",
								args: syndromeId
									? { syndrome_id: syndromeId }
									: {},
							},
							"decipher",
							sessionId,
						);

						const stagedResponse = {
							...(syndromeId
								? { syndrome_id: syndromeId }
								: { syndrome_count: syndromeCount }),
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
							},
						});

						if (result.structuredContent) {
							(result.structuredContent as any)._staging =
								stageResult._staging;
						}

						return result;
					}

					// Inline response
					return createCodeModeResponse(data, {
						textSummary,
						meta: { fetched_at: new Date().toISOString() },
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
