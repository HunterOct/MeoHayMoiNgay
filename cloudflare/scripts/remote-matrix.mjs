import fs from "node:fs";

const BASE = (process.env.STAGING_BASE || "https://meohay-m0-stg-230403.poseidonxx001.workers.dev").replace(/\/+$/, "");
const STAGING_TOKEN = process.env.STAGING_TOKEN || fs.readFileSync(".staging-token", "utf8").trim();
const seedMeta = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const extraMeta = JSON.parse(fs.readFileSync("fixtures/extra-meta.json", "utf8"));
const group = process.argv[2] || "edges";

const ADMIN_KEY = seedMeta.apiKey;
const REVIEW_KEY = seedMeta.reviewKey;
const LOW_KEY = extraMeta.lowRateKey;

const results = [];
const stamp = Date.now().toString(36);

async function call(label, method, path, options = {}) {
  const headers = {
    "user-agent": "M0-Remote-Matrix/1.0",
    ...(options.token === false ? {} : { "x-staging-token": STAGING_TOKEN }),
    ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
    ...(options.headers || {}),
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const started = performance.now();
  let status = 0;
  let text = "";
  let error = null;
  let responseHeaders = {};
  try {
    const response = await fetch(BASE + path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    text = await response.text();
    responseHeaders = {
      worker: response.headers.get("x-m0-worker"),
      idempotent: response.headers.get("idempotent-replayed"),
      rateLimit: response.headers.get("x-ratelimit-limit"),
      rateRemaining: response.headers.get("x-ratelimit-remaining"),
      retryAfter: response.headers.get("retry-after"),
      contentType: response.headers.get("content-type"),
      cache: response.headers.get("cf-cache-status"),
    };
  } catch (caught) {
    error = String(caught.message || caught);
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body
  }
  const record = {
    label,
    method,
    path,
    status,
    ms: Number((performance.now() - started).toFixed(3)),
    headers: responseHeaders,
    error,
    bytes: Buffer.byteLength(text),
    ...(json ? { body: json } : { body_excerpt: text.slice(0, 240) }),
    ...(options.capture ? { full_text: text } : {}),
  };
  results.push(record);
  console.log(`${label}: ${error ? "ERROR " + error : status} (${record.ms} ms)`);
  return record;
}

const htmlContent = `<h2>Kiểm chứng staging</h2><p>${"Nội dung kiểm chứng remote staging cho M0.5. ".repeat(20)}</p><script>alert(1)</script><p><a href="javascript:alert(2)">x</a> an toàn.</p>`;

async function edges() {
  await call("staging-token-required", "POST", "/api/m0/posts", {
    token: false,
    body: { title: "No token" },
  });
  await call("bearer-required", "POST", "/api/m0/posts", {
    body: { title: "No bearer post" },
  });
  await call("bearer-invalid", "POST", "/api/m0/posts", {
    key: "mh_invalid_key",
    body: { title: "Bad bearer post" },
  });
  await call("validation-short-title", "POST", "/api/m0/posts", {
    key: ADMIN_KEY,
    body: { title: "ab", content: htmlContent },
  });

  const idemKey = `m0-idem-${stamp}`;
  const create = await call("create-draft-idempotent", "POST", "/api/m0/posts", {
    key: ADMIN_KEY,
    headers: { "idempotency-key": idemKey },
    body: {
      title: `Bài kiểm chứng idempotency ${stamp}`,
      slug: `m0-idem-${stamp}`,
      excerpt: "Idempotency replay test",
      content: htmlContent,
      content_format: "html",
      category: "wifi-mang",
      tags: ["wifi", "staging"],
      status: "draft",
    },
  });
  const createdId = create.body?.data?.id;
  const createdSlug = create.body?.data?.slug;

  await call("idempotency-replay-same-body", "POST", "/api/m0/posts", {
    key: ADMIN_KEY,
    headers: { "idempotency-key": idemKey },
    body: {
      title: `Bài kiểm chứng idempotency ${stamp}`,
      slug: `m0-idem-${stamp}`,
      excerpt: "Idempotency replay test",
      content: htmlContent,
      content_format: "html",
      category: "wifi-mang",
      tags: ["wifi", "staging"],
      status: "draft",
    },
  });
  await call("idempotency-conflict-body", "POST", "/api/m0/posts", {
    key: ADMIN_KEY,
    headers: { "idempotency-key": idemKey },
    body: { title: "Payload khác hoàn toàn", content: htmlContent },
  });

  const externalId = `ext-${stamp}`;
  await call("external-id-first", "POST", "/api/m0/posts", {
    key: ADMIN_KEY,
    headers: { "idempotency-key": `ext-first-${stamp}` },
    body: {
      title: `Bài external id ${stamp}`,
      slug: `m0-ext-${stamp}`,
      content: htmlContent,
      content_format: "html",
      external_id: externalId,
      status: "draft",
    },
  });
  await call("external-id-replay", "POST", "/api/m0/posts", {
    key: ADMIN_KEY,
    headers: { "idempotency-key": `ext-second-${stamp}` },
    body: {
      title: `Bài external id lần hai ${stamp}`,
      slug: `m0-ext-second-${stamp}`,
      content: htmlContent,
      content_format: "html",
      external_id: externalId,
      status: "draft",
    },
  });

  const publish = await call("publish-draft", "POST", `/api/m0/posts/${createdId}/publish`, {
    key: ADMIN_KEY,
  });

  const review = await call("review-mode-demotes-publish", "POST", "/api/m0/posts", {
    key: REVIEW_KEY,
    headers: { "idempotency-key": `review-${stamp}` },
    body: {
      title: `Bài review mode ${stamp}`,
      slug: `m0-review-${stamp}`,
      content: htmlContent,
      content_format: "html",
      status: "published",
      category: "meo-vat",
    },
  });
  const reviewId = review.body?.data?.id;
  await call("review-mode-direct-publish-forbidden", "POST", `/api/m0/posts/${reviewId}/publish`, {
    key: REVIEW_KEY,
  });
  await call("review-mode-update-to-published-demoted", "PATCH", `/api/m0/posts/${reviewId}`, {
    key: REVIEW_KEY,
    body: { status: "published" },
  });

  const low = await call("low-scope-create", "POST", "/api/m0/posts", {
    key: LOW_KEY,
    headers: { "idempotency-key": `low-create-${stamp}` },
    body: {
      title: `Bài read-only scope ${stamp}`,
      slug: `m0-low-${stamp}`,
      content: htmlContent,
      content_format: "html",
      status: "draft",
    },
  });
  const lowId = low.body?.data?.id || createdId;
  await call("low-scope-patch-forbidden", "PATCH", `/api/m0/posts/${lowId}`, {
    key: LOW_KEY,
    body: { title: "Không được phép sửa" },
  });
  await call("low-scope-read-allowed", "GET", `/api/m0/posts/${lowId}`, { key: LOW_KEY });

  await call("media-r2-disabled", "POST", "/api/m0/media", {
    key: ADMIN_KEY,
    body: { note: "R2 intentionally disabled" },
  });

  const rateStatuses = [];
  for (let i = 0; i < 14; i += 1) {
    const hit = await call(`rate-limit-${i + 1}`, "GET", `/api/m0/posts/${lowId}`, { key: LOW_KEY });
    rateStatuses.push(hit.status);
  }

  fs.writeFileSync(
    "fixtures/new-post-slug.json",
    JSON.stringify({ slug: createdSlug, published: publish.status === 200, at: new Date().toISOString() }, null, 2),
  );

  return {
    group,
    createdId,
    createdSlug,
    sanitized_has_script: JSON.stringify(create.body?.data?.content_html || "").includes("<script"),
    sanitized_has_javascript_href: JSON.stringify(create.body?.data?.content_html || "").includes("javascript:"),
    publish_status: publish.status,
    review_status: review.body?.data?.status || null,
    review_demoted: review.body?.meta?.publish_demoted ?? null,
    low_scope_create_status: low.status,
    low_scope_created: Boolean(low.body?.data?.id),
    rate_statuses: rateStatuses,
  };
}

async function d1() {
  const slug = process.env.D1_SLUG || "wifi-nha-cham-7-cach-khac-phuc";
  const meta = await call("d1-meta", "GET", `/api/m0/bench/d1-meta/${slug}`, {});
  const atomic = await call("d1-batch-atomicity", "POST", "/api/m0/db/batch-atomicity", {});
  const concurrent = await call("d1-concurrent-20", "GET", "/api/m0/bench/concurrent?n=20", {});
  const write = await call("d1-write", "POST", "/api/m0/bench/d1-write", {});
  const category = await call("d1-category", "GET", "/api/m0/bench/category/wifi-mang", {});
  const search = await call("d1-search", "GET", "/api/m0/bench/search-capped?q=wifi&candidates=200", {});
  return {
    group,
    slug,
    d1_meta: meta.body,
    atomic: atomic.body,
    concurrent: concurrent.body,
    write: write.body,
    category: category.body,
    search: search.body,
  };
}

async function staticAssets() {
  const newSlug = fs.existsSync("fixtures/new-post-slug.json")
    ? JSON.parse(fs.readFileSync("fixtures/new-post-slug.json", "utf8")).slug
    : null;
  const paths = [
    ["static-home-root", "/"],
    ["static-home-index", "/index.html"],
    ["static-article", "/bai-viet/bao-mat-wifi-nha-5-viec-phai-lam"],
    ["static-article-html", "/bai-viet/bao-mat-wifi-nha-5-viec-phai-lam.html"],
    ["static-css", "/assets/css/style.css"],
    ["static-legacy-image", "/assets/img/img-001.jpg"],
    ["dynamic-home", "/dyn/home"],
    ["dynamic-article", "/dyn/bai-viet/bao-mat-wifi-nha-5-viec-phai-lam"],
    ["worker-fallback-new-post", newSlug ? `/bai-viet/${newSlug}` : "/bai-viet/not-a-real-post"],
    ["worker-fallback-missing", "/bai-viet/khong-ton-tai-bai-viet-nay"],
    ["media-disabled", "/media/khong-co-file.jpg"],
  ];
  const rows = [];
  for (const [label, path] of paths) {
    const hit = await call(label, "GET", path, { capture: true });
    const body = hit.body_excerpt || "";
    rows.push({
      label,
      path,
      status: hit.status,
      ms: hit.ms,
      worker: hit.headers.worker,
      cache: hit.headers.cache,
      contentType: hit.headers.contentType,
      bytes: hit.bytes,
      html: hit.full_text && hit.full_text.includes("<html") ? hit.full_text : null,
    });
  }
  const home = rows.find((row) => row.label === "static-home-root")?.html || "";
  const article = rows.find((row) => row.label === "static-article")?.html || "";
  const fallback = rows.find((row) => row.label === "worker-fallback-new-post")?.html || "";
  const seo = (html) => ({
    title: /<title>([^<]*)<\/title>/i.exec(html)?.[1] || null,
    canonical: /rel="canonical" href="([^"]+)"/i.exec(html)?.[1] || null,
    ogTitle: /property="og:title" content="([^"]*)"/i.exec(html)?.[1] || null,
    ogImage: /property="og:image" content="([^"]*)"/i.exec(html)?.[1] || null,
    twitterCard: /name="twitter:card" content="([^"]*)"/i.exec(html)?.[1] || null,
    jsonLd: (html.match(/application\/ld\+json/g) || []).length,
    hasNav: html.includes("<nav"),
    hasFooter: html.includes("<footer"),
    hasInlineCriticalCss: html.includes("<style"),
    bytes: Buffer.byteLength(html),
  });
  return {
    group,
    newSlug,
    rows: rows.map(({ html, ...rest }) => rest),
    seo: { home: seo(home), article: seo(article), fallback: seo(fallback) },
  };
}

