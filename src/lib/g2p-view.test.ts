import { describe, expect, it } from "vitest";
import { buildG2pGeneView } from "./g2p-view";
import type { G2pGeneRecord } from "./mirrors";

function gene(overrides: Partial<G2pGeneRecord> = {}): G2pGeneRecord {
	return {
		gene_symbol: "BRCA1",
		location: { assembly: "GRCh38", chr: "17", start: 43044295, end: 43170245 },
		ids: { HGNC: "HGNC:1100" },
		synonyms: [],
		records: [],
		records_available: true,
		records_status: 200,
		...overrides,
	};
}

describe("buildG2pGeneView", () => {
	it("reports a real zero as zero", () => {
		const { geneData, textSummary } = buildG2pGeneView("BRCA1", gene());
		expect(geneData.g2p_records).toEqual([]);
		expect(geneData.record_count).toBe(0);
		expect(geneData.g2p_records_unavailable).toBe(false);
		expect(geneData.g2p_records_error).toBeUndefined();
		expect(textSummary).toContain("Curated G2P disease records: 0");
	});

	it("counts the curated records when the summary call succeeded", () => {
		const { geneData, textSummary } = buildG2pGeneView(
			"BRCA1",
			gene({ records: [{ disease: "Fanconi anemia" }, { disease: "cancer" }] }),
		);
		expect(geneData.record_count).toBe(2);
		expect(textSummary).toContain("Curated G2P disease records: 2");
	});

	// The defect this test exists for: a failed second fetch used to render as
	// `g2p_records: [], record_count: 0, success: true`, which reads as "G2P
	// curates no disease for this gene". Absence and failure must not share a
	// representation.
	it("never renders a failed records fetch as zero curated records", () => {
		const { geneData, textSummary } = buildG2pGeneView(
			"BRCA1",
			gene({
				records: [],
				records_available: false,
				records_status: 503,
				records_error: "HTTP 503 - upstream unavailable",
			}),
		);
		expect(geneData.g2p_records).toBeNull();
		expect(geneData.record_count).toBeNull();
		expect(geneData.g2p_records_unavailable).toBe(true);
		expect(geneData.g2p_records_status).toBe(503);
		expect(String(geneData.g2p_records_error)).toContain("HTTP 503");
		expect(String(geneData.g2p_records_error)).toContain("NOT evidence");
		expect(textSummary).toContain("Curated G2P disease records: UNAVAILABLE");
		// The locus/ids block is still real data and must survive.
		expect(geneData.ids).toMatchObject({ HGNC: "HGNC:1100" });
	});

	it("still names the upstream that answered", () => {
		const { source } = buildG2pGeneView("BRCA1", gene());
		expect(source.id).toBe("ebi-gene2phenotype");
		expect(String(source.url)).toContain("ebi.ac.uk/gene2phenotype");
	});
});
