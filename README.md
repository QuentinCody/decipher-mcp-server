# Decipher MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream Decipher API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://decipher-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "decipher": {
      "command": "npx",
      "args": ["mcp-remote", "https://decipher-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8826/mcp` (start it with `./scripts/dev-servers.sh decipher`):

```json
{
  "mcpServers": {
    "decipher-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8826/mcp"]
    }
  }
}
```

## Tools

- `decipher_gene_lookup` — gene-level rare-disease evidence for an HGNC symbol
- `decipher_syndromes` — recurrent CNV syndrome regions with GRCh38 coordinates and dosage scores
- `decipher_cnv_frequency` — population CNV frequency (AC/AF/AN) for a genomic region
- `decipher_patient` — **retired**: always returns `NOT_SUPPORTED`, see *Data access* below
- `decipher_search` — discover available API operations (Code Mode catalog search, 13 endpoints)
- `decipher_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `decipher_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `decipher_get_schema` — inspect the inferred schema of a staged dataset

## Data access

DECIPHER has no openly programmable surface, so this server reads the openly-published
mirrors by default and names the upstream in every response.

| Surface | Status | Default route |
| --- | --- | --- |
| `deciphergenomics.org/data/*` | Keyless but gated by a **same-origin `Referer` check** — without it every path returns `403 {"error":"Access Denied"}` | Not used unless `DECIPHER_SEND_REFERER=1` |
| `deciphergenomics.org/api/*` | Sanctioned JSON:API, `403 {"detail":"Client key not provided"}` without a Client API Key | Not used unless `DECIPHER_CLIENT_KEY` is set |
| [EBI Gene2Phenotype](https://www.ebi.ac.uk/gene2phenotype/api/) | Keyless, openly published | `decipher_gene_lookup`, `/mirror/g2p/*` |
| [ClinGen region curation](https://ftp.clinicalgenome.org/ClinGen_region_curation_list_GRCh38.tsv) | Keyless, openly published | `decipher_syndromes`, `/mirror/clingen/regions` |
| [dbVar nstd183](https://ftp.ncbi.nlm.nih.gov/pub/dbVar/data/Homo_sapiens/by_study/tsv/) — DECIPHER Consensus CNVs | Keyless, deposited by DECIPHER at NCBI | `decipher_cnv_frequency`, `/mirror/dbvar/nstd183/calls` |

### `DECIPHER_SEND_REFERER` (opt-in, default `0`)

Set it to `1` in `wrangler.jsonc` to send `Referer: https://www.deciphergenomics.org/` on
`/data/*` calls, which unlocks DECIPHER's own composite gene record (HI score, `p_hi`/`p_ts`,
`s_het`, pLI, LOEUF, `protein_mechanism_data`) and its ~96 named CNV syndromes. It is **off by
default on purpose**: asserting an origin we do not have satisfies an access control DECIPHER
added deliberately, and that is the deployer's decision to make, not this code's.

### `DECIPHER_CLIENT_KEY` (secret, unset)

The credential seam for the sanctioned JSON:API:

```bash
pnpm --filter decipher-mcp-server exec wrangler secret put DECIPHER_CLIENT_KEY
```

Request a key from <contact@deciphergenomics.org>, citing
<https://www.deciphergenomics.org/api-docs>.

Two details here are **unconfirmed from outside**, and are marked as such in
`src/lib/http.ts` rather than asserted:

- *How a key is granted.* An earlier version of this README said "only after a signed API
  Agreement". That page answers 200 but renders client-side, and its server-rendered HTML
  contains no such statement (checked 2026-08-27). The only hard fact is the
  `403 {"detail":"Client key not provided"}` every `/api/*` path returns today.
- *The header the key travels in* (`X-Client-Key`). A bogus key under every plausible header
  and query param returns the identical "Client key not provided", so no probe distinguishes
  them. Confirm it when a real key arrives; it is a one-line change in `src/lib/http.ts`.

### What Code Mode can reach

`decipher_execute` validates every `api.get()` path against the catalog in
`src/spec/catalog.ts` **before** the request leaves the Worker, so a path with no catalog
entry fails with `Unknown endpoint … does not exist` and never reaches DECIPHER. The
catalog therefore lists all 13 reachable paths:

| Path | Reachable | Notes |
| --- | --- | --- |
| `/mirror/g2p/gene/{symbol}/`, `…/summary/`, `/mirror/g2p/search/`, `/mirror/g2p/panels/` | always | keyless EBI Gene2Phenotype |
| `/mirror/clingen/regions`, `/mirror/dbvar/nstd183/calls` | always | keyless ClinGen / dbVar |
| `/data/gene/{symbol}`, `/data/gene/{symbol}/g2p`, `/data/syndromes`, `/data/syndrome/{id}` | `DECIPHER_SEND_REFERER=1` | otherwise the real upstream `403 {"error":"Access Denied"}` is returned |
| `/api/{resource}`, `/api/{resource}/{id}` | `DECIPHER_CLIENT_KEY` | otherwise the real upstream `403 {"detail":"Client key not provided"}` |
| `/data/patient/{id}` | **never** | listed only so the isolate gets this server's `451` refusal instead of a misleading `404` |

A path parameter matches exactly one segment, so a member path needs its own entry —
`/api/{resource}` alone cannot serve `/api/genes/BRCA1`, which is why `/api/{resource}/{id}`
exists. `robots.txt` disallows the per-gene `protein` and `phenotypes` sub-paths, and they are
deliberately absent.

### Patient data is out of scope

`decipher_patient` is retired and makes no upstream request. `robots.txt` disallows
`/data/patient/`, and Terms of Use clause 5 states: *"No attempt should be made to copy patient
data from the website. Access to DECIPHER patient data in bulk may be obtained from DECIPHER and
is subject to a Data Access Agreement or a Data Display Agreement."* The endpoints do answer
once a Referer is sent — which is exactly why the refusal is in code rather than behind the
flag. Use `decipher_cnv_frequency` for population CNV frequency.

### Known limits

- `decipher_gene_lookup` on the default path reads the curated disease records from a
  *second* Gene2Phenotype endpoint. If that call fails, the response carries
  `g2p_records: null`, `record_count: null` and `g2p_records_unavailable: true` — never an
  empty list, which would be indistinguishable from a gene G2P genuinely curates nothing for.
- `decipher_cnv_frequency` re-downloads and re-parses the whole dbVar `nstd183` study file
  (3,199,833 bytes gzipped, 67,142 calls) on **every** call; there is no cache between calls.
  The reason it is not routed through the shared Worker cache is recorded at
  `fetchDbVarCnvCalls` in `src/lib/mirrors.ts`.

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Development

```bash
./scripts/dev-servers.sh decipher            # run locally (port 8826)
pnpm --filter decipher-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*
