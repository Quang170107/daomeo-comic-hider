# DaoMeo Comic Hider

Extension dành cho trình duyệt **Brave** / Chrome (Manifest V3) giúp ẩn các bộ truyện bạn không muốn thấy trên **DaoMeo (`daomeoden.net`)**.

## Tính năng chính

- **Ẩn nhanh bằng 1 click**: Di chuột vào bất kỳ ô truyện nào trên trang chủ, tìm kiếm, bảng xếp hạng hay truyện đề xuất rồi bấm nút biểu tượng con mắt gạch chéo ở góc trên. Có thông báo **Hoàn tác** trong 5 giây nếu bấm nhầm.
- **Ẩn theo Tag / Thể loại**: Mở popup → tab **Tag**, chọn nhanh từ danh sách tag/thể loại chính thức của DaoMeo (ví dụ `Boys' Love`, `Ngôn Tình`, `Smut`, `Adult`, `NTR`, `Harem`...) hoặc nhập tên tag bất kỳ (hỗ trợ cả không dấu, cách nhau bởi dấu phẩy). Extension tự động đọc tag từ dữ liệu trang chủ, API tìm kiếm và cache lại để ẩn các truyện mang tag đó.
- **Lọc tự động truyện 18+ (`R.18` / `18+`)**: Bật/tắt nhanh trong popup của extension.
- **Lọc theo từ khóa**: Nhập danh sách từ khóa để tự động ẩn mọi truyện có tên chứa từ khóa đó.
- **Chế độ hiển thị mờ (Peek mode)**: Tùy chọn làm mờ truyện bị ẩn thay vì ẩn hẳn để bạn dễ xem lại và bấm nút **Hiện lại** trực tiếp trên trang.
- **Quản lý & Sao lưu**: Xem danh sách truyện đã ẩn, tìm kiếm, bỏ ẩn từng bộ hoặc Xuất/Nhập file JSON để sao lưu (bao gồm truyện đã ẩn, tag chặn và từ khóa).

## Cách cài đặt trên Brave

1. Mở trình duyệt **Brave** và truy cập địa chỉ: `brave://extensions/`
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm nút **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục:
   `C:\Users\quang\.gemini\antigravity\scratch\daomeo-comic-hider`
5. Tải lại trang `daomeoden.net`, di chuột lên một truyện bất kỳ và bấm nút ẩn ở góc trên (hoặc bấm vào biểu tượng **DaoMeo Comic Hider** trên thanh công cụ để bật lọc `18+`, lọc **Tag** và từ khóa).

## Cập nhật sau khi chỉnh sửa code

Nếu bạn đã cài bản cũ trên Brave, sau khi cập nhật hãy vào `brave://extensions/`, bấm nút **Reload** (biểu tượng mũi tên xoay tròn) trên thẻ **DaoMeo Comic Hider**, rồi tải lại (`F5`) tab `daomeoden.net`.

## Nếu web đổi tên miền mới

Nếu sau này `daomeoden.net` đổi sang tên miền khác, bạn chỉ cần mở file `manifest.json`, thêm tên miền mới vào mục `"matches"` của cả 2 mục trong `"content_scripts"` (ví dụ `"*://*.tenmienmoi.net/*"`), lưu lại rồi bấm **Reload** tại `brave://extensions/`.
