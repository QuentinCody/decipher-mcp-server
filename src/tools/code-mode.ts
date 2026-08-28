/**
 * DECIPHER Code Mode — registers search + execute tools for full API access.
 *
 * search: In-process catalog query, returns matching endpoints with docs.
 * execute: V8 isolate with api.get/api.post + searchSpec/listCategories.
 *
 * api.get routes by path prefix: /mirror/* reaches the keyless upstreams,
 * /data/* and /api/* reach DECIPHER under the access policy in ../lib/http.ts.
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { decipherCatalog } from "../spec/catalog";
import { createDecipherApiFetch } from "../lib/api-adapter";
import type { DecipherAccess } from "../lib/http";

interface CodeModeEnv {
	DECIPHER_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

/**
 * Register decipher_search and decipher_execute tools.
 */
export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
	access: DecipherAccess,
): void {
	const apiFetch = createDecipherApiFetch(access);

	// Register the search tool (in-process, no isolate)
	const searchTool = createSearchTool({
		prefix: "decipher",
		catalog: decipherCatalog,
	});
	searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

	// Register the execute tool (V8 isolate via DynamicWorkerExecutor)
	const executeTool = createExecuteTool({
		prefix: "decipher",
		// Verifiable provenance: decipher_execute results carry a _meta.citation.
		// The name spells out the federation because the default data path is the
		// open mirrors, not deciphergenomics.org — a citation that just said
		// "DECIPHER" would misattribute every keyless result.
		source: {
			id: "decipher",
			name:
				"DECIPHER server — open mirrors (EBI Gene2Phenotype, ClinGen dosage " +
				"curation, dbVar nstd183) plus DECIPHER's own Referer-gated endpoints",
			url: "https://www.deciphergenomics.org",
		},
		catalog: decipherCatalog,
		apiFetch,
		doNamespace: env.DECIPHER_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
