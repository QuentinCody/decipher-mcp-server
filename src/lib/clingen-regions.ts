import { fail, mirrorRead } from "./mirror-http";
export const CLINGEN_REGION_TSV = "https://ftp.clinicalgenome.org/ClinGen_region_curation_list_GRCh38.tsv";
const NATIVE_COLUMNS = ["ISCA ID", "ISCA Region Name", "cytoBand", "Genomic Location", "Haploinsufficiency Score", "Haploinsufficiency Description", "Haploinsufficiency PMID1", "Haploinsufficiency PMID2", "Haploinsufficiency PMID3", "Haploinsufficiency PMID4", "Haploinsufficiency PMID5", "Haploinsufficiency PMID6", "Triplosensitivity Score", "Triplosensitivity Description", "Triplosensitivity PMID1", "Triplosensitivity PMID2", "Triplosensitivity PMID3", "Triplosensitivity PMID4", "Triplosensitivity PMID5", "Triplosensitivity PMID6", "Date Last Evaluated", "Haploinsufficiency Disease ID", "Triplosensitivity Disease ID"];

export interface ClinGenRegion {
	isca_id: string;
	native_fields: Record<string, string>;
	native_tsv: string;
	source_line: number;
	haploinsufficiency_disease_id: string;
	triplosensitivity_disease_id: string;
	name: string;
	cytoband: string;
	assembly: "GRCh38";
	chr: string;
	start: number | null;
	end: number | null;
	genomic_location: string;
	haploinsufficiency_score: string;
	haploinsufficiency_description: string;
	haploinsufficiency_pmids: string[];
	triplosensitivity_score: string;
	triplosensitivity_description: string;
	triplosensitivity_pmids: string[];
	date_last_evaluated: string;
}

/** `chr16:16762939-18073544` → { chr: "16", start, end } */
function parseGenomicLocation(location: string): {
	chr: string;
	start: number | null;
	end: number | null;
} {
	const match = /^chr([^:]+):(\d+)-(\d+)$/.exec(location.trim());
	if (!match) return { chr: "", start: null, end: null };
	return { chr: match[1], start: Number(match[2]), end: Number(match[3]) };
}

/**
 * Parse the ClinGen region curation TSV.
 *
 * Layout: five `#`-prefixed provenance lines, then a `#`-prefixed HEADER line,
 * then the rows. The header is commented like the provenance lines, so a naive
 * "drop every # line" reader silently loses the column names — hence the
 * column indexes below are pinned by a unit test against a real header.
 */
export function parseClinGenRegionTsv(tsv: string): ClinGenRegion[] {
	const regions: ClinGenRegion[] = [];
	const lines = tsv.split("\n");
  const headerLine = lines.find(line => line.startsWith("#ISCA ID\t"));
  if (!headerLine) fail("Missing ClinGen TSV header", 502);
  const headers = headerLine.replace(/\r$/, "").slice(1).split("\t");
  if (new Set(headers).size !== headers.length || NATIVE_COLUMNS.some((key, index) => headers[index] !== key)) fail("Unexpected ClinGen TSV columns", 502);
  for (const [index, rawLine] of lines.entries()) {
		const line = rawLine.replace(/\r$/, "");
		if (!line || line.startsWith("#")) continue;
		const f = line.split("\t");
		if (f.length !== headers.length || !f[0].startsWith("ISCA-")) fail(`Malformed ClinGen TSV row ${index + 1}`, 502);
		const pmids = (from: number) =>
			f.slice(from, from + 6).filter((v) => v && v.trim().length > 0);
		const { chr, start, end } = parseGenomicLocation(f[3] ?? "");
		regions.push({
			isca_id: f[0],
      native_fields: Object.fromEntries(headers.map((key, i) => [key, f[i]])), native_tsv: line, source_line: index + 1,
      haploinsufficiency_disease_id: f[21], triplosensitivity_disease_id: f[22],
			name: f[1] ?? "",
			cytoband: f[2] ?? "",
			assembly: "GRCh38",
			chr,
			start,
			end,
			genomic_location: f[3] ?? "",
			haploinsufficiency_score: f[4] ?? "",
			haploinsufficiency_description: f[5] ?? "",
			haploinsufficiency_pmids: pmids(6),
			triplosensitivity_score: f[12] ?? "",
			triplosensitivity_description: f[13] ?? "",
			triplosensitivity_pmids: pmids(14),
			date_last_evaluated: f[20] ?? "",
		});
	}
	return regions;
}

export async function fetchClinGenRegionEvidence() {
  const result = await mirrorRead(CLINGEN_REGION_TSV, { accept: "text/tab-separated-values", deadline: Date.now() + 40000 });
  const native_tsv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(result.bytes);
  const regions = parseClinGenRegionTsv(native_tsv);
  return { region_count: regions.length, regions, native_tsv, response_evidence: result.evidence,
    source: { id: "clingen-dosage", name: "ClinGen dosage region curation (GRCh38)", url: CLINGEN_REGION_TSV },
    complete: false, scope: "All rows in the observed ClinGen region file; not all syndromes or DECIPHER patient records" };
}
export async function fetchClinGenRegions(): Promise<ClinGenRegion[]> {
  return (await fetchClinGenRegionEvidence()).regions;
}
