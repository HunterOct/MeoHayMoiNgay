const LIST_COLUMNS = `
  p.id, p.slug, p.title, p.excerpt, p.cover_image, p.cover_alt,
  p.read_minutes, p.published_at, p.created_at,
  c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
  u.name AS author_name
`;

const DETAIL_COLUMNS = `
  p.id, p.slug, p.title, p.excerpt, p.lede, p.content_html, p.content_format,
  p.status, p.category_id, p.author_id, p.cover_image, p.cover_alt, p.cover_caption,
  p.seo_title, p.seo_description, p.canonical_url, p.og_image, p.read_minutes,
  p.published_at, p.created_at, p.updated_at,
  c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
  u.name AS author_name
`;

const BASE_FROM = `
  FROM posts p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN users u ON u.id = p.author_id
`;

function pageNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 1 ? number : 1;
}

function ftsQuery(q) {
  const terms = String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((term) => `"${term.replace(/"/g, "")}"*`).join(" AND ");
}

export async function listPublished(
  db,
  {
    categorySlug = null,
    categoryId = null,
    groupSlug = null,
    groupCategoryIds = null,
    tagSlug = null,
    q = "",
    page = 1,
    perPage = 8,
    total: providedTotal = null,
  } = {},
) {
  const safePerPage = Math.min(50, Math.max(1, Number(perPage) || 8));
  const safePage = pageNumber(page);
  const offset = (safePage - 1) * safePerPage;
  const clauses = ["p.status = 'published'", "p.deleted_at IS NULL"];
  const params = [];
  const joins = [];

  if (categoryId) {
    clauses.push("p.category_id = ?");
    params.push(categoryId);
  } else if (categorySlug) {
    clauses.push("c.slug = ?");
    params.push(categorySlug);
  }
  if (groupCategoryIds && groupCategoryIds.length) {
    clauses.push(`p.category_id IN (${groupCategoryIds.map(() => "?").join(",")})`);
    params.push(...groupCategoryIds);
  } else if (groupSlug) {
    clauses.push("c.group_name = ?");
    params.push(groupSlug);
  }
  if (tagSlug) {
    joins.push(
      "JOIN post_tags pt_filter ON pt_filter.post_id = p.id JOIN tags t_filter ON t_filter.id = pt_filter.tag_id",
    );
    clauses.push("t_filter.slug = ?");
    params.push(tagSlug);
  }

  let order = "p.published_at DESC, p.id DESC";
  if (String(q || "").trim()) {
    const match = ftsQuery(q);
    if (match) {
      joins.push("JOIN posts_fts ON posts_fts.post_id = p.id");
      clauses.push("posts_fts MATCH ?");
      params.push(match);
      order = "rank, p.published_at DESC";
    } else {
      clauses.push("(p.title LIKE ? OR p.excerpt LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
  }

  const whereSql = `WHERE ${clauses.join(" AND ")}`;
  const joinSql = joins.join(" ");
  let total = providedTotal === null ? null : Number(providedTotal);
  if (total === null) {
    const count = await db
      .prepare(`SELECT COUNT(DISTINCT p.id) AS n ${BASE_FROM} ${joinSql} ${whereSql}`)
      .bind(...params)
      .first();
    total = Number(count?.n || 0);
  }
  const rows = await db
    .prepare(`SELECT ${LIST_COLUMNS} ${BASE_FROM} ${joinSql} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...params, safePerPage, offset)
    .all();

  return {
    items: rows.results || [],
    total,
    page: safePage,
    perPage: safePerPage,
    totalPages: Math.max(1, Math.ceil(total / safePerPage)),
  };
}

export async function listLatest(db, limit = 16) {
  const result = await db
    .prepare(
      `SELECT ${LIST_COLUMNS} ${BASE_FROM}
       WHERE p.status = 'published' AND p.deleted_at IS NULL
       ORDER BY p.published_at DESC, p.id DESC LIMIT ?`,
    )
    .bind(Math.min(50, Math.max(1, Number(limit) || 16)))
    .all();
  return result.results || [];
}

export async function listPopular(db, limit = 5) {
  const result = await db
    .prepare(
      `SELECT ${LIST_COLUMNS} ${BASE_FROM}
       WHERE p.status = 'published' AND p.deleted_at IS NULL
       ORDER BY p.views DESC, p.published_at DESC LIMIT ?`,
    )
    .bind(Math.min(20, Math.max(1, Number(limit) || 5)))
    .all();
  return result.results || [];
}

export async function listSitemap(db) {
  const result = await db
    .prepare(
      `SELECT slug, cover_image, updated_at, published_at FROM posts
       WHERE status = 'published' AND deleted_at IS NULL
       ORDER BY published_at DESC`,
    )
    .all();
  return result.results || [];
}

export async function listCategoriesFast(db) {
  const result = await db
    .prepare(
      "SELECT c.*, c.cached_post_count AS post_count FROM categories c ORDER BY c.sort_order ASC, c.name ASC",
    )
    .all();
  return result.results || [];
}

export async function listTagsWithCounts(db) {
  const result = await db
    .prepare("SELECT t.*, t.cached_post_count AS post_count FROM tags t ORDER BY t.name ASC")
    .all();
  return result.results || [];
}

export async function countPublished(db) {
  const row = await db.prepare("SELECT value FROM counters WHERE key = 'published_posts'").first();
  return Number(row?.value || 0);
}

export async function categoriesForGroup(db, group) {
  const result = await db
    .prepare("SELECT id, cached_post_count FROM categories WHERE group_name = ? ORDER BY sort_order ASC")
    .bind(group)
    .all();
  return result.results || [];
}


export async function getCategoryBySlug(db, slug) {
  return db.prepare("SELECT * FROM categories WHERE slug = ? LIMIT 1").bind(slug).first();
}

export async function getTagBySlug(db, slug) {
  return db.prepare("SELECT * FROM tags WHERE slug = ? LIMIT 1").bind(slug).first();
}

export async function tagsForPost(db, postId) {
  const result = await db
    .prepare(
      `SELECT t.id, t.name, t.slug FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = ? ORDER BY t.name ASC`,
    )
    .bind(postId)
    .all();
  return result.results || [];
}

export async function getPublishedBySlug(db, slug) {
  const post = await db
    .prepare(
      `SELECT ${DETAIL_COLUMNS}
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.slug = ? AND p.status = 'published' AND p.deleted_at IS NULL LIMIT 1`,
    )
    .bind(slug)
    .first();
  if (!post) return null;
  post.tags = await tagsForPost(db, post.id);
  return post;
}

export async function getTrashedBySlug(db, slug) {
  return db
    .prepare("SELECT id, slug, deleted_at FROM posts WHERE slug = ? AND deleted_at IS NOT NULL LIMIT 1")
    .bind(slug)
    .first();
}

export async function findHistoricalSlug(db, slug) {
  return db
    .prepare(
      `SELECT p.slug AS current_slug, p.deleted_at FROM slug_history h
       JOIN posts p ON p.id = h.post_id WHERE h.slug = ? LIMIT 1`,
    )
    .bind(slug)
    .first();
}

export async function listRelated(db, post, limit = 4) {
  const safeLimit = Math.min(8, Math.max(1, Number(limit) || 4));
  if (!post.category_id) {
    const fill = await db
      .prepare(
        `SELECT ${LIST_COLUMNS} ${BASE_FROM}
         WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.id <> ?
         ORDER BY p.published_at DESC, p.id DESC LIMIT ?`,
      )
      .bind(post.id, safeLimit)
      .all();
    return fill.results || [];
  }

  const same = await db
    .prepare(
      `SELECT ${LIST_COLUMNS} ${BASE_FROM}
       WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.id <> ? AND p.category_id = ?
       ORDER BY p.published_at DESC, p.id DESC LIMIT ?`,
    )
    .bind(post.id, post.category_id, safeLimit)
    .all();
  const rows = same.results || [];
  if (rows.length >= safeLimit) return rows;

  const ids = new Set([post.id, ...rows.map((row) => row.id)]);
  const fill = await db
    .prepare(
      `SELECT ${LIST_COLUMNS} ${BASE_FROM}
       WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.id <> ?
       ORDER BY p.published_at DESC, p.id DESC LIMIT ?`,
    )
    .bind(post.id, safeLimit * 4)
    .all();
  for (const row of fill.results || []) {
    if (rows.length >= safeLimit) break;
    if (!ids.has(row.id)) {
      rows.push(row);
      ids.add(row.id);
    }
  }
  return rows;
}

export async function adjacentPosts(db, post) {
  const select = `SELECT ${LIST_COLUMNS} ${BASE_FROM}`;
  const prev = await db
    .prepare(
      `${select}
       WHERE p.status = 'published' AND p.deleted_at IS NULL
         AND (p.published_at > ? OR (p.published_at = ? AND p.id > ?))
       ORDER BY p.published_at ASC, p.id ASC LIMIT 1`,
    )
    .bind(post.published_at, post.published_at, post.id)
    .first();
  const next = await db
    .prepare(
      `${select}
       WHERE p.status = 'published' AND p.deleted_at IS NULL
         AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))
       ORDER BY p.published_at DESC, p.id DESC LIMIT 1`,
    )
    .bind(post.published_at, post.published_at, post.id)
    .first();
  return { prev: prev || null, next: next || null };
}
