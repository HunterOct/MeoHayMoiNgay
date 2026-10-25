const BASE = "http://127.0.0.1:8787";

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function bench(label, path, { runs = 30, headers = {} } = {}) {
  await fetch(BASE + path, { headers });
  const samples = [];
  let meta = null;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const response = await fetch(BASE + path, { headers });
    const text = await response.text();
    const ms = performance.now() - started;
    samples.push(ms);
    if (!meta) {
      meta = {
        status: response.status,
        worker: response.headers.get("x-m0-worker") || null,
        cache: response.headers.get("cf-cache-status") || null,
        serverTiming: response.headers.get("server-timing") || null,
        bytes: new TextEncoder().encode(text).length,
      };
    }
  }
  return {
    label,
    path,
    runs,
    p50_ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95_ms: Number(percentile(samples, 0.95).toFixed(3)),
    min_ms: Number(Math.min(...samples).toFixed(3)),
    max_ms: Number(Math.max(...samples).toFixed(3)),
    ...meta,
  };
}

const results = [];
results.push(await bench("static-article", "/bai-viet/wifi-nha-cham-7-cach-khac-phuc"));
results.push(await bench("static-home", "/"));
results.push(await bench("dynamic-article", "/dyn/bai-viet/wifi-nha-cham-7-cach-khac-phuc"));
results.push(await bench("dynamic-home", "/dyn/home"));
results.push(await bench("dynamic-article-100k", "/dyn/bai-viet/scale-99999"));
results.push(await bench("search-common-ranked", "/api/m0/bench/search?q=scale"));
results.push(await bench("search-common-fast", "/api/m0/bench/search-fast?q=scale"));
results.push(await bench("search-common-capped", "/api/m0/bench/search-capped?q=scale"));
results.push(await bench("search-specific", "/api/m0/bench/search?q=scale%20post%2099999"));
results.push(await bench("category-count", "/api/m0/bench/category/meo-vat"));
results.push(await bench("home-fast-counts", "/api/m0/bench/home-fast"));
results.push(await bench("home-slow-counts", "/api/m0/bench/home"));

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
