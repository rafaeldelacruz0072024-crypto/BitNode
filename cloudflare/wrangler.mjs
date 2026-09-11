import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// This proxy needs no backend secrets from the project's Vercel .env files.
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("./node_modules/wrangler/bin/wrangler.js", import.meta.url)),
  ...process.argv.slice(2)
], {
  stdio: "inherit",
  env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" }
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
