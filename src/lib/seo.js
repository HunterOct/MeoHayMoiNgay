import { config } from "../config.js";

const abs = (path) => new URL(path || "/", config.siteUrl).toString();

export function organizationLd(settings) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.site_name,
    url: config.siteUrl,
    description: settings.site_description,
    logo: abs("/favicon.svg"),
  };
}

export function websiteLd(settings) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.site_name,
    url: config.siteUrl,
    description: settings.site_description,
    inLanguage: "vi-VN",
    publisher: { "@type": "Organization", name: settings.site_name, url: config.siteUrl },
    potentialAction: {
      "@type": "SearchAction",
      target: `${config.siteUrl}/tim-kiem?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: abs(item.url) } : {}),
    })),
  };
}

export function articleLd(post, settings) {
  const url = abs(`/bai-viet/${encodeURIComponent(post.slug)}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.seo_title || post.title,
    description: post.seo_description || post.excerpt,
    ...(post.cover_image ? { image: [post.cover_image.startsWith("http") ? post.cover_image : abs(post.cover_image)] } : {}),
    datePublished: post.published_at || post.created_at,
    dateModified: post.updated_at || post.published_at || post.created_at,
    inLanguage: "vi-VN",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    author: {
      "@type": "Person",
      name: post.author_name || "Bé Dâu",
    },
    publisher: {
      "@type": "Organization",
      name: settings.site_name,
      url: config.siteUrl,
      ...(settings.site_logo ? { logo: { "@type": "ImageObject", url: abs(settings.site_logo) } } : {}),
    },
    ...(post.category_name ? { articleSection: post.category_name } : {}),
    ...(post.tags && post.tags.length ? { keywords: post.tags.map((tag) => tag.name).join(", ") } : {}),
  };
}

export function collectionLd({ name, description, url, items }) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: abs(url),
    inLanguage: "vi-VN",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: abs(`/bai-viet/${encodeURIComponent(post.slug)}`),
        name: post.title,
      })),
    },
  };
}
