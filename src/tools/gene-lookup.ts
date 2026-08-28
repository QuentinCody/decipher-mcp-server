/**
 * decipher_gene_lookup — gene-level rare-disease evidence for one HGNC symbol.
 *
 * Two data paths, chosen by DECIPHER_SEND_REFERER (see ../lib/http.ts):
 *
 *   OFF (default) — EBI Gene2Phenotype, the openly-published source of the
 *     g2p / G2PAssociations block DECIPHER itself surfaces: locus, HGNC/
 *     Ensembl/OMIM ids, synonyms, and the curated disease records with
 *     confidence, allelic requirement and molecular mechanism.
 *   ON — DECIPHER's own /data/gene/{symbol} composite (hi_score, pLI, LOEUF,
 *     OMIM morbid diseases, GenCC, ClinGen), which needs the same-origin
 *     Referer opt-in.
 *
 * Whichever path runs, the response names the upstream it actually came from.
 * Stages large responses into Durable Object SQLite for SQL access.
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { buildG2pGeneView } from "../lib/g2p-view";
import { type DecipherAccess, decipherFetch } from "../lib/http";
import { fetchG2pGene } from "../lib/mirrors";
import { createCodeModeResponse, createCodeModeError } from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface GeneEnv {
	DECIPHER_DATA_DO: DurableObjectNamespace;
}

export function registerGeneLookup(server: McpServer, env: GeneEnv, access: DecipherAccess): void {
	const register = (name: string) =>
		server.registerTool(
			name,
			{
				title: "Look Up Gene in DECIPHER",
				description:
					"Look up gene-level rare-disease evidence by HGNC symbol.\n\n" +
					"Default source (no credential, no origin assertion): EBI Gene2Phenotype — " +
					"the openly-published gene-to-phenotype curation DECIPHER surfaces as its " +
					"G2PAssociations block. Returns the GRCh38 locus, HGNC/Ensembl/OMIM ids, " +
					"synonyms, and one record per curated disease with confidence " +
					"(definitive/strong/moderate/limited), allelic requirement " +
					"(monoallelic/biallelic), molecular mechanism, variant consequences and panels.\n\n" +
					"When the deployment sets DECIPHER_SEND_REFERER=1, this tool instead returns " +
					"DECIPHER's own composite record: haploinsufficiency (HI) score, pLI, LOEUF, " +
					"missense Z-score, OMIM morbid diseases, ClinGen actionability, GenCC and ACMG " +
					"secondary-findings status. Those DECIPHER-specific scores have no open mirror.\n\n" +
					"The response always names the upstream it came from in `source`.",
				inputSchema: {
					symbol: z
						.string()
						.min(1)
						.describe("HGNC gene symbol (e.g. BRCA1, TP53, BRAF, SHANK3)"),
					include_g2p: z
						.boolean()
						.default(false)
						.optional()
						.describe(
							"DECIPHER path only: also fetch /data/gene/{symbol}/g2p and merge it. " +
								"Ignored on the default Gene2Phenotype path, where the curated " +
								"disease records are already the payload.",
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

					const fetched = access.sendReferer
						? await fetchFromDecipher(symbol, Boolean(args.include_g2p), access)
						: await fetchFromGene2Phenotype(symbol);

					if ("error" in fetched) return fetched.error;

					const { geneData, source, textSummary } = fetched;
					const responseBytes = JSON.stringify(geneData).length;

					// Stage large responses
					if (shouldStage(responseBytes) && env.DECIPHER_DATA_DO) {
						const sessionId = extra as Record<string, unknown>;
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
								textSummary + `\nData staged as ${stageResult.dataAccessId}.`,
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
					return createCodeModeResponse(geneData, {
						textSummary,
						meta: { fetched_at: new Date().toISOString(), source },
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return createCodeModeError("API_ERROR", `decipher_gene_lookup failed: ${msg}`);
				}
			},
		);

	register("decipher_gene_lookup");
	register("mcp_decipher_gene_lookup");
}

type GeneFetch =
	| {
			geneData: Record<string, unknown>;
			source: Record<string, unknown>;
			textSummary: string;
	  }
	| { error: ReturnType<typeof createCodeModeError> };

/** Default path: EBI Gene2Phenotype, keyless and openly published. */
async function fetchFromGene2Phenotype(symbol: string): Promise<GeneFetch> {
	const result = await fetchG2pGene(symbol);

	if (!result.found || !result.gene) {
		if (result.status === 404) {
			return {
				error: createCodeModeError(
					"NOT_FOUND",
					`Gene '${symbol}' has no Gene2Phenotype record. Ensure you are using a valid HGNC symbol (e.g. BRCA1, TP53, BRAF). ` +
						"Note: G2P curates rare-disease genes, so a valid symbol with no curated disease record also returns 404.",
				),
			};
		}
		return {
			error: createCodeModeError(
				"API_ERROR",
				`Gene2Phenotype error: HTTP ${result.status}${result.error ? ` - ${result.error}` : ""}`,
			),
		};
	}

	return buildG2pGeneView(symbol, result.gene);
}

/** Opt-in path: DECIPHER's own composite gene record. */
async function fetchFromDecipher(
	symbol: string,
	includeG2p: boolean,
	access: DecipherAccess,
): Promise<GeneFetch> {
	const response = await decipherFetch(`/data/gene/${encodeURIComponent(symbol)}`, undefined, {
		access,
	});

	if (!response.ok) {
		if (response.status === 404) {
			return {
				error: createCodeModeError(
					"NOT_FOUND",
					`Gene '${symbol}' not found in DECIPHER. Ensure you are using a valid HGNC symbol (e.g. BRCA1, TP53, BRAF).`,
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

	const rawData = (await response.json()) as Record<string, unknown>;
	// DECIPHER wraps all responses in { content: { ... } } — unwrap it
	const geneData = (rawData.content ?? rawData) as Record<string, unknown>;

	if (includeG2p) {
		try {
			const g2pResponse = await decipherFetch(
				`/data/gene/${encodeURIComponent(symbol)}/g2p`,
				undefined,
				{ access },
			);
			if (g2pResponse.ok) {
				const rawG2p = await g2pResponse.json();
				geneData.g2p_detail = (rawG2p as Record<string, unknown>)?.content ?? rawG2p;
			}
		} catch {
			// G2P fetch failure is non-fatal
		}
	}

	const source = {
		id: "decipher",
		name: "DECIPHER",
		url: `https://www.deciphergenomics.org/data/gene/${encodeURIComponent(symbol)}`,
		access: "DECIPHER_SEND_REFERER opt-in (same-origin Referer sent)",
	};
	geneData.source = source;

	const hiScore = geneData.hi_score != null ? String(geneData.hi_score) : "N/A";
	const pli = geneData.p_li != null ? String(geneData.p_li) : "N/A";
	const loeuf = geneData.loeuf != null ? String(geneData.loeuf) : "N/A";
	const chr = geneData.chr || "unknown";
	const omimMorbid = geneData.omim_morbid_diseases;
	const omimDiseases = Array.isArray(omimMorbid) ? omimMorbid.length : 0;

	const textSummary =
		`DECIPHER gene: ${symbol}\n` +
		`  Chromosome: ${chr}\n` +
		`  HI score: ${hiScore}, pLI: ${pli}, LOEUF: ${loeuf}\n` +
		`  OMIM diseases: ${omimDiseases}\n` +
		`  Response size: ${Math.round(JSON.stringify(geneData).length / 1024)}KB`;

	return { geneData, source, textSummary };
}
