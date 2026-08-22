import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["api/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node",
  },
});
