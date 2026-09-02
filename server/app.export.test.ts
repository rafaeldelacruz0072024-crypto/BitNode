import { describe, expect, it } from "vitest";
import app, { createApp } from "./app";

describe("Vercel server entrypoint", () => {
  it("exports a callable Express handler by default", () => {
    expect(typeof app).toBe("function");
    expect(typeof createApp()).toBe("function");
  });
});