async function cacheCounts() {
  const slug = "wifi-mang";
  const readCount = async (label) => {
    const hit = await call(label, "GET", `/api/m0/bench/category/${slug}`, {});
    return hit.body?.total ?? null;
  };
  const before = await readCount("cache-before");
  await call("cache-low-scope-create-forbidden", "POST", "/api/m0/posts", {
    key: LOW_KEY,
    headers: { "idempotency-key": `cache-low-${stamp}` },
    body: {
      title: `Scope test cache ${stamp}`,
      content: htmlContent,
      content_format: "html",
      status: "draft",
    },
  });
  const draft = await call("cache-create-draft", "POST", "/api/m0/posts", {
    key: ADMIN_KEY,
    headers: { "idempotency-key": `cache-draft-${stamp}` },
    body: {
      title: `Cache trigger draft ${stamp}`,
      slug: `m0-cache-${stamp}`,
      content: htmlContent,
      content_format: "html",
      category: slug,
      status: "draft",
    },
  });
  const afterDraft = await readCount("cache-after-draft");
  const id = draft.body?.data?.id;
  await call("cache-publish", "POST", `/api/m0/posts/${id}/publish`, { key: ADMIN_KEY });
  const afterPublish = await readCount("cache-after-publish");
  await call("cache-unpublish", "PATCH", `/api/m0/posts/${id}`, {
    key: ADMIN_KEY,
    body: { status: "draft" },
  });
  const afterUnpublish = await readCount("cache-after-unpublish");
  await call("cache-republish", "PATCH", `/api/m0/posts/${id}`, {
    key: ADMIN_KEY,
    body: { status: "published" },
  });
  const afterRepublish = await readCount("cache-after-republish");
  return {
    group,
    slug,
    before,
    afterDraft,
    afterPublish,
    afterUnpublish,
    afterRepublish,
    expected: {
      draft_delta: 0,
      publish_delta: 1,
      unpublish_delta: -1,
      republish_delta: 1,
    },
  };
}

const run = { edges, d1, static: staticAssets, cache: cacheCounts }[group];
if (!run) {
  console.error("Unknown group. Use: edges | d1 | static");
  process.exit(1);
}
const summary = await run();
const output = {
  group,
  started_at: new Date().toISOString(),
  base: BASE,
  results: results.map(({ full_text, ...rest }) => rest),
  summary,
};
fs.writeFileSync(`fixtures/remote-matrix-${group}.json`, JSON.stringify(output, null, 2));
console.log(`\nSaved fixtures/remote-matrix-${group}.json`);
