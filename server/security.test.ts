import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createFinancialRateLimiter } from "./security";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe("security middleware", () => {
  it("rejects JSON payloads larger than the configured parser limit", async () => {
    const app = express();
    app.use(express.json({ limit: "1kb" }));
    app.post("/probe", (_req, res) => res.status(200).json({ ok: true }));
    app.use((error: { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => { if (error.type === "entity.too.large") return res.status(413).end(); next(error); });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    const response = await fetch(`http://127.0.0.1:${address.port}/probe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: "x".repeat(2048) }) });
    expect(response.status).toBe(413);
  });

  it("returns 429 after the configured request limit", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(createFinancialRateLimiter({ windowMs: 60_000, limit: 2 }));
    app.get("/probe", (_req, res) => res.status(200).json({ ok: true }));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    const url = `http://127.0.0.1:${address.port}/probe`;

    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url)).status).toBe(200);
    const limited = await fetch(url);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
