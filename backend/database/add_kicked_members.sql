-- Tạo bảng để lưu những người dùng bị kick khỏi phòng
CREATE TABLE IF NOT EXISTS kicked_members (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  kicked_by VARCHAR(255),
  kicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  UNIQUE(room_id, user_id)
);

-- Tạo index để tăng tốc truy vấn
CREATE INDEX IF NOT EXISTS idx_kicked_members_room_id ON kicked_members(room_id);
CREATE INDEX IF NOT EXISTS idx_kicked_members_user_id ON kicked_members(user_id);
