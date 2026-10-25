export const SITE = {
  name: "Mẹo Hay Mỗi Ngày",
  tagline: "Mẹo vặt đời sống & công nghệ — dễ làm, không tốn tiền",
  description:
    "Mẹo Hay Mỗi Ngày — blog mẹo vặt đời sống: nhà cửa gọn thơm, ăn uống và bảo quản thực phẩm, ngủ ngon khỏe người, cùng mẹo công nghệ như wifi nhanh hơn, điện thoại mượt hơn. Mỗi bài một vấn đề, làm theo từng bước trong vài phút.",
  locale: "vi_VN",
  lang: "vi",
  authorFallback: "Bé Dâu",
};

export const config = {
  siteUrl: "http://localhost:8787",
  timezone: "Asia/Ho_Chi_Minh",
  secureCookies: false,
  blockAiCrawlers: true,
  blockScraperUas: true,
};

export function setSiteUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return;
  config.siteUrl = url;
  config.secureCookies = url.startsWith("https://");
}
