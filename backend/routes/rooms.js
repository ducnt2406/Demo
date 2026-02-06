const express = require('express');
const router = express.Router();
const pool = require('../config/database');

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
router.post('/create', async (req, res) => {
  try {
    const { name, createdBy, createdByName } = req.body;

    if (!name || !createdBy) {
      return res.status(400).json({ error: 'Name and createdBy are required' });
    }

    let roomCode;
    let isUnique = false;
    
    while (!isUnique) {
      roomCode = generateRoomCode();
      const existing = await pool.query(
        'SELECT id FROM rooms WHERE code = $1',
        [roomCode]
      );
      if (existing.rows.length === 0) {
        isUnique = true;
      }
    }

    const result = await pool.query(
      `INSERT INTO rooms (name, code, created_by, created_by_name, status, created_at) 
       VALUES ($1, $2, $3, $4, 'active', NOW()) 
       RETURNING *`,
      [name, roomCode, createdBy, createdByName]
    );

    const room = result.rows[0];

    await pool.query(
      `INSERT INTO room_members (room_id, user_id, role, joined_at) 
       VALUES ($1, $2, 'host', NOW())`,
      [room.id, createdBy]
    );

    res.status(201).json({
      success: true,
      room: room
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.post('/join', async (req, res) => {
  try {
    const { code, userId } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Room code is required' });
    }

    const result = await pool.query(
      'SELECT * FROM rooms WHERE code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = result.rows[0];

    if (userId) {
      try {
        await pool.query(
          'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT (room_id, user_id) DO NOTHING',
          [room.id, userId]
        );
      } catch (memberError) {
        console.error('Error adding room member:', memberError);
      }
    }

    res.json({
      success: true,
      room: room
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { userId } = req.query; // Nhận userId từ query params

    const result = await pool.query(
      'SELECT * FROM rooms WHERE code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = result.rows[0];

    // Kiểm tra membership nếu userId được cung cấp
    if (userId) {
      const memberCheck = await pool.query(
        'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id = $2',
        [room.id, userId]
      );

      // Nếu không phải member và cũng không phải creator, từ chối truy cập
      if (memberCheck.rows.length === 0 && room.created_by !== userId) {
        return res.status(403).json({ 
          error: 'Access denied. You are not a member of this room.',
          code: 'NOT_MEMBER'
        });
      }
    }

    res.json({
      success: true,
      room: room
    });
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT r.id, r.name, r.code, r.created_by, r.created_by_name, r.status, r.created_at, r.updated_at
       FROM rooms r
       LEFT JOIN room_members rm ON r.id = rm.room_id
       WHERE r.created_by = $1 OR rm.user_id = $1
       GROUP BY r.id
       ORDER BY r.updated_at DESC`,
      [userId]
    );

    const roomsWithData = await Promise.all(result.rows.map(async (room) => {
      const lastMessage = await pool.query(
        `SELECT content, user_name, created_at 
         FROM messages 
         WHERE room_id = $1 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [room.id]
      );

      return {
        ...room,
        last_message: lastMessage.rows[0]?.content || null,
        last_message_sender: lastMessage.rows[0]?.user_name || null,
        last_message_time: lastMessage.rows[0]?.created_at || null
      };
    }));

    roomsWithData.sort((a, b) => {
      const timeA = a.last_message_time || a.created_at;
      const timeB = b.last_message_time || b.created_at;
      return new Date(timeB) - new Date(timeA);
    });

    res.json({
      success: true,
      rooms: roomsWithData
    });
  } catch (error) {
    console.error('Error fetching user rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Update room (name, etc.)
router.patch('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { name, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const roomResult = await pool.query(
      'SELECT * FROM rooms WHERE code = $1',
      [roomCode]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    if (room.created_by !== userId) {
      return res.status(403).json({ error: 'Only the room host can update the room' });
    }

    if (name) {
      await pool.query(
        'UPDATE rooms SET name = $1, updated_at = NOW() WHERE id = $2',
        [name, room.id]
      );
    }

    const updatedRoom = await pool.query(
      'SELECT * FROM rooms WHERE id = $1',
      [room.id]
    );

    res.json({
      success: true,
      room: updatedRoom.rows[0]
    });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

router.delete('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const roomResult = await pool.query(
      'SELECT * FROM rooms WHERE code = $1',
      [roomCode]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    if (room.created_by !== userId) {
      return res.status(403).json({ error: 'Only the room host can delete the room' });
    }

    await pool.query('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = $1)', [room.id]);
    await pool.query('DELETE FROM messages WHERE room_id = $1', [room.id]);
    await pool.query('DELETE FROM room_members WHERE room_id = $1', [room.id]);
    await pool.query('DELETE FROM notifications WHERE room_code = $1', [roomCode]);
    await pool.query('DELETE FROM rooms WHERE id = $1', [room.id]);

    res.json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
