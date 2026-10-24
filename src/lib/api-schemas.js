import { z } from "zod";

const safeUrl = z
  .string()
  .max(600)
  .refine(
    (value) =>
      value === "" ||
      (value.startsWith("/") && !value.startsWith("//")) ||
      /^https?:\/\//i.test(value),
    "URL phải là http(s) hoặc đường dẫn nội bộ bắt đầu bằng /.",
  );

const seoSchema = z
  .object({
    title: z.string().trim().max(80).optional(),
    description: z.string().trim().max(220).optional(),
    focus_keyword: z.string().trim().max(100).optional(),
    canonical_url: safeUrl.optional(),
    og_image: safeUrl.optional(),
  })
  .strict();

const sharedFields = {
  title: z.string().trim().min(3, "Tiêu đề tối thiểu 3 ký tự.").max(200),
  slug: z.string().trim().max(120).optional(),
  excerpt: z.string().trim().max(500).optional(),
  lede: z.string().trim().max(600).optional(),
  content: z.string().max(200_000).optional(),
  content_format: z.enum(["markdown", "html"]).optional(),
  category: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
  cover_image: safeUrl.optional(),
  cover_media_id: z.string().trim().max(64).optional(),
  cover_alt: z.string().trim().max(300).optional(),
  cover_caption: z.string().trim().max(300).optional(),
  seo: seoSchema.optional(),
  status: z.enum(["draft", "review", "published", "scheduled", "archived"]).optional(),
  scheduled_at: z.string().trim().max(40).optional(),
  is_featured: z.boolean().optional(),
  read_minutes: z.number().int().min(1).max(120).optional(),
  external_id: z.string().trim().min(1).max(200).optional(),
};

export const createPostSchema = z
  .object({
    ...sharedFields,
    status: z.enum(["draft", "review", "published", "scheduled"]).optional(),
  })
  .strict();

export const updatePostSchema = z
  .object(sharedFields)
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Cần ít nhất một trường để cập nhật.",
  });

export const scheduleSchema = z
  .object({
    scheduled_at: z.string().trim().min(10).max(40),
  })
  .strict();

export const unpublishSchema = z
  .object({
    status: z.enum(["draft", "review", "archived"]).optional(),
  })
  .strict();

export function validationDetails(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(body)",
    message: issue.message,
  }));
}
