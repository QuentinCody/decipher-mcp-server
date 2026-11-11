import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

// Provider OpenAPI: EBI-G2P/gene2phenotype_api, gene2phenotype_project/schema.json.
// These are public GET operations; schema version is not a pinned data release.
export const g2pEvidenceEndpoints: ApiCatalog["endpoints"] = [
  {
    method: "GET", path: "/mirror/g2p/lgd/{stable_id}/", category: "g2p-evidence",
    summary: "Get a complete Gene2Phenotype Locus-Genotype-Mechanism-Disease-Evidence record by stable ID. Retains mechanism/support/synopsis, functional studies by publication, confidence, variant consequences/types, dates and review status. G2P curation, not a DECIPHER patient record.",
    pathParams: [{ name: "stable_id", type: "string", required: true, description: "G2P stable ID from search or gene summary (e.g. G2P03507)" }],
    example: "return await api.get('/mirror/g2p/lgd/G2P03507/');",
  },
  {
    method: "GET", path: "/mirror/g2p/molecular_mechanisms/", category: "g2p-evidence",
    summary: "Discover G2P mechanism, synopsis, support and functional-evidence terminology. Mechanism and variant consequence are distinct; missing evidence is not negative evidence.",
    example: "return await api.get('/mirror/g2p/molecular_mechanisms/');",
  },
  {
    method: "GET", path: "/mirror/g2p/reference_data/", category: "g2p-evidence",
    summary: "Get native G2P reference-source/version metadata. These dependency versions do not pin the mutable G2P curation dataset or DECIPHER release.",
    example: "return await api.get('/mirror/g2p/reference_data/');",
  },
];
