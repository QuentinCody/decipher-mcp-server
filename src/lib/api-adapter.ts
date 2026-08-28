/**
 * DECIPHER API adapter — the ApiFetchFn behind Code Mode's api.get/api.post.
 *
 * One path space, four upstreams, chosen by prefix:
 *
 *   /mirror/g2p/...        → EBI Gene2Phenotype        (keyless, default path)
 *   /mirror/clingen/...    → ClinGen dosage curation   (keyless, default path)
 *   /mirror/dbvar/...      → NCBI dbVar nstd183        (keyless, default path)
 *   /data/...              → DECIPHER internal JSON    (403 unless DECIPHER_SEND_REFERER=1)
 *   /api/...               → DECIPHER JSON:API         (403 unless DECIPHER_CLIENT_KEY is set)
 *
 * /data/patient/* is refused here with 451, not just left to 403: robots.txt
 * disallows it and Terms of Use clause 5 forbids copying patient data from the
 * website, so the Referer opt-in must not re-open it through Code Mode either.
 *
 * TWO STOPS, IN THIS ORDER. On the Code Mode path the shared catalog validator
 * (preflightUnknownEndpoint) runs BEFORE this adapter and rejects any path with
 * no catalog entry. /data/patient/{id} is therefore listed in ../spec/catalog.ts
 * — without the entry the isolate got "Unknown endpoint … does not exist",
 * which is false (the path exists upstream) and hides the reason for the
 * refusal. With the entry the call reaches the 451 below and the caller gets
 * the robots.txt + Terms of Use explanation. The 451 is also the ONLY stop for
 * callers that do not go through the catalog validator — anything holding this
 * ApiFetchFn directly — so it is defence in depth, not dead code.
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import { type DecipherAccess, decipherFetch, decipherPost } from "./http";
import { G2P_BASE, fetchClinGenRegions, fetchDbVarCnvCalls } from "./mirrors";

const ROUTES =
	"/mirror/g2p/{path}, /mirror/clingen/regions, /mirror/dbvar/nstd183/calls, " +
	"/data/{path} (needs DECIPHER_SEND_REFERER=1), /api/{path} (needs DECIPHER_CLIENT_KEY)";

function httpError(status: number, message: string, data?: unknown): never {
	const error = new Error(message) as Error & { status: number; data: unknown };
	error.status = status;
	error.data = data ?? message;
	throw error;
}

/** Read a required numeric query param for the dbVar region route. */
function requireNumber(
	params: Record<string, unknown> | undefined,
	key: string,
): number {
	const value = Number(params?.[key]);
	if (!Number.isFinite(value)) {
		httpError(
			400,
			`/mirror/dbvar/nstd183/calls requires a numeric '${key}' param — ` +
				"e.g. api.get('/mirror/dbvar/nstd183/calls', { chr: '22', start: 18900000, end: 21500000 })",
		);
	}
	return value;
}

export function createDecipherApiFetch(access: DecipherAccess): ApiFetchFn {
	return async (request) => {
		const path = request.path.startsWith("/") ? request.path : `/${request.path}`;

		if (path.startsWith("/data/patient")) {
			httpError(
				451,
				"DECIPHER patient data is out of scope for this server: robots.txt disallows " +
					"/data/patient/ and Terms of Use clause 5 forbids copying patient data from the " +
					"website. Use /mirror/dbvar/nstd183/calls for population CNV frequency.",
			);
		}

		if (path.startsWith("/mirror/")) {
			return fetchMirror(path, request.params);
		}

		if (path.startsWith("/data/") || path.startsWith("/api/")) {
			return fetchDecipher(path, request, access);
		}

		httpError(
			404,
			`Unknown path '${path}'. Available routes: ${ROUTES}`,
		);
	};
}

async function fetchMirror(
	path: string,
	params: Record<string, unknown> | undefined,
): Promise<{ status: number; data: unknown }> {
	if (path.startsWith("/mirror/g2p/")) {
		const upstreamPath = path.slice("/mirror/g2p".length);
		const response = await restFetch(G2P_BASE, upstreamPath, params, {
			timeout: 15_000,
			deadlineMs: 30_000,
		});
		const body = await response.text();
		if (!response.ok) {
			httpError(
				response.status,
				`Gene2Phenotype HTTP ${response.status}: ${body.slice(0, 200)}`,
				body,
			);
		}
		try {
			return { status: response.status, data: JSON.parse(body) };
		} catch {
			return { status: response.status, data: body };
		}
	}

	if (path === "/mirror/clingen/regions") {
		const regions = await fetchClinGenRegions();
		return {
			status: 200,
			data: { region_count: regions.length, regions },
		};
	}

	if (path === "/mirror/dbvar/nstd183/calls") {
		const result = await fetchDbVarCnvCalls({
			chr: String(params?.chr ?? "").replace(/^chr/i, ""),
			start: requireNumber(params, "start"),
			end: requireNumber(params, "end"),
			variantType: params?.variant_type
				? String(params.variant_type)
				: undefined,
			minAlleleFrequency:
				params?.min_allele_frequency === undefined
					? undefined
					: Number(params.min_allele_frequency),
			limit: params?.limit === undefined ? undefined : Number(params.limit),
		});
		return { status: 200, data: result };
	}

	return httpError(404, `Unknown mirror path '${path}'. Available routes: ${ROUTES}`);
}

async function fetchDecipher(
	path: string,
	request: { method: string; params?: Record<string, unknown>; body?: unknown },
	access: DecipherAccess,
): Promise<{ status: number; data: unknown }> {
	const response =
		request.method === "POST"
			? await decipherPost(path, request.body as object, { access })
			: await decipherFetch(path, request.params, { access });

	if (!response.ok) {
		const errorBody = await response.text().catch(() => response.statusText);

		let hint = "";
		if (response.status === 403 && path.startsWith("/data/")) {
			hint =
				" — DECIPHER's /data/ endpoints enforce a same-origin Referer check. This server " +
				"sends no Referer unless the deployment sets DECIPHER_SEND_REFERER=1. Use the " +
				"keyless mirrors instead: /mirror/g2p/gene/{symbol}/summary/, " +
				"/mirror/clingen/regions, /mirror/dbvar/nstd183/calls";
		} else if (response.status === 403) {
			hint =
				" — DECIPHER's /api/ JSON:API requires a Client API Key (DECIPHER_CLIENT_KEY). " +
				"Request one from DECIPHER (contact@deciphergenomics.org, " +
				"https://www.deciphergenomics.org/api-docs); how a key is granted is not " +
				"stated on any page reachable without one.";
		} else if (response.status === 404) {
			hint =
				" — known DECIPHER paths: /data/gene/{symbol}, /data/gene/{symbol}/g2p, " +
				"/data/syndromes, /data/syndrome/{id}";
		}

		httpError(
			response.status,
			`HTTP ${response.status}: ${errorBody.slice(0, 200)}${hint}`,
			errorBody,
		);
	}

	const contentType = response.headers.get("content-type") || "";
	if (!contentType.includes("json")) {
		return { status: response.status, data: await response.text() };
	}
	return { status: response.status, data: await response.json() };
}
