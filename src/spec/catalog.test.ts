import {
	buildKnownEndpointIndex,
	preflightUnknownEndpoint,
} from "@bio-mcp/shared/tools/api-proxy-drift";
import { describe, expect, it } from "vitest";
import { decipherCatalog } from "./catalog";

// The Code Mode isolate never reaches this server's ApiFetchFn for a path the
// shared catalog validator rejects first: preflightUnknownEndpoint blocks any
// path that has no catalog entry but does have a sibling under the same first
// segment, and a `{param}` template matches exactly ONE segment ([^/]+).
//
// That is how `/api/genes/BRCA1` — the worked example the catalog printed for
// `/api/{resource}` — died inside the Worker with "Unknown endpoint … does not
// exist", and how `/data/patient/255882` got the same bogus 404 instead of this
// server's 451 Terms-of-Use refusal. These tests use the REAL validator, so a
// catalog entry whose own example cannot run goes red here.
const index = buildKnownEndpointIndex(decipherCatalog);

/** Paths pulled out of every `api.get('<path>'…)` in the catalog's examples. */
function examplePaths(): string[] {
	const paths: string[] = [];
	for (const endpoint of decipherCatalog.endpoints) {
		const example = endpoint.example;
		if (!example) continue;
		for (const match of example.matchAll(/api\.(?:get|post)\('([^']+)'/g)) {
			paths.push(match[1]);
		}
	}
	return paths;
}

describe("decipherCatalog reachability (shared validator, not a re-implementation)", () => {
	it("declares as many endpoints as it lists", () => {
		expect(decipherCatalog.endpointCount).toBe(decipherCatalog.endpoints.length);
	});

	it("ships at least one runnable worked example", () => {
		expect(examplePaths().length).toBeGreaterThan(0);
	});

	it("resolves EVERY path used in its own worked examples", () => {
		for (const path of examplePaths()) {
			const blocked = preflightUnknownEndpoint("GET", path, index);
			expect(
				blocked?.message ?? null,
				`catalog example '${path}' is rejected by the validator before it leaves the Worker`,
			).toBeNull();
		}
	});

	it.each([
		["/mirror/g2p/gene/BRCA1/", "keyless gene record"],
		["/mirror/g2p/gene/BRCA1/summary/", "keyless curated records"],
		["/mirror/clingen/regions", "ClinGen region list"],
		["/mirror/dbvar/nstd183/calls", "dbVar CNV calls"],
		["/data/gene/BRCA1", "gated composite record"],
		["/data/gene/BRCA1/g2p", "gated G2P block"],
		["/data/syndromes", "gated syndrome list"],
		["/data/syndrome/1", "gated single syndrome"],
		["/api/genes", "JSON:API collection"],
		["/api/genes/BRCA1", "JSON:API member"],
	])("lets %s reach the adapter (%s)", (path) => {
		expect(preflightUnknownEndpoint("GET", path, index)).toBeUndefined();
	});

	// The refusal only reaches the caller if the validator lets the call
	// through: with no catalog entry the isolate is told the path "does not
	// exist", which is false and hides the Terms of Use reason.
	it("lets /data/patient/{id} reach the adapter, where it is refused with 451", () => {
		expect(preflightUnknownEndpoint("GET", "/data/patient/255882", index)).toBeUndefined();
		const entry = decipherCatalog.endpoints.find((e) => e.path === "/data/patient/{id}");
		expect(entry?.summary).toMatch(/REFUSED BY THIS SERVER/);
		expect(entry?.summary).toMatch(/451/);
	});

	// Control: the validator really does block, so the assertions above are not
	// vacuous. robots.txt disallows the per-gene protein sub-path and the
	// catalog deliberately omits it.
	it("still blocks a path the catalog deliberately omits", () => {
		const blocked = preflightUnknownEndpoint("GET", "/data/gene/BRCA1/protein", index);
		expect(blocked?.message).toContain("Unknown endpoint");
	});
});
