# Migration: Thêm bảng kicked_members (OPTIONAL - Không dùng trong version hiện tại)

## Lưu ý
**Bảng này đã được tạo nhưng KHÔNG được sử dụng trong logic hiện tại.**

Kick chỉ là đuổi tạm thời - user bị kick vẫn có thể join lại bằng mã 6 số.

## Hành vi hiện tại:
- **Kick user**: Xóa khỏi room_members, đuổi ra khỏi phòng
- **User nhấn notification**: Bị từ chối vì không còn là member
- **User nhập lại mã 6 số**: ✅ Được phép join lại

## Nếu muốn BAN vĩnh viễn trong tương lai:
Kích hoạt lại logic kiểm tra `kicked_members` trong:
- `backend/routes/rooms.js` - API POST `/join`
- `backend/routes/members.js` - Khi kick user, thêm vào bảng

## Cách chạy migration (nếu chưa chạy):
```sql
CREATE TABLE IF NOT EXISTS kicked_members (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  kicked_by VARCHAR(255),
  kicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_kicked_members_room_id ON kicked_members(room_id);
CREATE INDEX IF NOT EXISTS idx_kicked_members_user_id ON kicked_members(user_id);
```
