import { z } from "zod";

export const stagingPostSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    slug: z.string().trim().max(120).optional(),
    excerpt: z.string().trim().max(500).optional(),
    lede: z.string().trim().max(600).optional(),
    content: z.string().max(200_000).optional(),
    content_format: z.enum(["markdown", "html"]).optional(),
    category: z.string().trim().max(120).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
    status: z.enum(["draft", "review", "published", "scheduled"]).optional(),
    scheduled_at: z.string().trim().max(40).optional(),
    external_id: z.string().trim().min(1).max(200).optional(),
    cover_image: z.string().max(600).optional(),
    cover_alt: z.string().max(300).optional(),
  })
  .strict();
