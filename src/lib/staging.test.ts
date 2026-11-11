/// <reference types="node" />
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";
import { decipherSchemaHints, decipherTables } from "./staging";

const records = ["G2P03507", "G2P03701"].map(id => JSON.parse(readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url), "utf8")));

it("keeps full native records and links mechanism/publication evidence to the correct G2P stable ID", () => {
  const tables = decipherTables({ records });
  expect(tables.g2p_records).toHaveLength(2);
  expect(tables.mechanism_evidence).toHaveLength(5);
  expect(tables.g2p_publications).toHaveLength(6);
  expect(tables.mined_publications).toHaveLength(15);
  expect(tables.g2p_records.map(row => JSON.parse(String(row.native_json)))).toEqual(records);
  for (const [index, record] of records.entries()) {
    const rows = tables.mechanism_evidence.filter(row => row.g2p_stable_id === record.stable_id);
    expect(rows.map(row => row.publication_pmid)).toEqual(Object.keys(record.molecular_mechanism.evidence));
    for (const row of rows) {
      expect(row.source_path).toBe(`/records/${index}/molecular_mechanism/evidence/${row.publication_pmid}`);
      expect(JSON.parse(String(row.native_json))).toEqual(record.molecular_mechanism.evidence[String(row.publication_pmid)]);
    }
  }
  expect(JSON.parse(String(tables.response_context[0].native_json))).toEqual({ records });
});

it("retains sibling tables when a provider envelope contains results", () => {
  const native = { results: [{ stable_id: "G2P00033", mechanism: "loss of function" }], references: [{ name: "HGNC", release: "2026" }], next: "page2" };
  const tables = decipherTables(native);
  expect(tables.g2p_associations).toHaveLength(1);
  expect(tables.Results).toHaveLength(1);
  expect(JSON.parse(String(tables.response_context[0].native_json))).toEqual(native);
});

it("avoids duplicate gene-summary counts while retaining the native source copies", () => {
  const association = { stable_id: "G2P00033", disease: "native" };
  const gene = { gene_symbol: "SCN2A", ids: { HGNC: "HGNC:10588" }, g2p_records: [association], native: { summary: { records_summary: [association] } } };
  const tables = decipherTables({ content: [], structuredContent: { data: gene } });
  expect(tables.gene_lookup).toHaveLength(1);
  expect(tables.g2p_associations).toHaveLength(1);
  expect(JSON.parse(String(tables.gene_lookup[0].native_json))).toEqual(gene);
});

it("splits future wide records without losing strings, source paths or native JSON", () => {
  const row = { isca_id: "ISCA-test", ...Object.fromEntries(Array.from({ length: 161 }, (_, i) => [`f${i}`, `00${i}`])) };
  const tables = decipherTables({ regions: [row] });
  expect(Object.keys(tables)).toContain("clingen_regions_columns_3");
  for (const [key, value] of Object.entries(row)) expect(Object.values(tables).some(rows => rows[0]?.[key] === value)).toBe(true);
  expect(tables.clingen_regions_columns_3[0].source_path).toBe("/regions/0");
  expect(JSON.parse(String(tables.clingen_regions[0].native_json))).toEqual(row);
  expect(decipherSchemaHints({ regions: [row] }).columnTypes?.f160).toBe("TEXT");
});
