/**
 * decipher_patient — RETIRED. Returns NOT_SUPPORTED without contacting DECIPHER.
 *
 * The three /data/patient/* endpoints this tool used are off limits, and that
 * is independent of whether they answer:
 *
 *   - https://www.deciphergenomics.org/robots.txt disallows /patient/ and
 *     /data/patient/.
 *   - DECIPHER's Terms of Use, clause 5: "No attempt should be made to copy
 *     patient data from the website. Access to DECIPHER patient data in bulk
 *     may be obtained from DECIPHER and is subject to a Data Access Agreement
 *     or a Data Display Agreement."
 *
 * A live probe DOES return 200 for an open-access patient once a same-origin
 * Referer is sent. That is exactly why this tool is a hard stop in code rather
 * than a flag: the DECIPHER_SEND_REFERER opt-in must not silently re-open a
 * surface the Terms of Use forbid. Patient access goes through the Data Access
 * Agreement, not through this server.
 *
 * The tool is kept registered — rather than deleted — so callers get this
 * explanation instead of an "unknown tool" error, and so the removal is
 * legible to any client that already knows the name.
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { createCodeModeError } from "@bio-mcp/shared/codemode/response";

// /about/downloads/data — the page that describes the Data Access Agreement —
// sits behind the SAME same-origin Referer gate as /data/*: it answers 403
// {"error":"Access Denied"} to a plain request and 200 with a deciphergenomics
// Referer (verified 2026-08-27). Handing a caller a URL they cannot open would
// make the refusal message useless, so point at the parent page, which answers
// 200 with no Referer.
const DATA_ACCESS_URL = "https://www.deciphergenomics.org/about/downloads";
const DATA_ACCESS_CONTACT = "contact@deciphergenomics.org";
const TERMS_URL =
	"https://www.deciphergenomics.org/files/pdfs/DECIPHER_Terms_of_Use.pdf";

const NOT_SUPPORTED_MESSAGE =
	"DECIPHER patient records are not served by this server. " +
	"DECIPHER's robots.txt disallows /data/patient/ and Terms of Use clause 5 states: " +
	'"No attempt should be made to copy patient data from the website. Access to DECIPHER ' +
	"patient data in bulk may be obtained from DECIPHER and is subject to a Data Access " +
	'Agreement or a Data Display Agreement." ' +
	`Request access under that agreement (${DATA_ACCESS_URL} or ${DATA_ACCESS_CONTACT}; ` +
	`terms: ${TERMS_URL}). ` +
	"For population CNV frequency in a region, use 'decipher_cnv_frequency', which reads " +
	"DECIPHER's own consensus CNV set as deposited for public redistribution at dbVar " +
	"(nstd183). For gene-level and CNV-region evidence, use 'decipher_gene_lookup' and " +
	"'decipher_syndromes'.";

export function registerPatient(server: McpServer): void {
	const register = (name: string) =>
		server.registerTool(
			name,
			{
				title: "Get DECIPHER Patient Data (retired)",
				description:
					"RETIRED — always returns NOT_SUPPORTED and makes no upstream request.\n\n" +
					"DECIPHER patient records are excluded on purpose: robots.txt disallows " +
					"/data/patient/ and Terms of Use clause 5 forbids copying patient data from " +
					"the website. Bulk patient access requires a DECIPHER Data Access Agreement.\n\n" +
					"Use 'decipher_cnv_frequency' for population CNV frequency (dbVar nstd183, " +
					"DECIPHER's own consensus CNVs), 'decipher_syndromes' for recurrent CNV " +
					"regions, and 'decipher_gene_lookup' for gene-level evidence.",
				inputSchema: {
					patient_id: z
						.string()
						.optional()
						.describe("Accepted but ignored — this tool no longer fetches patient data."),
					include: z
						.enum(["demographics", "phenotypes", "variants", "all"])
						.optional()
						.describe("Accepted but ignored — this tool no longer fetches patient data."),
				},
			},
			async () =>
				createCodeModeError("NOT_SUPPORTED", NOT_SUPPORTED_MESSAGE, {
					robots_txt: "https://www.deciphergenomics.org/robots.txt",
					terms_of_use: TERMS_URL,
					data_access_agreement: DATA_ACCESS_URL,
					alternatives: [
						"decipher_cnv_frequency",
						"decipher_syndromes",
						"decipher_gene_lookup",
					],
				}),
		);

	register("decipher_patient");
	register("mcp_decipher_patient");
}
