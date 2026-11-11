import { decipherResponse } from "../lib/tool-result";
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
} from "@bio-mcp/shared/codemode/response";


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
					"Returns a bounded page of copy-number placements overlapping the selected sequence with its accession, " +
					"type (deletion/duplication), coordinates, and allele count / allele frequency / " +
					"allele number (AC/AF/AN). Filter by variant_type and min_allele_frequency.\n\n" +
					"Coordinates are GRCh38, 1-based, chromosome without the 'chr' prefix " +
					"(e.g. chr='22', start=18900000, end=21500000 for the 22q11.2 region).",
				inputSchema: {
          contig: z.string().optional().describe("Exact alternate contig accession; omitted means primary chromosome coordinates only"),
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
						.optional()
						.describe("Maximum calls to return (default 200)"),
				},
			},
      async (args, extra) => decipherResponse(async () => {
        const result = await fetchDbVarCnvCalls({ chr: args.chr, contig: args.contig, start: args.start, end: args.end,
          variantType: args.variant_type, minAlleleFrequency: args.min_allele_frequency, limit: args.limit });
        const source = { id: "dbvar-nstd183", name: "NCBI dbVar nstd183 — DECIPHER Consensus CNV control set", url: DBVAR_NSTD183_CALLS };
        return createCodeModeResponse({ ...result, returned: result.calls.length, source }, {
          textSummary: `dbVar nstd183: ${result.matched} matching placement rows; ${result.calls.length} returned${result.truncated ? " (truncated)" : ""}. Coordinates refer to ${args.contig ?? "the primary chromosome"}; allele denominators remain study-specific.`, meta: { source },
        });
      }, env, name, extra, args),
		);

	register("decipher_cnv_frequency");
	register("mcp_decipher_cnv_frequency");
}
