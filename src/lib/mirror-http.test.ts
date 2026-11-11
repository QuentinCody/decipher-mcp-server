/// <reference types="node" />
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mirrorJson, mirrorRead } from "./mirror-http";

const url = "https://www.ebi.ac.uk/gene2phenotype/api/lgd/G2P03507/";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retains native JSON, exact byte evidence and scalar query parameters", async () => {
  const raw = '{ "evidence": {"unknown_future_field":"α😀","pmid":"000123"} }';
  const fetcher = vi.fn(async () => new Response(raw, { headers: { etag: '"v1"', "set-cookie": "private=excluded" } }));
  vi.stubGlobal("fetch", fetcher);
  const result = await mirrorJson(url, { page: 2, panel: "DD", optional: undefined });
  expect(result.data).toEqual(JSON.parse(raw));
  expect(result.evidence).toMatchObject({ response_bytes: Buffer.byteLength(raw), response_sha256: createHash("sha256").update(raw).digest("hex"), etag: '"v1"' });
  expect(result.evidence).not.toHaveProperty("set-cookie");
  expect(fetcher.mock.calls[0]).toMatchObject([`${url}?page=2&panel=DD`, { redirect: "manual", headers: { Accept: "application/json" } }]);
});

it.each([403, 404, 429, 503])("preserves an upstream %s body without retries", async status => {
  const fetcher = vi.fn(async () => Response.json({ detail: "Native failure", code: "E123" }, { status }));
  vi.stubGlobal("fetch", fetcher);
  await expect(mirrorJson(url)).rejects.toMatchObject({ status, data: { native_error: { detail: "Native failure", code: "E123" }, response_evidence: { upstream_status: status } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["null", "not json", '{"error":"native error"}', '{"errors":["failure"]}'])("rejects malformed or error JSON: %s", async body => {
  vi.stubGlobal("fetch", async () => new Response(body));
  await expect(mirrorJson(url)).rejects.toMatchObject({ status: 502, data: { response_evidence: { response_bytes: Buffer.byteLength(body) } } });
});

it("counts streamed bytes rather than trusting Content-Length", async () => {
  vi.stubGlobal("fetch", async () => new Response("α😀", { headers: { "content-length": "1" } }));
  await expect(mirrorRead(url, { maxBytes: 5 })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("byte limit") });
});

it("times out and cancels a body that stalls after headers", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ cancel })));
  const pending = expect(mirrorRead(url, { deadline: Date.now() + 10 })).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(11); await pending;
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("does not follow redirects", async () => {
  const fetcher = vi.fn(async () => new Response("redirect", { status: 302, headers: { location: "https://example.com" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(mirrorJson(url)).rejects.toMatchObject({ status: 302 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects unsupported origins and query objects before I/O", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const bad of ["https://example.com", "https://user@www.ebi.ac.uk/a", `${url}#fragment`]) await expect(mirrorRead(bad)).rejects.toMatchObject({ status: 400 });
  for (const page of [Number.POSITIVE_INFINITY, [1], { value: 1 }, null]) await expect(mirrorJson(url, { page })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});
