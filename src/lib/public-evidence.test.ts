/// <reference types="node" />
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { fetchClinGenRegionEvidence, parseClinGenRegionTsv } from "./clingen-regions";
import { fetchDbVarCnvCalls } from "./dbvar";
import { fetchG2pGene } from "./mirrors";
import { buildG2pGeneView } from "./g2p-view";

const clingen = readFileSync(new URL("./fixtures/clingen.tsv", import.meta.url), "utf8");
const dbvar = readFileSync(new URL("./fixtures/dbvar.tsv", import.meta.url), "utf8");
const region = { chr: "22", start: 1, end: 100000000 };
afterEach(() => vi.unstubAllGlobals());
const stubGzip = (tsv = dbvar) => vi.stubGlobal("fetch", async () => new Response(gzipSync(tsv)));

it("keeps all ClinGen columns, empty PMID slots, disease IDs and exact native TSV", async () => {
  vi.stubGlobal("fetch", async () => new Response(clingen));
  const result = await fetchClinGenRegionEvidence();
  expect(result.native_tsv).toBe(clingen);
  expect(result.region_count).toBe(3);
  const columns = clingen.split("\n")[5].slice(1).split("\t");
  for (const row of result.regions) {
    const native = clingen.split("\n")[row.source_line - 1];
    expect(row.native_tsv).toBe(native);
    expect(row.native_fields).toEqual(Object.fromEntries(columns.map((key, i) => [key, native.split("\t")[i]])));
    expect(row.haploinsufficiency_disease_id).toBe(row.native_fields["Haploinsufficiency Disease ID"]);
    expect(row.triplosensitivity_disease_id).toBe(row.native_fields["Triplosensitivity Disease ID"]);
  }
  expect(result.complete).toBe(false);
});

it("fails closed on a reordered ClinGen header or malformed row", () => {
  expect(() => parseClinGenRegionTsv(clingen.replace("Haploinsufficiency Score", "unexpected"))).toThrow("columns");
  expect(() => parseClinGenRegionTsv(clingen + "ISCA-broken\tpartial\n")).toThrow("Malformed");
});

it("separates primary and alternate sequence coordinates and preserves all 36 dbVar cells", async () => {
  stubGzip();
  const primary = await fetchDbVarCnvCalls(region);
  const alternate = await fetchDbVarCnvCalls({ ...region, contig: "NT_187632.1" });
  expect(primary.calls.map(row => row.variant_call_accession)).toEqual(["nssv16113248"]);
  expect(alternate.calls.map(row => row.variant_call_accession)).toEqual(["nssv16130855"]);
  expect(primary.file_scan).toMatchObject({ placement_rows: 2, unique_call_accessions: 2, alternate_contig_rows: 1, complete: true });
  expect(primary.calls[0]).toMatchObject({ contig: "", placement: "inner", start: 10690627, stop: 16080741, allele_count: 9, allele_number: 845 });
  const headers = dbvar.split("\n")[1].slice(1).split("\t");
  for (const row of [...primary.calls, ...alternate.calls]) {
    const raw = dbvar.split("\n")[(row.source_line ?? 0) - 1];
    expect(row.native_tsv).toBe(raw);
    expect(row.native_fields).toEqual(Object.fromEntries(headers.map((key, i) => [key, raw.split("\t")[i]])));
  }
});

it("counts duplicate accession placements separately and exposes truncated selection", async () => {
  stubGzip(dbvar + dbvar.split("\n")[2] + "\n");
  const result = await fetchDbVarCnvCalls({ ...region, limit: 1 });
  expect(result).toMatchObject({ scanned: 3, matched: 2, truncated: true, file_scan: { unique_call_accessions: 2, placement_rows: 3 } });
  expect(result.calls).toHaveLength(1);
});

it("applies allele-frequency and type filters without treating empty AF as zero", async () => {
  stubGzip();
  expect((await fetchDbVarCnvCalls({ ...region, minAlleleFrequency: 0.1 })).matched).toBe(0);
  expect((await fetchDbVarCnvCalls({ ...region, variantType: "deletion" })).matched).toBe(0);
  stubGzip(dbvar.replace("AF=0.010650888", "AF="));
  expect((await fetchDbVarCnvCalls(region)).calls[0].allele_frequency).toBeNull();
  expect((await fetchDbVarCnvCalls({ ...region, minAlleleFrequency: 0 })).matched).toBe(0);
});

it.each([{ start: 0 }, { end: 0 }, { start: 1.5 }, { chr: "23" }, { limit: 2001 }, { contig: "../22" }, { minAlleleFrequency: Number.NaN }, { variantType: "anything" }])("rejects invalid dbVar input before a download: %j", async change => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(fetchDbVarCnvCalls({ ...region, ...change })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects unexpected dbVar columns, short rows, assemblies and corrupt gzip", async () => {
  for (const tsv of [dbvar.replace("allele_frequency\t", "wrong\t"), dbvar + "nssv1\tshort\n", dbvar.replaceAll("GRCh38.p12", "GRCh37")]) {
    stubGzip(tsv); await expect(fetchDbVarCnvCalls(region)).rejects.toMatchObject({ status: 502 });
  }
  vi.stubGlobal("fetch", async () => new Response("not gzip"));
  await expect(fetchDbVarCnvCalls(region)).rejects.toThrow();
});

it("preserves a failed G2P summary as unknown, with the native error and successful locus", async () => {
  const gene = { gene_symbol: "SCN2A", ids: { HGNC: "HGNC:10588" }, future: { retained: true } };
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("summary/") ? Response.json({ error: "Native unavailable" }, { status: 503 }) : Response.json(gene));
  const result = await fetchG2pGene("SCN2A");
  expect(result.gene?.native).toEqual({ gene, summary: null });
  expect(result.gene?.response_evidence).toMatchObject({ summary: { native_error: { error: "Native unavailable" }, response_evidence: { upstream_status: 503 } } });
  expect(result.gene).toBeDefined();
  if (!result.gene) throw new Error("Missing successful locus");
  expect(buildG2pGeneView("SCN2A", result.gene).geneData).toMatchObject({ g2p_records: null, record_count: null, g2p_records_unavailable: true });
});
