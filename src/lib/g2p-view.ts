/**
 * Render one EBI Gene2Phenotype gene record as this server's gene-lookup
 * payload.
 *
 * It lives apart from the tool so the one rule that matters here is testable
 * without an MCP harness: a FAILED curated-record fetch must never leave this
 * function looking like a gene G2P curates nothing for. The records arrive from
 * a second endpoint (see fetchG2pGene), and when that call fails the payload
 * carries `g2p_records: null`, `record_count: null` and
 * `g2p_records_unavailable: true` — never `[]` and `0`.
 */

import { G2P_BASE, type G2pGeneRecord } from "./mirrors";

export const REFERER_HINT =
	"DECIPHER's own /data/ endpoints enforce a same-origin Referer check and " +
	"return 403 Access Denied without it. This server does not assert an origin " +
	"it does not have unless the operator opts in with DECIPHER_SEND_REFERER=1.";

export interface G2pGeneView {
	geneData: Record<string, unknown>;
	source: Record<string, unknown>;
	textSummary: string;
}

export function buildG2pGeneView(symbol: string, gene: G2pGeneRecord): G2pGeneView {
	const source = {
		id: "ebi-gene2phenotype",
		name: "EBI Gene2Phenotype (G2P)",
		url: `${G2P_BASE}/gene/${encodeURIComponent(symbol)}/`,
		why: REFERER_HINT,
	};

	const recordsUnavailable = !gene.records_available;
	const recordsErrorText = recordsUnavailable
		? `Gene2Phenotype curated-record fetch FAILED (${G2P_BASE}/gene/${encodeURIComponent(symbol)}/summary/ — ` +
			`${gene.records_error ?? `HTTP ${gene.records_status}`}). ` +
			"The locus/ids block is real data from the gene endpoint, but the curated " +
			`disease records are UNKNOWN for ${symbol} — this is NOT evidence that G2P ` +
			"curates none. Retry before concluding absence."
		: undefined;

	const geneData: Record<string, unknown> = {
		gene_symbol: gene.gene_symbol,
		location: gene.location,
		ids: gene.ids,
		synonyms: gene.synonyms,
		last_updated: gene.last_updated,
		g2p_records: recordsUnavailable ? null : gene.records,
		record_count: recordsUnavailable ? null : gene.records.length,
		g2p_records_unavailable: recordsUnavailable,
		...(recordsErrorText
			? {
					g2p_records_error: recordsErrorText,
					g2p_records_status: gene.records_status,
				}
			: {}),
		decipher_composite: {
			available: false,
			missing_fields: [
				"hi_score",
				"p_hi",
				"p_ts",
				"s_het",
				"p_li",
				"loeuf",
				"protein_mechanism_data",
			],
			enable_with:
				"DECIPHER_SEND_REFERER=1 (same-origin Referer opt-in) or a DECIPHER Client API Key",
		},
		source,
	};

	const loc = gene.location ?? {};
	const recordsLine = recordsUnavailable
		? `  Curated G2P disease records: UNAVAILABLE — ${recordsErrorText}`
		: `  Curated G2P disease records: ${gene.records.length}`;
	const textSummary =
		`Gene ${gene.gene_symbol} — source: EBI Gene2Phenotype (keyless mirror)\n` +
		`  Locus: ${String(loc.chr ?? "?")}:${String(loc.start ?? "?")}-${String(loc.end ?? "?")} (${String(loc.assembly ?? "?")})\n` +
		`${recordsLine}\n` +
		`  DECIPHER composite scores (HI/pLI/LOEUF): not included — ${REFERER_HINT}`;

	return { geneData, source, textSummary };
}
