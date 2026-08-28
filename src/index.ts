import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { registerGeneLookup } from "./tools/gene-lookup";
import { registerSyndromes } from "./tools/syndromes";
import { registerCnvFrequency } from "./tools/cnv-frequency";
import { registerPatient } from "./tools/patient";
import { type DecipherAccessEnv, readDecipherAccess } from "./lib/http";
import { DecipherDataDO } from "./do";

// Export Durable Object classes
export { DecipherDataDO };

interface DecipherEnv extends DecipherAccessEnv {
    DECIPHER_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
    /** OPT-IN, default off — send `Referer: <baseUrl>/` on DECIPHER /data/* calls. */
    DECIPHER_SEND_REFERER?: string;
    /** Secret. Credential seam for DECIPHER's sanctioned /api/* JSON:API. */
    DECIPHER_CLIENT_KEY?: string;
}

export class MyMCP extends StatelessMcpWorker {
    server = new McpServer({
        name: "decipher",
        version: "0.3.0",
    });

    async init() {

    	configureCitationSigning(this.env);
        const env = this.env as unknown as DecipherEnv;
        // Resolved once per instance: no Referer and no client key unless the
        // deployment sets them. See src/lib/http.ts for why the default is off.
        const access = readDecipherAccess(env);

        // Hand-built direct tools
        registerGeneLookup(this.server, env, access);
        registerSyndromes(this.server, env, access);
        registerCnvFrequency(this.server, env);
        // Retired on purpose (robots.txt + Terms of Use clause 5) — returns
        // NOT_SUPPORTED and makes no upstream request under either flag.
        registerPatient(this.server);

        // Staging tools
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);

        // Code Mode tools (search catalog + V8 isolate execute)
        registerCodeMode(this.server, env, access);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return buildHealthResponse("decipher");
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};
