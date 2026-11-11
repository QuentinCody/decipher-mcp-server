import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const projected = (value: Row, path: string): Row => ({
  ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "_rowid").map(([key, cell]) =>
    [key, cell !== null && typeof cell === "object" ? JSON.stringify(cell) : cell])),
  native_json: JSON.stringify(value), source_path: path,
});

function rowTable(row: Row): string {
  if (typeof row.isca_id === "string") return "clingen_regions";
  if (typeof row.variant_call_accession === "string") return "cnv_calls";
  if (typeof row.stable_id === "string") return record(row.locus) ? "g2p_records" : "g2p_associations";
  if (typeof row.gene_symbol === "string" && record(row.ids)) return "g2p_records" in row ? "gene_lookup" : "genes";
  return "Results";
}

/** Preserve native envelopes and every row without coercing identifier/value strings. */
export function decipherTables(value: unknown) {
  const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
    ? value.structuredContent.data : value;
  const tables: Record<string, Row[]> = {};
  collect(data, "", tables, Array.isArray(data));
  splitWideTables(tables);
  tables.response_context = [{ native_json: JSON.stringify(data) ?? "null" }];
  return tables;
}

/** Workerd SQLite allows 100 columns including generated bookkeeping columns. */
function splitWideTables(tables: Record<string, Row[]>) {
  for (const [name, rows] of Object.entries(tables)) {
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => !["native_json", "source_path"].includes(key));
    if (keys.length <= 80) continue;
    for (let offset = 0; offset < keys.length; offset += 80) {
      const selected = keys.slice(offset, offset + 80);
      const table = offset === 0 ? name : `${name}_columns_${offset / 80 + 1}`;
      tables[table] = rows.map(row => ({
        ...Object.fromEntries(selected.filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, row[key]])),
        source_path: row.source_path,
        ...(offset === 0 ? { native_json: row.native_json } : {}),
      }));
    }
  }
}

function collect(value: unknown, path: string, tables: Record<string, Row[]>, rows = false, stableId?: string, arrayName?: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { collect(item, `${path}/${index}`, tables, rows, stableId, arrayName); });
    return;
  }
  if (!record(value)) return;
  const kind = rowTable(value);
  const parentId = typeof value.stable_id === "string" ? value.stable_id : stableId;
  const table = kind !== "Results" ? kind : rows ? arrayName ?? "Results" : undefined;
  if (table) {
    tables[table] ??= [];
    tables[table].push({ ...projected(value, path), ...(stableId ? { g2p_stable_id: stableId } : {}) });
    if (["clingen_regions", "cnv_calls", "g2p_associations", "genes"].includes(table)) return;
  }
  if (kind === "g2p_records" && record(value.molecular_mechanism) && record(value.molecular_mechanism.evidence)) {
    for (const [pmid, evidence] of Object.entries(value.molecular_mechanism.evidence)) if (record(evidence)) {
      tables.mechanism_evidence ??= [];
      tables.mechanism_evidence.push({ ...projected(evidence, `${path}/molecular_mechanism/evidence/${pmid}`), publication_pmid: pmid, g2p_stable_id: parentId });
    }
  }
  if (typeof value.sql === "string" && Array.isArray(value.rows)) {
    tables.query_rows = value.rows.filter(record).map((item, index) => projected(item, `${path}/rows/${index}`));
    return;
  }
  const arrays: Record<string, string> = { publications: "g2p_publications", mined_publications: "mined_publications", variant_consequence: "variant_consequences", variant_type: "variant_types", ontology_terms: "ontology_terms", records_summary: "g2p_associations", g2p_records: "g2p_associations" };
  for (const [key, child] of Object.entries(value)) {
    // Canonical JSON retains native source copies. Avoid counting them twice in SQL projections.
    if (key === "native" && kind === "gene_lookup") continue;
    if (key === "molecular_mechanism" && kind === "g2p_records") continue;
    collect(child, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, tables, Array.isArray(child), parentId, arrays[key]);
  }
}

export function decipherSchemaHints(value: unknown): SchemaHints {
  const columnTypes: Record<string, string> = { native_json: "TEXT", source_path: "TEXT" };
  for (const rows of Object.values(decipherTables(value))) for (const row of rows) {
    for (const [key, cell] of Object.entries(row)) if (typeof cell === "string") columnTypes[key] = "TEXT";
  }
  return { columnTypes };
}
