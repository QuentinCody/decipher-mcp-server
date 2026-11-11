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
- `decipher_search` — discover available API operations (Code Mode catalog search, 16 endpoints)
- `decipher_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `searchSpec()`); this server catalogs bodyless GET operations
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
catalog therefore lists 16 paths:

| Path | Reachable | Notes |
| --- | --- | --- |
| `/mirror/g2p/gene/{symbol}/`, `…/summary/`, `/mirror/g2p/search/`, `/mirror/g2p/panels/` | always | keyless EBI Gene2Phenotype |
| `/mirror/g2p/lgd/{stable_id}/`, `/mirror/g2p/molecular_mechanisms/`, `/mirror/g2p/reference_data/` | public reads verified October 4, 2026 | full G2P evidence, terminology and reference versions |
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

- Public alternatives are separate datasets: ClinGen dosage regions are not
  DECIPHER syndrome records, and G2P curated associations are not DECIPHER
  patient-level data. Keep source identity, assembly and dates when joining.

- `decipher_gene_lookup` on the default path reads the curated disease records from a
  *second* Gene2Phenotype endpoint. If that call fails, the response carries
  `g2p_records: null`, `record_count: null` and `g2p_records_unavailable: true` — never an
  empty list, which would be indistinguishable from a gene G2P genuinely curates nothing for.
- `decipher_cnv_frequency` reads the whole bounded dbVar `nstd183` study file on every
  call; it does not cache across calls. The October 4 capture contains **67,142 placement
  rows for 62,074 distinct call accessions**, with 36 native columns. These are not counts
  of people. [NCBI identifies the source as a February 2020 control set](https://www.ncbi.nlm.nih.gov/dbvar/studies/nstd183/),
  submitted on GRCh37 and remapped to GRCh38.p12; the retrieval date is not a new study release.
- Chromosome queries select primary-chromosome placements by default. Pass an exact
  `contig` accession for alternate-sequence coordinates. The captured chromosome 22 data
  contains 1,258 primary rows and 106 alternate rows. Combining those coordinate systems
  can create false overlaps. Coordinates are 1-based inclusive; native placement columns,
  HGVS, remap flags and tagged AC/AF/AN strings remain in `native_fields` and `native_tsv`.
  `matched`, `returned`, `truncated` and `file_scan` distinguish a bounded selection from
  the complete file scan. Frequencies keep their study-specific denominators.
- ClinGen results retain the complete TSV, all 23 native columns, disease IDs, PMID slots
  and source line numbers. A filtered result carries `match_count` as well as the full
  file's `region_count`. These independently curated dosage regions are not DECIPHER syndromes.
- Public reads reject redirects, malformed bodies, excessive bytes and stalled response
  bodies. G2P reads allow 4 MiB/30 seconds; combined gene/summary reads share 45 seconds;
  ClinGen allows 4 MiB/40 seconds; dbVar allows 8 MiB compressed/45 seconds and 64 MiB expanded.
  Native errors and exact-body SHA-256 receipts are retained when a response completes.

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool has both `decipher_` and `mcp_decipher_` names and returns `content` and
`structuredContent`, including cited errors with `isError: true`. Staging preserves the
complete composed response in `payloads`; `response_context` preserves the underlying data.
SQL tables include `g2p_records`, `g2p_associations`, `mechanism_evidence`,
`g2p_publications`, `mined_publications`, `clingen_regions` and `cnv_calls` when present.
Each projected row carries `native_json` and `source_path`; mechanism/publication rows
also carry the parent `g2p_stable_id`. Future wide rows split into groups of 80 columns,
joined by `source_path`. Inspect `decipher_get_schema` before querying.

### Full G2P mechanism evidence

Gene lookup returns **summaries**. Follow a returned `stable_id` to the full
Locus-Genotype-Mechanism-Disease-Evidence record with `decipher_execute`:

```javascript
const record = await api.get('/mirror/g2p/lgd/G2P03507/');
return { source: 'EBI Gene2Phenotype', record };
```

The native response preserves mechanism support and synopsis, functional studies
grouped by publication, variant consequence/type/description, confidence,
review status and dates. Keep inferred versus evidenced support distinct, and
curated publications separate from mined/rejected publications. Null evidence
or dates remain unknown; do not infer a mechanism from a gene symbol alone.

Use `/mirror/g2p/molecular_mechanisms/` to discover terminology and
`/mirror/g2p/reference_data/` for dependency versions. Those versions and the
API schema version do not pin G2P curation content. A stable ID identifies a
record, not an immutable revision. Preserve its native dates and retrieved data
for reproducibility. Large records stage with their complete native payload;
use `decipher_get_schema` and `decipher_query_data` with the returned handle.
Code Mode and staging tools also have `mcp_decipher_` aliases, with an explicit
30 KiB inline/staging threshold and 60-second execution limit. Gene lookup sizes
its staging decision in UTF-8 bytes.

The three read routes are documented in the [provider OpenAPI](https://github.com/EBI-G2P/gene2phenotype_api/blob/main/gene2phenotype_project/schema.json)
and [route definitions](https://github.com/EBI-G2P/gene2phenotype_api/blob/main/gene2phenotype_project/gene2phenotype_app/urls.py).
Reviewed September 29, 2026. The G2P mechanism redesign dates to
[February 2025](https://www.ebi.ac.uk/about/news/updates-from-data-resources/new-look-gene2phenotype-website/).
DECIPHER's [June 2026](https://www.ebi.ac.uk/about/news/updates-from-data-resources/decipher-v11-39-released/)
and [July 2026](https://www.ebi.ac.uk/about/news/updates-from-data-resources/decipher-v11-40-released/)
news describes new interface content, including N=1 assessments, guideline links,
regional nonsense constraint and updated NMD/ClinVar displays. Those announcements
do not verify new public read endpoints. Access policy and patient-data exclusions
remain as documented above.

G2P search accepts optional `type: 'gene' | 'disease' | 'phenotype' | 'stable_id'`,
plus a separate `panel` filter and 1-based `page`. Omitting `type` performs generic search.
Keep native `count`, `next` and `previous`; a single page is not complete discovery.

Native public-provider reads and local Worker/Code Mode/SQLite acceptance were completed
October 4, 2026; see the [dated review](../../docs/audits/2026-10-04-decipher-review.md).
This supersedes the September 29 local/live verification blocker. These changes have not
been deployed. No credential or Referer flag was enabled, and no patient data was requested.

## Development

```bash
./scripts/dev-servers.sh decipher            # run locally (port 8826)
pnpm --filter decipher-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from DECIPHER + G2P / ClinGen / dbVar and stays under the terms of that source: DECIPHER data: display-only, no bulk download; others open.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
