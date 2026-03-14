import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { registerGeneLookup } from "./tools/gene-lookup";
import { registerSyndromes } from "./tools/syndromes";
import { registerPatient } from "./tools/patient";
import { DecipherDataDO } from "./do";

// Export Durable Object classes
export { DecipherDataDO };

interface DecipherEnv {
    DECIPHER_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export class MyMCP extends McpAgent {
    server: any = new McpServer({
        name: "decipher",
        version: "0.2.0",
    });

    async init() {
        const env = this.env as unknown as DecipherEnv;

        // Hand-built direct tools
        registerGeneLookup(this.server, env);
        registerSyndromes(this.server, env);
        registerPatient(this.server, env);

        // Staging tools
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);

        // Code Mode tools (search catalog + V8 isolate execute)
        registerCodeMode(this.server, env);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return new Response("ok", {
                status: 200,
                headers: { "content-type": "text/plain" },
            });
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp", { binding: "MCP_OBJECT" }).fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};
