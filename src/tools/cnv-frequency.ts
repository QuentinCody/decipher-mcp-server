/**
 * decipher_cnv_frequency — population CNV frequency for a genomic region.
 *
 * Reads DECIPHER's OWN consensus CNV set as DECIPHER deposited it for public
 * redistribution: dbVar study nstd183, "DECIPHER Consensus CNVs" (~67k calls,
 * GRCh38). Keyless, published by NCBI, and it carries the allele counts and
 * frequencies (AC / AF / AN) that the retired patient surface used to expose
 * one patient at a time.
 *
 * dbVar publishes no region query for a study file, so the study TSV is
 * streamed and filtered (see ../lib/mirrors.ts).
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { DBVAR_NSTD183_CALLS, fetchDbVarCnvCalls } from "../lib/mirrors";
import {
	createCodeModeResponse,
	createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import {
	shouldStage,
	stageToDoAndRespond,
} from "@bio-mcp/shared/staging/utils";

interface CnvEnv {
	DECIPHER_DATA_DO: DurableObjectNamespace;
}

export function registerCnvFrequency(server: McpServer, env: CnvEnv): void {
	const register = (name: string) =>
		server.registerTool(
			name,
			{
				title: "DECIPHER Consensus CNV Frequency",
				description:
					"Get population CNV frequency for a genomic region from DECIPHER's consensus " +
					"CNV set, as deposited at NCBI dbVar (study nstd183, GRCh38).\n\n" +
					"Returns every copy-number call overlapping the region with its accession, " +
					"type (deletion/duplication), coordinates, and allele count / allele frequency / " +
					"allele number (AC/AF/AN). Filter by variant_type and min_allele_frequency.\n\n" +
					"Coordinates are GRCh38, 1-based, chromosome without the 'chr' prefix " +
					"(e.g. chr='22', start=18900000, end=21500000 for the 22q11.2 region).",
				inputSchema: {
					chr: z
						.string()
						.min(1)
						.describe("Chromosome without prefix (e.g. '1', '22', 'X')"),
					start: z
						.number()
						.int()
						.min(1)
						.describe("Region start, GRCh38, 1-based"),
					end: z
						.number()
						.int()
						.min(1)
						.describe("Region end, GRCh38, 1-based"),
					variant_type: z
						.string()
						.optional()
						.describe(
							"Keep only this call type, e.g. 'deletion' or 'duplication'",
						),
					min_allele_frequency: z
						.number()
						.min(0)
						.max(1)
						.optional()
						.describe("Keep only calls with allele frequency >= this value"),
					limit: z
						.number()
						.int()
						.min(1)
						.max(2000)
						.default(200)
						.optional()
						.describe("Maximum calls to return (default 200)"),
				},
			},
			async (args, extra) => {
				try {
					const chr = String(args.chr).trim().replace(/^chr/i, "");
					const start = Number(args.start);
					const end = Number(args.end);

					if (!chr || !Number.isFinite(start) || !Number.isFinite(end)) {
						return createCodeModeError(
							"INVALID_ARGUMENTS",
							"chr, start and end are required (e.g. chr='22', start=18900000, end=21500000)",
						);
					}
					if (end < start) {
						return createCodeModeError(
							"INVALID_ARGUMENTS",
							`Region end (${end}) must be >= start (${start}).`,
						);
					}

					const result = await fetchDbVarCnvCalls({
						chr,
						start,
						end,
						variantType: args.variant_type
							? String(args.variant_type).trim()
							: undefined,
						minAlleleFrequency:
							args.min_allele_frequency === undefined
								? undefined
								: Number(args.min_allele_frequency),
						limit: args.limit ? Number(args.limit) : undefined,
					});

					const source = {
						id: "dbvar-nstd183",
						name: "NCBI dbVar nstd183 — DECIPHER Consensus CNVs (GRCh38)",
						url: DBVAR_NSTD183_CALLS,
						why:
							"DECIPHER's own CNV set, deposited at dbVar for public redistribution; " +
							"DECIPHER's /data/ endpoints enforce a same-origin Referer check.",
					};

					const deletions = result.calls.filter(
						(c) => c.variant_call_type === "deletion",
					).length;
					const duplications = result.calls.filter(
						(c) => c.variant_call_type === "duplication",
					).length;

					const payload = {
						query: {
							chr,
							start,
							end,
							variant_type: args.variant_type ?? null,
							min_allele_frequency: args.min_allele_frequency ?? null,
						},
						matched: result.matched,
						returned: result.calls.length,
						truncated: result.truncated,
						scanned: result.scanned,
						calls: result.calls,
						source,
					};

					const textSummary =
						`dbVar nstd183 (DECIPHER Consensus CNVs) — chr${chr}:${start}-${end} (GRCh38)\n` +
						`  Calls overlapping region: ${result.matched} (returned ${result.calls.length}${result.truncated ? ", truncated" : ""})\n` +
						`  Returned deletions: ${deletions}, duplications: ${duplications}\n` +
						`  Study rows scanned: ${result.scanned}`;

					const responseBytes = JSON.stringify(payload).length;

					if (shouldStage(responseBytes) && env.DECIPHER_DATA_DO) {
						const sessionId = (extra as Record<string, unknown>);
						const stageResult = await stageToDoAndRespond(
							result.calls,
							env.DECIPHER_DATA_DO,
							"dbvar_nstd183_cnv_calls",
							undefined,
							{
								toolName: name,
								serverName: "decipher",
								args: { chr, start, end },
							},
							"decipher",
							sessionId,
						);

						const stagedResponse = {
							query: payload.query,
							matched: result.matched,
							returned: result.calls.length,
							truncated: result.truncated,
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

						const staged = createCodeModeResponse(stagedResponse, {
							textSummary:
								textSummary +
								`\nData staged as ${stageResult.dataAccessId}.`,
							meta: {
								staged: true,
								data_access_id: stageResult.dataAccessId,
								source,
							},
						});

						if (staged.structuredContent) {
							(staged.structuredContent as Record<string, unknown>)._staging =
								stageResult._staging;
						}

						return staged;
					}

					return createCodeModeResponse(payload, {
						textSummary,
						meta: { fetched_at: new Date().toISOString(), source },
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return createCodeModeError(
						"API_ERROR",
						`decipher_cnv_frequency failed: ${msg}`,
					);
				}
			},
		);

	register("decipher_cnv_frequency");
	register("mcp_decipher_cnv_frequency");
}
