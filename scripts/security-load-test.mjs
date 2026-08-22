const baseUrl = process.env.LOAD_TEST_URL || "http://127.0.0.1:3000";
const total = Number(process.env.LOAD_TEST_TOTAL || 120);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 20);

async function request() {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/commissions/summary`);
    await response.arrayBuffer();
    return { status: response.status, ms: performance.now() - started };
  } catch (error) {
    return { status: 0, ms: performance.now() - started, error: String(error) };
  }
}

const results = [];
let next = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= total) return;
    results[index] = await request();
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
const durations = results.map(result => result.ms).sort((a, b) => a - b);
const count = status => results.filter(result => result.status === status).length;
const percentile = fraction => durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))];

console.log(JSON.stringify({
  baseUrl,
  total,
  concurrency,
  statuses: { ok: count(200), unauthorized: count(401), rateLimited: count(429), other: results.filter(result => ![200, 401, 429].includes(result.status)).length },
  latencyMs: { p50: Number(percentile(0.5).toFixed(2)), p95: Number(percentile(0.95).toFixed(2)), max: Number(Math.max(...durations).toFixed(2)) },
  errors: results.filter(result => result.error).slice(0, 3),
}, null, 2));
