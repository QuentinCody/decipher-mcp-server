import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchG2pGene,
	overlapsRegion,
	parseClinGenRegionTsv,
	parseDbVarCallRow,
	resolveDbVarPlacement,
} from "./mirrors";

// Fixtures are verbatim lines from the live files (fetched 2026-08-27):
//   https://ftp.clinicalgenome.org/ClinGen_region_curation_list_GRCh38.tsv
//   https://ftp.ncbi.nlm.nih.gov/pub/dbVar/.../nstd183.GRCh38.variant_call.tsv.gz
const CLINGEN_TSV = [
	"#ClinGen Region Curation Results",
	"#28 Apr,2026",
	"#Genomic Locations are reported on GRCh38 (hg38): GCF_000001405.36",
	"#https://www.ncbi.nlm.nih.gov/projects/dbvar/clingen",
	"#to create link: https://www.ncbi.nlm.nih.gov/projects/dbvar/clingen/clingen_region.cgi?id=key",
	"#ISCA ID\tISCA Region Name\tcytoBand\tGenomic Location\tHaploinsufficiency Score\tHaploinsufficiency Description\tHaploinsufficiency PMID1\tHaploinsufficiency PMID2\tHaploinsufficiency PMID3\tHaploinsufficiency PMID4\tHaploinsufficiency PMID5\tHaploinsufficiency PMID6\tTriplosensitivity Score\tTriplosensitivity Description\tTriplosensitivity PMID1\tTriplosensitivity PMID2\tTriplosensitivity PMID3\tTriplosensitivity PMID4\tTriplosensitivity PMID5\tTriplosensitivity PMID6\tDate Last Evaluated\tHaploinsufficiency Disease ID\tTriplosensitivity Disease ID",
	"ISCA-46757\t21q21.3 region (includes APP)\t21q21.3\tchr21:25734570-26573286\t0\tNo evidence available\t\t\t\t\t\t\t3\tSufficient evidence for dosage pathogenicity\t19684239\t21193246\t37170141\t\t\t\t2025-10-27\t\t",
	"ISCA-46755\t16p12.3 recurrent region (BP3-BP4) (includes XYLT1)\t16p12.3\tchr16:16762939-18073544\t0\tNo evidence available\t\t\t\t\t\t\t0\tNo evidence available\t\t\t\t\t\t\t2025-06-06\t\t",
].join("\n");

describe("parseClinGenRegionTsv", () => {
	it("keeps the data rows and drops every comment line, header included", () => {
		const regions = parseClinGenRegionTsv(CLINGEN_TSV);
		expect(regions).toHaveLength(2);
		expect(regions.map((r) => r.isca_id)).toEqual(["ISCA-46757", "ISCA-46755"]);
	});

	it("splits the genomic location into chr/start/end", () => {
		const [first] = parseClinGenRegionTsv(CLINGEN_TSV);
		expect(first.chr).toBe("21");
		expect(first.start).toBe(25734570);
		expect(first.end).toBe(26573286);
		expect(first.assembly).toBe("GRCh38");
	});

	it("reads the dosage scores from the right columns and collects the PMIDs", () => {
		const [first] = parseClinGenRegionTsv(CLINGEN_TSV);
		expect(first.name).toBe("21q21.3 region (includes APP)");
		expect(first.haploinsufficiency_score).toBe("0");
		expect(first.triplosensitivity_score).toBe("3");
		expect(first.triplosensitivity_description).toBe(
			"Sufficient evidence for dosage pathogenicity",
		);
		expect(first.triplosensitivity_pmids).toEqual(["19684239", "21193246", "37170141"]);
		expect(first.haploinsufficiency_pmids).toEqual([]);
		expect(first.date_last_evaluated).toBe("2025-10-27");
	});
});

/** Build a 36-column nstd183 row with the given field overrides. */
function dbVarRow(overrides: Record<number, string>): string {
	const fields = new Array(36).fill("");
	fields[0] = "nssv16113248";
	fields[2] = "duplication";
	fields[6] = "GRCh38.p12";
	fields[7] = "22";
	fields[16] = "nsv4604733";
	fields[33] = "AC=9";
	fields[34] = "AF=0.010650888";
	fields[35] = "AN=845";
	for (const [index, value] of Object.entries(overrides)) {
		fields[Number(index)] = value;
	}
	return fields.join("\t");
}

describe("resolveDbVarPlacement (dbVar leaves two of three column pairs blank)", () => {
	it("reads (start, stop) when the call is placed exactly", () => {
		const fields = dbVarRow({ 10: "19009705", 13: "19022227" }).split("\t");
		expect(resolveDbVarPlacement(fields)).toEqual({
			start: 19009705,
			stop: 19022227,
			placement: "exact",
		});
	});

	// This is the row shape of every remapped nstd183 call — all 1,364 chr22
	// calls among them. Reading only (start, stop) returns an empty, plausible,
	// WRONG answer for a region query.
	it("falls back to (inner_start, inner_stop) when start/stop are blank", () => {
		const fields = dbVarRow({ 11: "10690627", 12: "16080741" }).split("\t");
		expect(resolveDbVarPlacement(fields)).toEqual({
			start: 10690627,
			stop: 16080741,
			placement: "inner",
		});
	});

	it("falls back to (outer_start, outer_stop) last", () => {
		const fields = dbVarRow({ 9: "100", 14: "200" }).split("\t");
		expect(resolveDbVarPlacement(fields)).toEqual({
			start: 100,
			stop: 200,
			placement: "outer",
		});
	});

	it("returns undefined when the call has no placement at all", () => {
		expect(resolveDbVarPlacement(dbVarRow({}).split("\t"))).toBeUndefined();
	});
});

