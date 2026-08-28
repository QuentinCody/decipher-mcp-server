import { describe, expect, it } from "vitest";
import { buildDecipherHeaders, readDecipherAccess } from "./http";

// The Referer is an OPT-IN. DECIPHER added a same-origin check to /data/*
// after this server was written, and sending a Referer we do not have is an
// operator's decision, not a default. These tests exist so the default cannot
// drift back to "always send it" without going red.
describe("readDecipherAccess (DECIPHER_SEND_REFERER is opt-in)", () => {
	it("defaults to no Referer when the var is absent", () => {
		expect(readDecipherAccess({}).sendReferer).toBe(false);
		expect(readDecipherAccess(undefined).sendReferer).toBe(false);
	});

	it("stays off for the deployed default of '0' and for junk values", () => {
		expect(readDecipherAccess({ DECIPHER_SEND_REFERER: "0" }).sendReferer).toBe(false);
		expect(readDecipherAccess({ DECIPHER_SEND_REFERER: "" }).sendReferer).toBe(false);
		expect(readDecipherAccess({ DECIPHER_SEND_REFERER: "maybe" }).sendReferer).toBe(false);
	});

	it("turns on only for an explicit truthy value", () => {
		for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
			expect(readDecipherAccess({ DECIPHER_SEND_REFERER: value }).sendReferer).toBe(true);
		}
	});

	it("carries a client key through only when one is set", () => {
		expect(readDecipherAccess({}).clientKey).toBeUndefined();
		expect(readDecipherAccess({ DECIPHER_CLIENT_KEY: "   " }).clientKey).toBeUndefined();
		expect(readDecipherAccess({ DECIPHER_CLIENT_KEY: " k123 " }).clientKey).toBe("k123");
	});
});

describe("buildDecipherHeaders", () => {
	const base = "https://www.deciphergenomics.org";

	it("sends NO Referer by default", () => {
		const headers = buildDecipherHeaders(base, readDecipherAccess({}));
		expect(headers.Referer).toBeUndefined();
		expect(Object.keys(headers)).toEqual(["Accept"]);
	});

	it("sends the same-origin Referer once the operator opts in", () => {
		const headers = buildDecipherHeaders(
			base,
			readDecipherAccess({ DECIPHER_SEND_REFERER: "1" }),
		);
		// Origin, with the trailing slash — a foreign Referer is rejected too.
		expect(headers.Referer).toBe("https://www.deciphergenomics.org/");
	});

	it("attaches the client key only when one is configured", () => {
		expect(
			buildDecipherHeaders(base, readDecipherAccess({}))["X-Client-Key"],
		).toBeUndefined();
		expect(
			buildDecipherHeaders(
				base,
				readDecipherAccess({ DECIPHER_CLIENT_KEY: "k123" }),
			)["X-Client-Key"],
		).toBe("k123");
	});

	it("keeps caller headers and does not lose them to the access headers", () => {
		const headers = buildDecipherHeaders(base, readDecipherAccess({}), {
			"Content-Type": "application/json",
		});
		expect(headers["Content-Type"]).toBe("application/json");
		expect(headers.Accept).toBe("application/json");
	});
});
