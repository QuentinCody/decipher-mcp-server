/**
 * DECIPHER internal data API HTTP client.
 *
 * DECIPHER does NOT have a documented public REST API. However, the
 * deciphergenomics.org Nuxt.js frontend exposes internal data endpoints
 * under /data/ that return JSON. These endpoints are used by the SSR
 * layer and are accessible without authentication for open-access data.
 *
 * Known working endpoints (discovered via testing, March 2026):
 *   GET /data/patient/{id}           — patient demographics, family, counts
 *   GET /data/patient/{id}/phenotypes — HPO phenotypes for a patient
 *   GET /data/patient/{id}/variants  — variants (CNVs) for a patient
 *   GET /data/gene/{symbol}          — comprehensive gene info (HI, constraint, diseases)
 *   GET /data/gene/{symbol}/g2p      — gene-to-phenotype associations
 *   GET /data/syndromes              — all CNV syndromes with genomic coordinates
 *   GET /data/syndrome/{id}          — syndrome detail with genes, phenotypes, variants
 *
 * IMPORTANT: These are undocumented internal endpoints. They may change
 * without notice. There is no rate-limit documentation — be conservative.
 */

import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const DECIPHER_BASE = "https://www.deciphergenomics.org";

export interface DecipherFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	/** Override base URL */
	baseUrl?: string;
	/** Content type for the request */
	contentType?: string;
}

/**
 * Fetch from the DECIPHER internal data API with retry handling.
 */
export async function decipherFetch(
	path: string,
	params?: Record<string, unknown>,
	opts?: DecipherFetchOptions,
): Promise<Response> {
	const baseUrl = opts?.baseUrl ?? DECIPHER_BASE;
	const headers: Record<string, string> = {
		Accept: "application/json",
		...(opts?.headers ?? {}),
	};

	return restFetch(baseUrl, path, params, {
		...opts,
		headers,
		retryOn: [429, 500, 502, 503],
		retries: opts?.retries ?? 3,
		timeout: opts?.timeout ?? 30_000,
		userAgent:
			"decipher-mcp-server/1.0 (bio-mcp; https://github.com/QuentinCody/decipher-mcp-server)",
	});
}

/**
 * POST to the DECIPHER internal data API.
 */
export async function decipherPost(
	path: string,
	body: object,
	opts?: DecipherFetchOptions,
): Promise<Response> {
	const baseUrl = opts?.baseUrl ?? DECIPHER_BASE;
	const headers: Record<string, string> = {
		"Content-Type": opts?.contentType ?? "application/json",
		Accept: "application/json",
		...(opts?.headers ?? {}),
	};

	return restFetch(baseUrl, path, undefined, {
		...opts,
		method: "POST",
		headers,
		body,
		retryOn: [429, 500, 502, 503],
		retries: opts?.retries ?? 3,
		timeout: opts?.timeout ?? 30_000,
		userAgent: "decipher-mcp-server/1.0",
	});
}