describe("parseDbVarCallRow", () => {
	it("parses the tagged allele columns into numbers", () => {
		const call = parseDbVarCallRow(dbVarRow({ 10: "19009705", 13: "19022227" }));
		expect(call).toMatchObject({
			variant_call_accession: "nssv16113248",
			variant_call_type: "duplication",
			chr: "22",
			start: 19009705,
			stop: 19022227,
			allele_count: 9,
			allele_frequency: 0.010650888,
			allele_number: 845,
		});
	});

	it("reports a blank allele column as null rather than 0", () => {
		const call = parseDbVarCallRow(dbVarRow({ 10: "1", 13: "2", 33: "", 34: "", 35: "" }));
		expect(call?.allele_count).toBeNull();
		expect(call?.allele_frequency).toBeNull();
	});

	it("ignores header and non-call lines", () => {
		expect(parseDbVarCallRow("#variant_call_accession\tvariant_call_id")).toBeUndefined();
		expect(parseDbVarCallRow("")).toBeUndefined();
	});
});

describe("overlapsRegion", () => {
	const query = { chr: "22", start: 18900000, end: 21500000 };

	it("matches a call that straddles, touches, or sits inside the region", () => {
		expect(overlapsRegion({ chr: "22", start: 19009705, stop: 19022227 }, query)).toBe(true);
		expect(overlapsRegion({ chr: "22", start: 10690627, stop: 19000000 }, query)).toBe(true);
		expect(overlapsRegion({ chr: "22", start: 21500000, stop: 22000000 }, query)).toBe(true);
	});

	it("rejects a call on another chromosome or outside the region", () => {
		expect(overlapsRegion({ chr: "21", start: 19009705, stop: 19022227 }, query)).toBe(false);
		expect(overlapsRegion({ chr: "22", start: 21500001, stop: 21600000 }, query)).toBe(false);
		expect(overlapsRegion({ chr: "22", start: 100, stop: 18899999 }, query)).toBe(false);
	});
});

// ── fetchG2pGene: a failed summary call must never look like "zero records" ──
//
// The curated disease records come from a SECOND G2P endpoint. Until this was
// fixed the failure was swallowed with `.catch(() => undefined)` and the caller
// emitted `g2p_records: [], record_count: 0, success: true` — byte-identical to
// a gene G2P genuinely curates nothing for, and the canonical verify probe is
// exactly this call, so an EBI blip produced a GREEN sweep over a hollow answer.

const GENE_BODY = {
	gene_symbol: "BRCA1",
	reference: "GRCh38",
	sequence: "17",
	start: 43044295,
	end: 43170245,
	strand: -1,
	ids: { HGNC: "HGNC:1100", Ensembl: "ENSG00000012048" },
	synonyms: [],
};

/** Answer the gene endpoint with 200 and the summary endpoint with `summary`. */
function stubG2p(summary: { status: number; body?: unknown }): void {
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith("/summary/")) {
			return new Response(
				summary.body === undefined ? "upstream unavailable" : JSON.stringify(summary.body),
				{ status: summary.status, headers: { "Content-Type": "application/json" } },
			);
		}
		return new Response(JSON.stringify(GENE_BODY), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	});
}

describe("fetchG2pGene records provenance", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("marks the records available when the summary call answers 200 with the array", async () => {
		stubG2p({ status: 200, body: { records_summary: [{ disease: "Fanconi anemia" }] } });
		const result = await fetchG2pGene("BRCA1");
		expect(result.gene?.records_available).toBe(true);
		expect(result.gene?.records_status).toBe(200);
		expect(result.gene?.records).toHaveLength(1);
		expect(result.gene?.records_error).toBeUndefined();
	});

	it("reports a failed summary call instead of returning an empty record list", async () => {
		stubG2p({ status: 403 });
		const result = await fetchG2pGene("BRCA1");
		// The gene block is still real data...
		expect(result.found).toBe(true);
		expect(result.gene?.ids).toMatchObject({ HGNC: "HGNC:1100" });
		// ...but the records are UNKNOWN, not zero.
		expect(result.gene?.records_available).toBe(false);
		expect(result.gene?.records_status).toBe(403);
		expect(result.gene?.records_error).toContain("HTTP 403");
	});

	it("treats a 200 with no records_summary array as an upstream shape change, not an empty set", async () => {
		stubG2p({ status: 200, body: { unexpected: true } });
		const result = await fetchG2pGene("BRCA1");
		expect(result.gene?.records_available).toBe(false);
		expect(result.gene?.records_status).toBe(200);
		expect(result.gene?.records_error).toContain("records_summary");
	});
});
