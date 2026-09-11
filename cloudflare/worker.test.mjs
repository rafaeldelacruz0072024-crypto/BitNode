import assert from "node:assert/strict";
import { test, mock, afterEach } from "node:test";
import worker from "./worker.mjs";

afterEach(() => mock.restoreAll());
const env = { API_ORIGIN: "https://origin.example" };
const request = (path, options) => new Request(`https://preview.example${path}`, options);

test("deep links and similarly named paths are served as assets", async () => {
  for (const path of ["/dashboard", "/apiculture"]) {
    const result = await worker.fetch(request(path), {
      ASSETS: { fetch: async () => new Response("SPA") }
    });
    assert.equal(await result.text(), "SPA");
  }
});

test("API POST preserves query, body, auth and upstream status without caching", async () => {
  mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "https://origin.example/api/withdrawals?mode=test");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("Authorization"), "Bearer test-only");
    assert.equal(options.headers.get("Cookie"), "session=test-only");
    assert.equal(options.headers.get("x-forwarded-for"), null);
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.equal(await new Response(options.body).text(), '{"amount":1}');
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  });
  const response = await worker.fetch(request("/api/withdrawals?mode=test", {
    method: "POST", body: '{"amount":1}',
    headers: { Authorization: "Bearer test-only", Cookie: "session=test-only", "x-forwarded-for": "spoofed" }
  }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("missing, insecure, recursive and path-bearing origins fail closed", async () => {
  mock.method(globalThis, "fetch", () => assert.fail("No origin request allowed"));
  for (const origin of [undefined, "http://origin.example", "https://preview.example", "https://origin.example/api", "https://user:password@origin.example"]) {
    const response = await worker.fetch(request("/api"), { API_ORIGIN: origin });
    assert.equal(response.status, 503);
  }
});

test("origin redirects stay on the frontend and preserve session cookies", async () => {
  mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 302, headers: { Location: "https://origin.example/dashboard", "Set-Cookie": "session=test-only; Secure; HttpOnly; Path=/" }
  }));
  const response = await worker.fetch(request("/api/oauth/callback"), env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://preview.example/dashboard");
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
});

test("external redirects are returned without following them", async () => {
  const call = mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 302, headers: { Location: "https://login.example/authorize" }
  }));
  const response = await worker.fetch(request("/api/oauth/callback"), env);
  assert.equal(response.headers.get("Location"), "https://login.example/authorize");
  assert.equal(call.mock.callCount(), 1);
});

test("network errors return an uncached 502", async () => {
  mock.method(globalThis, "fetch", async () => { throw new Error("private network detail"); });
  const response = await worker.fetch(request("/api/test"), env);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).error, "API origin is unavailable.");
});
