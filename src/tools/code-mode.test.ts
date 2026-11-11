import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { registerGeneLookup } from "./gene-lookup";
import { createDecipherApiFetch } from "../lib/api-adapter";
import { decipherCatalog } from "../spec/catalog";

afterEach(() => vi.unstubAllGlobals());

function stagingFixture() {
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      // SAFETY: shared staging sends a data envelope to this route.
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["evidence"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: { evidence: { columns: [{ name: "stable_id" }] } } } });
  } }) };
  return { namespace, stored };
}

function toolRegistry(server: McpServer) {
  // SAFETY: SDK internal registry is inspected only to exercise real callbacks.
  return (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
}

it("registers all Code Mode/staging aliases with success and error envelopes", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: invalid execution never invokes this fixture loader.
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1], { sendReferer: false });
  registerQueryData(server, {}); registerGetSchema(server, {});
  const tools = toolRegistry(server);
  expect(Object.keys(tools)).toHaveLength(8);
  for (const prefix of ["", "mcp_"]) {
    expect(await tools[prefix + "decipher_search"].handler({ query: "g2p-evidence", max_results: 5 }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    for (const [name, args] of [["decipher_execute", { code: "" }], ["decipher_query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["decipher_get_schema", { data_access_id: "fixture" }]] as const) {
      expect(await tools[prefix + name].handler(args, {})).toMatchObject({ content: expect.any(Array), structuredContent: expect.any(Object), isError: true });
    }
  }
});

it("stages full nested mechanism evidence and source dates without flattening away meaning", async () => {
  const native = { stable_id: "G2P03507", molecular_mechanism: { mechanism: "loss of function", mechanism_support: "evidence", evidence: { "123456": { descriptions: ["α".repeat(20000)], functional_studies: { Rescue: ["Patient Cells"] } } } }, variant_consequence: [{ support: "inferred", publication: null }], last_updated: "2026-09-25", under_review: true };
  vi.stubGlobal("fetch", async () => Response.json(native));
  const { namespace, stored } = stagingFixture();
  const proxy = createApiProxyTool({ apiFetch: createDecipherApiFetch({ sendReferer: false }), catalog: decipherCatalog, doNamespace: namespace, stagingPrefix: "decipher", maxInlineBytes: 30 * 1024 });
  const result = await proxy.handler({ method: "GET", path: "/mirror/g2p/lgd/G2P03507/" }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String), _staging: expect.any(Object) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual(native);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});

it("gene lookup stages based on UTF-8 bytes and retains summary provenance", async () => {
  const record = { stable_id: "G2P03507", molecular_mechanism: "undetermined", disease: "α".repeat(20000) };
  vi.stubGlobal("fetch", async (url: string) => Response.json(url.endsWith("/summary/") ? { records_summary: [record] } : { gene_symbol: "MTFMT", reference: "grch38" }));
  const { namespace, stored } = stagingFixture();
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: fixture implements the namespace calls used by the staging helper.
  registerGeneLookup(server, { DECIPHER_DATA_DO: namespace } as unknown as Parameters<typeof registerGeneLookup>[1], { sendReferer: false });
  const result = await toolRegistry(server).decipher_gene_lookup.handler({ symbol: "MTFMT" }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { _staging: expect.any(Object) } });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toEqual(expect.arrayContaining([expect.objectContaining({ structuredContent: expect.objectContaining({ data: expect.objectContaining({ g2p_records: [record], native: { gene: { gene_symbol: "MTFMT", reference: "grch38" }, summary: { records_summary: [record] } }, source: expect.objectContaining({ id: "ebi-gene2phenotype", records_url: "https://www.ebi.ac.uk/gene2phenotype/api/gene/MTFMT/summary/" }) }) }) })]));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});
