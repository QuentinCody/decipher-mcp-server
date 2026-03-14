/**
 * DECIPHER API HTTP client.
 *
 * DECIPHER open-access API is public (no auth required).
 * Rate limits are not strictly documented but we apply reasonable backoff.
 */

import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const DECIPHER_BASE = "https://www.deciphergenomics.org/ddd/openaccess/api";

export interface DecipherFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	/** Override base URL */
	baseUrl?: string;
	/** Content type for the request */
	contentType?: string;
}

/**
 * Fetch from the DECIPHER open-access API with retry handling.
 */
export async function decipherFetch(
	path: string,
	params?: Record<string, unknown>,
	opts?: DecipherFetchOptions,
): Promise<Response> {
	const baseUrl = opts?.baseUrl ?? DECIPHER_BASE;
	const headers: Record<string, string> = {
		"Content-Type": opts?.contentType ?? "application/json",
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
 * POST to the DECIPHER open-access API.
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
