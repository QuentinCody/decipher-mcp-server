/**
 * decipher_patient — Look up an open-access DECIPHER patient by numeric ID.
 *
 * Returns patient demographics, phenotypes, and/or variants depending on
 * the requested scope. Only open-access consented patients are accessible
 * without DECIPHER login.
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

interface PatientEnv {
	DECIPHER_DATA_DO: DurableObjectNamespace;
}

export function registerPatient(server: McpServer, env: PatientEnv) {
	const register = (name: string) =>
		server.registerTool(
			name,
			{
				title: "Get DECIPHER Patient Data",
				description:
					"Look up an open-access DECIPHER patient by numeric ID. " +
					"Returns patient demographics (age, sex), family members, project info, " +
					"and counts of genotypes/phenotypes.\n\n" +
					"Use the 'include' parameter to also fetch phenotypes and/or variants:\n" +
					"  - 'phenotypes': HPO phenotype records with term IDs, names, and presence status\n" +
					"  - 'variants': CNV data with chromosome, coordinates (GRCh38), variant class, " +
					"pathogenicity, and dosage sensitivity scores\n" +
					"  - 'all': both phenotypes and variants\n\n" +
					"IMPORTANT: Only open-access consented patients are accessible. " +
					"Non-open-access patient IDs will return a 404 error. " +
					"Example open-access patient: 255882.\n\n" +
					"There is NO search endpoint — you must know the patient ID. " +
					"For bulk data, use DECIPHER file downloads at /about/downloads/data.",
				inputSchema: {
					patient_id: z
						.string()
						.min(1)
						.describe(
							"DECIPHER patient ID (numeric, e.g. 255882)",
						),
					include: z
						.enum(["demographics", "phenotypes", "variants", "all"])
						.default("demographics")
						.optional()
						.describe(
							"What data to include: 'demographics' (default) returns basic patient info, " +
							"'phenotypes' adds HPO terms, 'variants' adds CNV data, 'all' includes everything.",
						),
				},
			},
			async (args, extra) => {
				try {
					const patientId = String(args.patient_id).trim();
					if (!/^\d+$/.test(patientId)) {
						return createCodeModeError(
							"INVALID_ARGUMENTS",
							`Patient ID must be numeric (e.g. 255882), got: '${patientId}'`,
						);
					}

					const include = (args.include as string) || "demographics";

					// Fetch patient demographics (always)
					const patientResponse = await decipherFetch(
						`/data/patient/${encodeURIComponent(patientId)}`,
					);

					if (!patientResponse.ok) {
						if (patientResponse.status === 404) {
							return createCodeModeError(
								"NOT_FOUND",
								`Patient '${patientId}' not found in DECIPHER. ` +
								"Only open-access consented patients are accessible without login. " +
								"Non-open-access patients return 404.",
							);
						}
						if (patientResponse.status === 403) {
							return createCodeModeError(
								"API_ERROR",
								`Patient '${patientId}' requires DECIPHER login (not open-access).`,
							);
						}
						const body = await patientResponse
							.text()
							.catch(() => "");
						return createCodeModeError(
							"API_ERROR",
							`DECIPHER API error: HTTP ${patientResponse.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
						);
					}

					const rawPatient = (await patientResponse.json()) as Record<string, unknown>;
					// DECIPHER wraps all responses in { content: { ... } } — unwrap it
					const patientData = ((rawPatient as any)?.content ?? rawPatient) as Record<string, unknown>;

					// Optionally fetch phenotypes and/or variants in parallel
					const fetchPhenotypes =
						include === "phenotypes" || include === "all";
					const fetchVariants =
						include === "variants" || include === "all";

					const unwrapContent = (raw: unknown): unknown =>
						raw && typeof raw === "object" && "content" in (raw as Record<string, unknown>)
							? (raw as Record<string, unknown>).content
							: raw;

					const [phenoResult, variantResult] = await Promise.all([
						fetchPhenotypes
							? decipherFetch(
									`/data/patient/${encodeURIComponent(patientId)}/phenotypes`,
								)
									.then(async (r) =>
										r.ok ? unwrapContent(await r.json()) : null,
									)
									.catch(() => null)
							: Promise.resolve(null),
						fetchVariants
							? decipherFetch(
									`/data/patient/${encodeURIComponent(patientId)}/variants`,
								)
									.then(async (r) =>
										r.ok ? unwrapContent(await r.json()) : null,
									)
									.catch(() => null)
							: Promise.resolve(null),
					]);

					// Merge results
					const result: Record<string, unknown> = {
						patient: patientData,
					};

					if (phenoResult) {
						result.phenotypes = phenoResult;
					}
					if (variantResult) {
						result.variants = variantResult;
					}

					const responseBytes = JSON.stringify(result).length;

					// Build text summary
					const age = (patientData as any)?.age?.years ?? (patientData as any)?.age_years ?? "unknown";
					const sex =
						(patientData as any)?.chromosomal_sex ?? "unknown";
					const phenoCount = phenoResult
						? Object.keys(
								(phenoResult as any)?.Phenotypes || {},
							).length
						: (patientData as any)?.counts?.phenotypes ?? "?";
					const variantCount = variantResult
						? Object.keys(
								(variantResult as any)?.Variants || {},
							).length
						: (patientData as any)?.counts?.genotype ?? "?";

					const textSummary =
						`DECIPHER patient ${patientId}: age ${age}y, sex ${sex}\n` +
						`  Phenotypes: ${phenoCount}, Variants: ${variantCount}\n` +
						`  Data included: ${include}\n` +
						`  Response size: ${Math.round(responseBytes / 1024)}KB`;

					// Stage large responses
					if (shouldStage(responseBytes) && env.DECIPHER_DATA_DO) {
						const sessionId = (
							extra as { sessionId?: string }
						)?.sessionId;
						const stageResult = await stageToDoAndRespond(
							result,
							env.DECIPHER_DATA_DO,
							`decipher_patient_${patientId}`,
							undefined,
							{
								toolName: name,
								serverName: "decipher",
								args: {
									patient_id: patientId,
									include,
								},
							},
							"decipher",
							sessionId,
						);

						const stagedResponse = {
							patient_id: patientId,
							age_years: age,
							chromosomal_sex: sex,
							phenotype_count: phenoCount,
							variant_count: variantCount,
							staged: true,
							data_access_id: stageResult.dataAccessId,
							schema: stageResult.schema,
							tables_created: stageResult.tablesCreated,
							total_rows: stageResult.totalRows,
							message:
								`Response staged (${Math.round(responseBytes / 1024)}KB). ` +
								`Use 'decipher_query_data' with data_access_id '${stageResult.dataAccessId}' to query with SQL.`,
						};

						const stageResponse = createCodeModeResponse(
							stagedResponse,
							{
								textSummary:
									textSummary +
									`\nData staged as ${stageResult.dataAccessId}.`,
								meta: {
									staged: true,
									data_access_id:
										stageResult.dataAccessId,
								},
							},
						);

						if (stageResponse.structuredContent) {
							(stageResponse.structuredContent as any)._staging =
								stageResult._staging;
						}

						return stageResponse;
					}

					// Inline response
					return createCodeModeResponse(result, {
						textSummary,
						meta: { fetched_at: new Date().toISOString() },
					});
				} catch (err) {
					const msg =
						err instanceof Error ? err.message : String(err);
					return createCodeModeError(
						"API_ERROR",
						`decipher_patient failed: ${msg}`,
					);
				}
			},
		);

	register("decipher_patient");
	register("mcp_decipher_patient");
}
