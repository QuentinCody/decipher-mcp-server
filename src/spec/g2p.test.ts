import { afterEach, expect, it, vi } from "vitest";
import { buildKnownEndpointIndex, preflightUnknownEndpoint } from "@bio-mcp/shared/tools/api-proxy-drift";
import { decipherCatalog } from "./catalog";
import { g2pEvidenceEndpoints } from "./g2p";
import { createDecipherApiFetch } from "../lib/api-adapter";

afterEach(() => vi.unstubAllGlobals());

// Synthetic values following the provider's published OpenAPI LGMDE shape,
// including fields absent from its gene summary. Not a captured clinical record.
const record = {
  stable_id: "G2P03507", genotype: "biallelic_autosomal", confidence: "disputed",
  locus: { gene_symbol: "MTFMT", reference: "grch38" },
  disease: { name: "Synthetic disease", ontology_terms: [], synonyms: [] },
  molecular_mechanism: { mechanism: "loss of function", mechanism_support: "evidence",
    synopsis: [{ name: "loss of activity" }], evidence: { "123456": { functional_studies: { Rescue: ["Patient Cells"] }, descriptions: ["Synthetic evidence"] } } },
  variant_consequence: [{ variant_consequence: "absent gene product", support: "inferred", publication: null }],
  variant_type: [{ term: "stop_gained_NMD_escaping", inherited: false, de_novo: false, unknown_inheritance: true }],
  variant_description: ["Synthetic recurrent variant description"],
  publications: [{ publication: { pmid: 123456 }, affected_individuals: null }],
  mined_publications: [{ pmid: 654321, status: "rejected" }],
  last_updated: "2026-09-25", date_created: "2025-03-01", under_review: true,
  future_field: { retained: true },
};

it("retains complete native mechanism evidence without collapsing it into gene summaries", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(record)); vi.stubGlobal("fetch", fetcher);
  const result = await createDecipherApiFetch({ sendReferer: false })({ method: "GET", path: "/mirror/g2p/lgd/G2P03507/" });
  expect(result).toEqual({ status: 200, data: record });
  expect(fetcher.mock.calls[0][0]).toBe("https://www.ebi.ac.uk/gene2phenotype/api/lgd/G2P03507/");
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("Referer");
});

it.each([
  ["/mirror/g2p/molecular_mechanisms/", { mechanism: [{ key: "undetermined" }], support: [{ key: "inferred" }], evidence: { rescue: [] } }],
  ["/mirror/g2p/reference_data/", [{ key: "assembly", source: "Ensembl", version: "GRCh38" }]],
])("retrieves provider terminology/metadata unchanged at %s", async (path, data) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", fetcher);
  expect((await createDecipherApiFetch({ sendReferer: false })({ method: "GET", path })).data).toEqual(data);
  expect(fetcher.mock.calls[0][0]).toBe(`https://www.ebi.ac.uk/gene2phenotype/api${path.slice("/mirror/g2p".length)}`);
});

it("catalogs only the three documented read operations and permits their examples", () => {
  expect(g2pEvidenceEndpoints.map(endpoint => endpoint.path)).toEqual([
    "/mirror/g2p/lgd/{stable_id}/", "/mirror/g2p/molecular_mechanisms/", "/mirror/g2p/reference_data/",
  ]);
  const index = buildKnownEndpointIndex(decipherCatalog);
  for (const path of ["/mirror/g2p/lgd/G2P03507/", "/mirror/g2p/molecular_mechanisms/", "/mirror/g2p/reference_data/"]) {
    expect(preflightUnknownEndpoint("GET", path, index)).toBeUndefined();
  }
  expect(g2pEvidenceEndpoints.every(endpoint => endpoint.method === "GET")).toBe(true);
});

it("does not translate a missing full record into empty evidence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Not found" }, { status: 404 })));
  await expect(createDecipherApiFetch({ sendReferer: false })({ method: "GET", path: "/mirror/g2p/lgd/G2P00000/" })).rejects.toMatchObject({ status: 404 });
});
