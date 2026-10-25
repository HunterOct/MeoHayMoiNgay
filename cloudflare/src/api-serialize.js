import { config } from "./config.js";

function tagNames(post) {
  if (!Array.isArray(post.tags)) return [];
  return post.tags.map((tag) => (typeof tag === "string" ? tag : tag.name)).filter(Boolean);
}

export function serializePost(post, { includeHtml = true, includeContent = true } = {}) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    lede: post.lede,
    ...(includeContent ? { content: post.content_source || "" } : {}),
    content_format: post.content_format,
    ...(includeHtml ? { content_html: post.content_html } : {}),
    status: post.status,
    category: post.category_id
      ? { id: post.category_id, name: post.category_name, slug: post.category_slug }
      : null,
    tags: tagNames(post),
    cover: {
      url: post.cover_image,
      alt: post.cover_alt,
      caption: post.cover_caption,
    },
    seo: {
      title: post.seo_title,
      description: post.seo_description,
      focus_keyword: post.focus_keyword,
      canonical_url: post.canonical_url,
      og_image: post.og_image,
    },
    author: post.author_id ? { id: post.author_id, name: post.author_name } : null,
    is_featured: Boolean(post.is_featured),
    read_minutes: post.read_minutes,
    views: post.views,
    external_id: post.external_id || null,
    published_at: post.published_at,
    scheduled_at: post.scheduled_at,
    created_at: post.created_at,
    updated_at: post.updated_at,
    deleted_at: post.deleted_at,
    version: Number(post.version || 1),
    url: `${config.siteUrl}/bai-viet/${encodeURIComponent(post.slug)}`,
  };
}

export function serializeMedia(media) {
  return {
    id: media.id,
    filename: media.filename,
    url: `${config.siteUrl}/media/${encodeURIComponent(media.filename)}`,
    path: `/media/${media.filename}`,
    mime: media.mime,
    size: media.size,
    width: media.width,
    height: media.height,
    alt: media.alt,
    original_name: media.original_name,
    created_at: media.created_at,
  };
}
