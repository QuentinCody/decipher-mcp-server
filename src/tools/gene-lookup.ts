/**
 * decipher_gene_lookup — Look up comprehensive gene information from DECIPHER
 * by HGNC symbol. Returns HI/TS scores, constraint metrics, OMIM diseases,
 * G2P associations, GenCC classifications, and more.
 *
 * Stages large responses into Durable Object SQLite for SQL access.
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

interface GeneEnv {
	DECIPHER_DATA_DO: DurableObjectNamespace;
}

export function registerGeneLookup(server: McpServer, env: GeneEnv) {
	const register = (name: string) =>
		server.registerTool(
			name,
			{
				title: "Look Up Gene in DECIPHER",
				description:
					"Look up comprehensive gene information from DECIPHER by HGNC symbol. " +
					"Returns Ensembl IDs, genomic coordinates (GRCh38), haploinsufficiency (HI) score, " +
					"triplosensitivity (TS) score, pLI, LOEUF, missense Z-score, constraint metrics, " +
					"OMIM disease associations with inheritance patterns, ClinGen actionability reports, " +
					"GenCC classifications, ACMG secondary findings status, Gene2Phenotype (G2P) " +
					"associations, protein function, PDB structures, and PubMed references.\n\n" +
					"Also supports fetching G2P associations specifically via the include_g2p parameter.",
				inputSchema: {
					symbol: z
						.string()
						.min(1)
						.describe(
							"HGNC gene symbol (e.g. BRCA1, TP53, BRAF, SHANK3)",
						),
					include_g2p: z
						.boolean()
						.default(false)
						.optional()
						.describe(
							"If true, also fetches Gene2Phenotype (G2P) associations " +
							"from the separate /data/gene/{symbol}/g2p endpoint and merges them.",
						),
				},
			},
			async (args, extra) => {
				try {
					const symbol = String(args.symbol).trim().toUpperCase();
					if (!symbol) {
						return createCodeModeError(
							"INVALID_ARGUMENTS",
							"Gene symbol is required (e.g. BRCA1, TP53)",
						);
					}

					// Fetch gene data
					const response = await decipherFetch(
						`/data/gene/${encodeURIComponent(symbol)}`,
					);

					if (!response.ok) {
						if (response.status === 404) {
							return createCodeModeError(
								"NOT_FOUND",
								`Gene '${symbol}' not found in DECIPHER. Ensure you are using a valid HGNC symbol (e.g. BRCA1, TP53, BRAF).`,
							);
						}
						const body = await response.text().catch(() => "");
						return createCodeModeError(
							"API_ERROR",
							`DECIPHER API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
						);
					}

					const rawData = (await response.json()) as Record<string, unknown>;
					// DECIPHER wraps all responses in { content: { ... } } — unwrap it
					const geneData = (rawData.content ?? rawData) as Record<string, unknown>;

					// Optionally fetch G2P associations
					if (args.include_g2p) {
						try {
							const g2pResponse = await decipherFetch(
								`/data/gene/${encodeURIComponent(symbol)}/g2p`,
							);
							if (g2pResponse.ok) {
								const rawG2p = await g2pResponse.json();
								(geneData as any).g2p_detail = (rawG2p as any)?.content ?? rawG2p;
							}
						} catch {
							// G2P fetch failure is non-fatal
						}
					}

					const responseBytes = JSON.stringify(geneData).length;

					// Build a human-readable summary
					const hiScore =
						geneData.hi_score != null
							? String(geneData.hi_score)
							: "N/A";
					const pli =
						geneData.p_li != null ? String(geneData.p_li) : "N/A";
					const loeuf =
						geneData.loeuf != null
							? String(geneData.loeuf)
							: "N/A";
					const chr = geneData.chr || "unknown";
					const omimDiseases = Array.isArray(
						(geneData as any).omim_morbid_diseases,
					)
						? (geneData as any).omim_morbid_diseases.length
						: 0;

					const textSummary =
						`DECIPHER gene: ${symbol}\n` +
						`  Chromosome: ${chr}\n` +
						`  HI score: ${hiScore}, pLI: ${pli}, LOEUF: ${loeuf}\n` +
						`  OMIM diseases: ${omimDiseases}\n` +
						`  Response size: ${Math.round(responseBytes / 1024)}KB`;

					// Stage large responses
					if (shouldStage(responseBytes) && env.DECIPHER_DATA_DO) {
						const sessionId = (
							extra as { sessionId?: string }
						)?.sessionId;
						const stageResult = await stageToDoAndRespond(
							geneData,
							env.DECIPHER_DATA_DO,
							"decipher_gene",
							undefined,
							{
								toolName: name,
								serverName: "decipher",
								args: { symbol },
							},
							"decipher",
							sessionId,
						);

						const stagedResponse = {
							symbol,
							chr,
							hi_score: geneData.hi_score,
							p_li: geneData.p_li,
							loeuf: geneData.loeuf,
							omim_disease_count: omimDiseases,
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
					return createCodeModeResponse(geneData, {
						textSummary,
						meta: { fetched_at: new Date().toISOString() },
					});
				} catch (err) {
					const msg =
						err instanceof Error ? err.message : String(err);
					return createCodeModeError(
						"API_ERROR",
						`decipher_gene_lookup failed: ${msg}`,
					);
				}
			},
		);

	register("decipher_gene_lookup");
	register("mcp_decipher_gene_lookup");
}
