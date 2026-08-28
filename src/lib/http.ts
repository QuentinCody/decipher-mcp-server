/**
 * DECIPHER HTTP client — and the access policy that governs it.
 *
 * DECIPHER exposes two surfaces, and NEITHER is openly programmable:
 *
 *   1. /data/*  — the deciphergenomics.org Nuxt frontend's internal JSON
 *      endpoints. Keyless, but they enforce a SAME-ORIGIN Referer check:
 *      a request with no Referer returns 403 {"error":"Access Denied"};
 *      the identical request with `Referer: https://www.deciphergenomics.org/`
 *      returns 200. A foreign Referer is rejected too, so the check is on the
 *      Referer ORIGIN, not on its presence. User-Agent has no effect.
 *      (Verified live 2026-08-27; the catalog's old "verified working, no
 *      auth, March 2026" note predates the guard.)
 *   2. /api/*   — the sanctioned JSON:API. It answers
 *      403 {"detail":"Client key not provided"} even with a valid Referer.
 *      A Client API Key is requested from DECIPHER. UNCONFIRMED FROM OUTSIDE:
 *      that a key needs a SIGNED API AGREEMENT is not stated on any page this
 *      server can fetch — https://www.deciphergenomics.org/api-docs answers 200
 *      but renders client-side, and its SSR HTML contains no such statement
 *      (checked 2026-08-27). The one hard fact is the 403 body above.
 *
 * DEFAULT BEHAVIOUR: this server sends NO Referer. Sending one asserts an
 * origin we do not have and satisfies an access control DECIPHER added
 * deliberately, which is a deployer's decision and not this code's. The
 * default data path is therefore the openly-published mirrors in ./mirrors.ts
 * (EBI Gene2Phenotype, ClinGen dosage curation, dbVar nstd183) — real
 * upstreams, published for programmatic use, no origin assertion.
 *
 * Env flags (both read in src/index.ts, threaded in as `DecipherAccess`):
 *
 *   DECIPHER_SEND_REFERER — OPT-IN, DEFAULT OFF. When it is "1"/"true"/"yes"/
 *      "on", every /data/* request carries `Referer: <baseUrl>/` and DECIPHER's
 *      own composite gene record (hi_score, s_het, protein_mechanism_data, …)
 *      becomes reachable again. When it is off — the default — no Referer
 *      header is sent at all and the /data/* paths return 403 by design.
 *      Off by default because "green by asserting a false origin" is a policy
 *      call the operator must make explicitly.
 *
 *   DECIPHER_CLIENT_KEY — the credential seam for the sanctioned /api/* JSON:API.
 *      Unset today (no key has been issued). See README for how to request one.
 *
 * Patient endpoints are NOT reachable through this client under either flag:
 * robots.txt disallows /data/patient/ and Terms of Use clause 5 forbids copying
 * patient data from the website. See src/tools/patient.ts.
 */

import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const DECIPHER_BASE = "https://www.deciphergenomics.org";

/**
 * Header the DECIPHER Client API Key is sent under.
 *
 * UNVERIFIED: the exact name could not be discovered from the outside —
 * /api/genes/BRCA1 answers "Client key not provided" identically for a bogus
 * key sent as X-Client-Key, client-key, X-Api-Key, Authorization: Bearer, and
 * as a ?client_key= / ?key= query param, so no probe distinguishes them.
 * Confirm it against the API Agreement docs when a real key is issued; it is a
 * one-line change here and nothing else depends on the name.
 */
const CLIENT_KEY_HEADER = "X-Client-Key";

/** Resolved DECIPHER access policy for one request. */
export interface DecipherAccess {
	/** Send `Referer: <baseUrl>/` on DECIPHER requests (DECIPHER_SEND_REFERER). */
	sendReferer: boolean;
	/** DECIPHER Client API Key for the sanctioned /api/* JSON:API, if issued. */
	clientKey?: string;
}

/** The subset of the Worker env this module reads. */
export interface DecipherAccessEnv {
	DECIPHER_SEND_REFERER?: string;
	DECIPHER_CLIENT_KEY?: string;
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Resolve the access policy from the Worker env. Anything other than an
 * explicit truthy value — including the var being absent — leaves the Referer
 * off, so a typo fails closed rather than silently spoofing an origin.
 */
export function readDecipherAccess(env?: DecipherAccessEnv): DecipherAccess {
	const flag = env?.DECIPHER_SEND_REFERER;
	const key = env?.DECIPHER_CLIENT_KEY?.trim();
	return {
		sendReferer: TRUTHY.has(String(flag ?? "").trim().toLowerCase()),
		...(key ? { clientKey: key } : {}),
	};
}

/**
 * Build the request headers for a DECIPHER call. Exported so the opt-in
 * default (no Referer) is pinned by a unit test rather than by inspection.
 */
export function buildDecipherHeaders(
	baseUrl: string,
	access?: DecipherAccess,
	extra?: Record<string, string>,
): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/json",
		...(extra ?? {}),
	};
	if (access?.sendReferer) {
		headers.Referer = `${baseUrl.replace(/\/$/, "")}/`;
	}
	if (access?.clientKey) {
		headers[CLIENT_KEY_HEADER] = access.clientKey;
	}
	return headers;
}

export interface DecipherFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	/** Override base URL */
	baseUrl?: string;
	/** Content type for the request */
	contentType?: string;
	/** Access policy — omitted means no Referer and no client key. */
	access?: DecipherAccess;
}

/**
 * Fetch from DECIPHER with retry handling.
 *
 * Without `access.sendReferer` every /data/* path answers 403
 * {"error":"Access Denied"}; without `access.clientKey` every /api/* path
 * answers 403 {"detail":"Client key not provided"}. Both are surfaced to the
 * caller as real failures — nothing here downgrades them.
 */
export async function decipherFetch(
	path: string,
	params?: Record<string, unknown>,
	opts?: DecipherFetchOptions,
): Promise<Response> {
	const baseUrl = opts?.baseUrl ?? DECIPHER_BASE;

	return restFetch(baseUrl, path, params, {
		...opts,
		headers: buildDecipherHeaders(baseUrl, opts?.access, opts?.headers),
		retryOn: [429, 500, 502, 503],
		retries: opts?.retries ?? 3,
		timeout: opts?.timeout ?? 30_000,
		userAgent:
			"decipher-mcp-server/1.0 (bio-mcp; https://github.com/QuentinCody/decipher-mcp-server)",
	});
}

/**
 * POST to DECIPHER. Same access rules as decipherFetch.
 */
export async function decipherPost(
	path: string,
	body: object,
	opts?: DecipherFetchOptions,
): Promise<Response> {
	const baseUrl = opts?.baseUrl ?? DECIPHER_BASE;

	return restFetch(baseUrl, path, undefined, {
		...opts,
		method: "POST",
		headers: buildDecipherHeaders(baseUrl, opts?.access, {
			"Content-Type": opts?.contentType ?? "application/json",
			...(opts?.headers ?? {}),
		}),
		body,
		retryOn: [429, 500, 502, 503],
		retries: opts?.retries ?? 3,
		timeout: opts?.timeout ?? 30_000,
		userAgent: "decipher-mcp-server/1.0",
	});
}
