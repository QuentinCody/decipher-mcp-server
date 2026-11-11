import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { decipherSchemaHints, decipherTables } from "./lib/staging";

export class DecipherDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    return value === null || typeof value !== "object" ? value : decipherTables(value);
  }
  protected getSchemaHints(value: unknown) { return decipherSchemaHints(value); }
}
