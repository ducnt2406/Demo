# Kick vs Ban - Hành vi hiện tại

## ✅ Kick (Đuổi tạm thời) - Đang được sử dụng

### Cách hoạt động:
1. **Host kick user**: User bị xóa khỏi `room_members` và bị đuổi ra khỏi phòng
2. **User bị kick**: Nhận thông báo và bị chuyển về dashboard
3. **User có thể join lại**: ✅ Bằng cách nhập lại mã 6 số

### Bảo vệ:
- ❌ User nhấn vào notification cũ → Bị chặn (không còn là member)
- ✅ User nhập lại mã 6 số → Join lại được
- ❌ User truy cập trực tiếp URL cũ → Bị chặn (không còn là member)

### Lợi ích:
- Cho phép host đuổi user phá rối tạm thời
- User vẫn có cơ hội quay lại nếu cải thiện hành vi
- Linh hoạt, phù hợp với chat room thông thường

---

## 🔒 Ban (Cấm vĩnh viễn) - KHÔNG được sử dụng

### Nếu muốn kích hoạt BAN vĩnh viễn:
Cần uncomment code trong:
- `backend/routes/rooms.js` - Thêm kiểm tra `kicked_members` trong API join
- `backend/routes/members.js` - Thêm user vào `kicked_members` khi kick

### Khi BAN được kích hoạt:
- User bị ban không thể join lại bằng bất kỳ cách nào
- Chỉ admin/host có thể unban (cần implement thêm)

---

## Testing

### Test Kick:
1. User A (host) kick User B
2. User B bị đuổi về dashboard ✓
3. User B nhấn notification → Bị chặn ✓
4. User B nhập lại mã 6 số → Join lại được ✓

### Kết quả: Kick hoạt động như mong muốn!
