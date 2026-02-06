const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/room/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;

    const roomResult = await pool.query(
      'SELECT id FROM rooms WHERE code = $1',
      [roomCode]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const roomId = roomResult.rows[0].id;

    const result = await pool.query(
      `SELECT rm.user_id, rm.role, rm.joined_at,
              COALESCE(
                (SELECT user_name FROM messages WHERE user_id = rm.user_id LIMIT 1),
                rm.user_id
              ) as user_name
       FROM room_members rm
       WHERE rm.room_id = $1
       ORDER BY 
         CASE WHEN rm.role = 'host' THEN 0 ELSE 1 END,
         rm.joined_at ASC`,
      [roomId]
    );

    res.json({
      success: true,
      members: result.rows
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

router.delete('/room/:roomCode/kick/:userId', async (req, res) => {
  try {
    const { roomCode, userId } = req.params;
    const { requestUserId } = req.body; // User making the request

    if (!requestUserId) {
      return res.status(400).json({ error: 'Request user ID is required' });
    }

    const roomResult = await pool.query(
      'SELECT id, created_by FROM rooms WHERE code = $1',
      [roomCode]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    // Check if request user is host
    if (room.created_by !== requestUserId) {
      return res.status(403).json({ error: 'Only host can kick members' });
    }

    if (userId === room.created_by) {
      return res.status(400).json({ error: 'Cannot kick the host' });
    }

    await pool.query(
      'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room.id, userId]
    );

    // Get socket instance from app
    const io = req.app.get('io');
    if (io) {
      // Notify the kicked user
      io.to(`user-${userId}`).emit('kicked-from-room', {
        roomCode,
        roomId: room.id
      });
      
      // Notify all room members
      io.to(roomCode).emit('member-kicked', {
        userId,
        roomCode
      });
    }

    res.json({
      success: true,
      message: 'Member kicked successfully'
    });
  } catch (error) {
    console.error('Error kicking member:', error);
    res.status(500).json({ error: 'Failed to kick member' });
  }
});

router.patch('/room/:roomCode/status', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { status, requestUserId } = req.body;

    if (!requestUserId) {
      return res.status(400).json({ error: 'Request user ID is required' });
    }

    if (!['active', 'frozen', 'deleted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const roomResult = await pool.query(
      'SELECT id, created_by FROM rooms WHERE code = $1',
      [roomCode]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    // Check if request user is host
    if (room.created_by !== requestUserId) {
      return res.status(403).json({ error: 'Only host can change room status' });
    }

    await pool.query(
      'UPDATE rooms SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, room.id]
    );

    res.json({
      success: true,
      status: status,
      message: `Room ${status === 'frozen' ? 'frozen' : status === 'deleted' ? 'deleted' : 'activated'} successfully`
    });
  } catch (error) {
    console.error('Error updating room status:', error);
    res.status(500).json({ error: 'Failed to update room status' });
  }
});

module.exports = router;
