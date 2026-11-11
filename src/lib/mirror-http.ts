const ORIGINS = new Set(["https://www.ebi.ac.uk", "https://ftp.clinicalgenome.org", "https://ftp.ncbi.nlm.nih.gov"]);
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function fail(message: string, status = 400, data?: unknown): never {
  throw Object.assign(new Error(message), { status, data: data ?? { error: { message, status } } });
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function jsonHash(value: unknown): Promise<string> {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return sha256(new TextEncoder().encode(JSON.stringify(canonical(value))));
}

/** One bounded public GET, including the response body; no redirect or retry. */
export async function mirrorRead(urlValue: string, options: { params?: Record<string, unknown>; maxBytes?: number; deadline?: number; accept?: string } = {}) {
  const { remaining, url } = prepareMirrorRequest(urlValue, options);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("Mirror read deadline exceeded"), { status: 504 })); }, remaining);
  });
  const work = async () => {
    const response = await fetch(url.href, { headers: { Accept: options.accept ?? "application/json" }, redirect: "manual", signal: controller.signal });
    reader = response.body?.getReader();
    if (!reader) fail("Empty mirror response", 502);
    return await readMirrorBody(reader, options, url, response);
  };
  try { return await Promise.race([work(), timeout]); }
  catch (error) { if (record(error) && "status" in error) throw error; throw Object.assign(new Error("Public mirror unavailable"), { status: 502 }); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

async function readMirrorBody(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>, options: { params?: Record<string, unknown>; maxBytes?: number; deadline?: number; accept?: string; }, url: URL, response: Response) {
  const chunks: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      count += part.value.byteLength;
      if (count > (options.maxBytes ?? 4 * 1024 * 1024)) fail("Mirror response exceeds byte limit; narrow the request", 502);
      chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => { }); reader.releaseLock(); }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const evidence = {
    source_url: url.href, upstream_status: response.status, retrieved_at: new Date().toISOString(),
    response_bytes: count, response_sha256: await sha256(bytes), hash_scope: "Exact response body bytes", last_modified: response.headers.get("last-modified"), etag: response.headers.get("etag")
  };
  if (!response.ok) {
    const text = new TextDecoder().decode(bytes); let native: unknown;
    try { native = JSON.parse(text); } catch { native = text; }
    fail(`Public mirror HTTP ${response.status}`, response.status, { native_error: native, response_evidence: evidence });
  }
  return { status: response.status, bytes, evidence };
}

function prepareMirrorRequest(urlValue: string, options: { params?: Record<string, unknown>; maxBytes?: number; deadline?: number; accept?: string; }) {
  const url = new URL(urlValue);
  if (!ORIGINS.has(url.origin) || url.username || url.password || url.hash) fail("Unsupported public mirror URL");
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value === undefined) continue;
    if (!["string", "number", "boolean"].includes(typeof value) || String(value).length > 16000 || key.length > 200) fail("Unsupported mirror query value");
    if (typeof value === "number" && !Number.isFinite(value)) fail("Query numbers must be finite");
    url.searchParams.set(key, String(value));
  }
  const remaining = (options.deadline ?? Date.now() + 30000) - Date.now();
  if (remaining <= 0) fail("Mirror read deadline exceeded", 504);
  return { remaining, url };
}

export async function mirrorJson(url: string, params?: Record<string, unknown>, deadline?: number) {
  const result = await mirrorRead(url, { params, deadline });
  let data: unknown;
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(result.bytes)); }
  catch { fail("Invalid mirror JSON", 502, { response_evidence: result.evidence }); }
  if (!data || typeof data !== "object" || "error" in data || "errors" in data) fail("Mirror returned an error envelope", 502, { native_error: data, response_evidence: result.evidence });
  return { status: result.status, data, evidence: result.evidence };
}
