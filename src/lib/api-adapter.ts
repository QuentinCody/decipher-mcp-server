/**
 * DECIPHER API adapter — wraps decipherFetch/decipherPost into the ApiFetchFn
 * interface for use by the Code Mode __api_proxy tool.
 *
 * Routes through the internal /data/ endpoints on deciphergenomics.org.
 * No authentication required for open-access data.
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { decipherFetch, decipherPost } from "./http";

/**
 * Create an ApiFetchFn that routes through decipherFetch/decipherPost.
 * The base URL is https://www.deciphergenomics.org — all paths should
 * start with /data/ (e.g. /data/gene/BRCA1, /data/patient/255882).
 */
export function createDecipherApiFetch(): ApiFetchFn {
	return async (request) => {
		let response: Response;

		if (request.method === "POST") {
			response = await decipherPost(request.path, request.body as object);
		} else {
			response = await decipherFetch(request.path, request.params);
		}

		if (!response.ok) {
			let errorBody: string;
			try {
				errorBody = await response.text();
			} catch {
				errorBody = response.statusText;
			}

			// Provide a helpful error message for common failures
			const hint =
				response.status === 404
					? " — DECIPHER's internal data endpoints are undocumented and may have changed. " +
						"Known working paths: /data/patient/{id}, /data/patient/{id}/phenotypes, " +
						"/data/patient/{id}/variants, /data/gene/{symbol}, /data/gene/{symbol}/g2p, " +
						"/data/syndromes, /data/syndrome/{id}"
					: response.status === 403
						? " — This endpoint may require DECIPHER login for non-open-access data"
						: "";

			const error = new Error(
				`HTTP ${response.status}: ${errorBody.slice(0, 200)}${hint}`,
			) as Error & {
				status: number;
				data: unknown;
			};
			error.status = response.status;
			error.data = errorBody;
			throw error;
		}

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("json")) {
			const text = await response.text();
			return { status: response.status, data: text };
		}

		const data = await response.json();
		return { status: response.status, data };
	};
}
