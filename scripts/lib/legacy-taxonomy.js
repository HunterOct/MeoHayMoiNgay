export const LEGACY_CATEGORIES = {
  tips: { name: "Mẹo vặt", slug: "meo-vat", group: "life", sort: 10, description: "Mẹo nhỏ xử lý việc nhà nhanh gọn, không tốn tiền." },
  home: { name: "Nhà cửa", slug: "nha-cua", group: "life", sort: 20, description: "Giữ nhà sạch, thơm, gọn và dễ chịu hơn mỗi ngày." },
  health: { name: "Sức khỏe", slug: "suc-khoe", group: "life", sort: 30, description: "Thói quen nhỏ giúp ngủ ngon, đỡ mỏi và khỏe hơn." },
  food: { name: "Ăn uống", slug: "an-uong", group: "life", sort: 40, description: "Bảo quản thực phẩm, nấu ăn và tiết kiệm thời gian." },
  wifi: { name: "Wifi & Mạng", slug: "wifi-mang", group: "tech", sort: 50, description: "Xử lý wifi chậm, sóng yếu và sự cố mạng trong nhà." },
  phone: { name: "Điện thoại", slug: "dien-thoai", group: "tech", sort: 60, description: "Giữ điện thoại nhanh, mượt và an toàn hơn." },
  security: { name: "Bảo mật", slug: "bao-mat", group: "tech", sort: 70, description: "Bảo vệ tài khoản, dữ liệu và tránh lừa đảo trực tuyến." },
};

export const LEGACY_TAGS = [
  { name: "wifi chậm", keywords: ["wifi chậm", "wifi yếu", "sóng yếu", "mạng chậm", "lag"] },
  { name: "router", keywords: ["router", "modem", "bộ phát"] },
  { name: "mạng internet", keywords: ["internet", "nhà mạng", "cáp quang"] },
  { name: "pin điện thoại", keywords: ["pin", "sạc", "hao pin", "chai pin"] },
  { name: "android", keywords: ["android"] },
  { name: "iphone", keywords: ["iphone", "ios"] },
  { name: "dung lượng máy", keywords: ["dung lượng", "bộ nhớ", "đầy máy", "lag máy"] },
  { name: "ứng dụng", keywords: ["ứng dụng", "app"] },
  { name: "mật khẩu", keywords: ["mật khẩu", "đăng nhập", "password"] },
  { name: "tài khoản", keywords: ["tài khoản", "2fa", "xác thực hai"] },
  { name: "lừa đảo", keywords: ["lừa đảo", "giả mạo", "chiếm đoạt"] },
  { name: "bảo vệ dữ liệu", keywords: ["dữ liệu", "sao lưu", "backup"] },
  { name: "bảo quản thực phẩm", keywords: ["bảo quản", "để được lâu", "tươi lâu", "ôi thiu"] },
  { name: "rau củ", keywords: ["rau", "củ", "trái cây"] },
  { name: "tủ lạnh", keywords: ["tủ lạnh", "ngăn mát", "ngăn đá"] },
  { name: "nấu ăn", keywords: ["nấu", "chiên", "luộc", "hấp"] },
  { name: "khử mùi", keywords: ["khử mùi", "mùi hôi", "mùi ẩm", "thơm"] },
  { name: "vệ sinh nhà", keywords: ["vệ sinh", "tẩy", "cọ rửa", "lau chùi"] },
  { name: "sắp xếp", keywords: ["sắp xếp", "gọn gàng", "ngăn nắp"] },
  { name: "quần áo", keywords: ["quần áo", "giặt", "áo trắng", "vết mực"] },
  { name: "vết bẩn", keywords: ["vết", "mực", "keo dính", "bám"] },
  { name: "giấc ngủ", keywords: ["ngủ", "mất ngủ", "khó ngủ"] },
  { name: "mỏi mắt", keywords: ["mắt", "mỏi mắt", "nhìn màn hình"] },
  { name: "đau lưng", keywords: ["lưng", "vai", "cổ", "tư thế"] },
  { name: "thư giãn", keywords: ["thư giãn", "căng thẳng", "stress"] },
  { name: "tiết kiệm", keywords: ["tiết kiệm", "không tốn tiền", "miễn phí"] },
];

function hasKeyword(text, keyword) {
  const needle = String(keyword)
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${needle}(?=$|[^\\p{L}\\p{N}])`, "u").test(text);
}

export function tagsForLegacy(article) {
  const text = `${article.title} ${article.excerpt} ${article.lede || ""}`.toLowerCase();
  const matches = [];
  for (const tag of LEGACY_TAGS) {
    if (tag.keywords.some((keyword) => hasKeyword(text, keyword))) matches.push(tag.name);
    if (matches.length >= 3) break;
  }
  return matches;
}
