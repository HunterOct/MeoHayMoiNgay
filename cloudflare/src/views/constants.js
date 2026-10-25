export const GROUP_META = {
  life: { name: "Đời sống", slug: "doi-song" },
  tech: { name: "Công nghệ", slug: "cong-nghe" },
};

export const CHECKLISTS = {
  network: {
    key: "network",
    title: "Checklist: Mạng ổn định trong 15 phút",
    sub: "Bấm từng mục khi làm xong. Làm hết 7 mục rồi đo lại tốc độ.",
    done: "Xong cả 7 mục. Đo lại tốc độ ở chỗ hay ngồi — nếu vẫn chậm khi đứng cạnh router, lúc đó mới cần gọi nhà mạng.",
    items: [
      "Đo tốc độ cạnh router và ở chỗ hay ngồi",
      "Khởi động lại router, chờ 2–3 phút",
      "Đặt router cao, thoáng, giữa nhà",
      "Ở gần dùng 5GHz, ở xa dùng 2.4GHz",
      "Đổi sang kênh wifi ít nhiễu (1, 6 hoặc 11)",
      "Kiểm tra thiết bị ngốn mạng và thiết bị lạ",
      "Đổi mật khẩu wifi + mật khẩu quản trị router",
    ],
  },
  phone: {
    key: "phone",
    title: "Checklist: Điện thoại nhẹ và mượt hơn",
    sub: "Làm 6 bước này trước khi cài thêm app dọn rác.",
    done: "Xong 6 bước. Máy vẫn nóng/lag thì kiểm tra pin và bộ nhớ trước khi cài app dọn rác.",
    items: [
      "Xóa ảnh chụp màn hình và file tải về không dùng",
      "Tắt app chạy nền không cần thiết",
      "Xóa cache của app nặng (không xóa dữ liệu)",
      "Cập nhật app và hệ điều hành",
      "Kiểm tra dung lượng trống, giữ trên 10%",
      "Bật sao lưu ảnh/danh bạ trước khi dọn",
    ],
  },
  kitchen: {
    key: "kitchen",
    title: "Checklist: Bếp gọn trong 15 phút",
    sub: "Dọn nhanh trước khi nấu, không cần mua thêm đồ.",
    done: "Bếp đã gọn. Giữ thói quen dọn 5 phút sau mỗi bữa để không dồn việc.",
    items: [
      "Dọn bồn rửa và úp bát đã khô",
      "Lau mặt bếp và tay nắm cửa",
      "Gom đồ hết hạn trong tủ lạnh",
      "Sắp lại một ngăn tủ lạnh",
      "Lau vòi nước và xử lý mùi bồn rửa",
      "Đổ rác và thay túi rác",
    ],
  },
  cleaning: {
    key: "cleaning",
    title: "Checklist: Nhà thơm tho trong 15 phút",
    sub: "Ưu tiên mùi và bụi — làm từng khu vực nhỏ.",
    done: "Xong 6 bước. Mở cửa thêm 10 phút để nhà khô và thoáng.",
    items: [
      "Mở cửa sổ cho không khí lưu thông",
      "Thay khăn lau và vỏ gối",
      "Lau bụi mặt bàn, kệ và tay nắm",
      "Hút bụi hoặc quét khu vực hay đi",
      "Đổ rác, buộc kín túi",
      "Nhỏ tinh dầu nhẹ hoặc đặt baking soda hút mùi",
    ],
  },
  sleep: {
    key: "sleep",
    title: "Checklist: Ngủ ngon hơn tối nay",
    sub: "Làm 6 mục này trong 15 phút trước giờ ngủ.",
    done: "Xong 6 mục. Nếu vẫn khó ngủ, giữ giờ thức dậy cố định vài ngày trước khi thay đổi thêm.",
    items: [
      "Tắt màn hình ít nhất 30 phút trước ngủ",
      "Giảm đèn phòng và để phòng mát",
      "Không cà phê/trà đặc sau 15h",
      "Dọn giường, gấp chăn gọn",
      "Thử hít thở 4–7–8 vài vòng",
      "Đặt điện thoại xa đầu giường",
    ],
  },
  security: {
    key: "security",
    title: "Checklist: Bảo mật tài khoản trong 15 phút",
    sub: "Làm 6 bước quan trọng nhất, không cần cài app lạ.",
    done: "Xong 6 bước. Kiểm tra lại thiết bị đăng nhập và bật thông báo bảo mật.",
    items: [
      "Bật xác thực hai lớp cho email chính",
      "Đổi mật khẩu yếu hoặc dùng lại",
      "Không đọc OTP cho bất kỳ ai",
      "Kiểm tra quyền app trên điện thoại",
      "Xem lại thiết bị đang đăng nhập",
      "Bật sao lưu mã khôi phục",
    ],
  },
};

const CHECKLIST_ROTATION = ["network", "phone", "kitchen", "sleep", "cleaning", "security"];

export function checklistFor({ group = "", categorySlug = "", day = new Date().getUTCDate() } = {}) {
  const byCategory = {
    "wifi-mang": "network",
    "dien-thoai": "phone",
    "bao-mat": "security",
    "an-uong": "kitchen",
    "suc-khoe": "sleep",
    "nha-cua": "cleaning",
    "meo-vat": "cleaning",
  };
  if (categorySlug && byCategory[categorySlug]) return CHECKLISTS[byCategory[categorySlug]];
  const source = group === "tech"
    ? ["network", "phone", "security"]
    : group === "life"
      ? ["kitchen", "cleaning", "sleep"]
      : CHECKLIST_ROTATION;
  return CHECKLISTS[source[Math.abs(Number(day) || 0) % source.length]];
}

export const TIPS = [
  {
    title: "Khử mùi tủ lạnh bằng baking soda",
    text: "Để một chén baking soda mở nắp trong ngăn mát, 2–3 tuần thay một lần. Nó hút mùi từ từ, êm hơn xịt thơm và không át mùi thức ăn.",
  },
  {
    title: "Rau thơm tươi lâu gần gấp đôi",
    text: "Bọc rau thơm trong khăn giấy hơi ẩm rồi cho vào hộp kín để ngăn mát. Rau giữ được độ giòn và xanh gần một tuần thay vì hai ngày.",
  },
  {
    title: "Khởi động lại router mỗi tháng",
    text: "Tắt nguồn 30 giây rồi bật lại. Router chạy liên tục nhiều tuần dễ tràn bộ nhớ và treo tiến trình — đây là cách kỹ thuật viên nào cũng làm đầu tiên.",
  },
];

export const ABOUT_TEXT =
  "Mẹo Hay Mỗi Ngày chia sẻ mẹo vặt cho cuộc sống hằng ngày: nhà cửa gọn gàng thơm tho, bảo quản đồ ăn đúng cách, ngủ ngon khỏe người, cùng những trục trặc công nghệ quen thuộc như wifi chậm, điện thoại lag. Bài nào cũng đi từ dễ đến khó, làm được ngay tại nhà.";

export const AUTHOR_BIO =
  "Người viết Mẹo Hay Mỗi Ngày — chuyên săn những mẹo vặt đời sống và trục trặc công nghệ trong nhà, cách xử lý gọn nhất, ưu tiên cách không tốn tiền trước.";
