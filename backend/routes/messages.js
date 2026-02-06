const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB default
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and documents are allowed!'));
    }
  }
});

router.get('/room/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT m.* FROM messages m
       JOIN rooms r ON m.room_id = r.id
       WHERE r.code = $1 AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [roomCode, limit, offset]
    );

    res.json({
      success: true,
      messages: result.rows.reverse()
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      file: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

router.patch('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, userId } = req.body;

    if (!content || !userId) {
      return res.status(400).json({ error: 'Content and userId are required' });
    }

    const checkResult = await pool.query(
      'SELECT user_id FROM messages WHERE id = $1',
      [messageId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (checkResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }

    const result = await pool.query(
      `UPDATE messages 
       SET content = $1, is_edited = TRUE, edited_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [content, messageId]
    );

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

router.delete('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Check if user owns the message
    const checkResult = await pool.query(
      'SELECT user_id FROM messages WHERE id = $1',
      [messageId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (checkResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    const result = await pool.query(
      `UPDATE messages 
       SET is_deleted = TRUE, content = 'Message deleted' 
       WHERE id = $1 
       RETURNING *`,
      [messageId]
    );

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

router.post('/:messageId/react', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId, userName, emoji } = req.body;

    if (!userId || !emoji) {
      return res.status(400).json({ error: 'userId and emoji are required' });
    }

    const messageCheck = await pool.query(
      'SELECT id FROM messages WHERE id = $1',
      [messageId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const result = await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, user_name, emoji, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (message_id, user_id) 
       DO UPDATE SET emoji = $4, created_at = NOW()
       RETURNING *`,
      [messageId, userId, userName, emoji]
    );

    res.json({
      success: true,
      reaction: result.rows[0]
    });
  } catch (error) {
    console.error('Error reacting to message:', error);
    res.status(500).json({ error: 'Failed to react to message' });
  }
});

router.delete('/:messageId/react', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await pool.query(
      'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
      [messageId, userId]
    );

    res.json({
      success: true,
      message: 'Reaction removed'
    });
  } catch (error) {
    console.error('Error removing reaction:', error);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

router.get('/:messageId/reactions', async (req, res) => {
  try {
    const { messageId } = req.params;

    const result = await pool.query(
      'SELECT * FROM message_reactions WHERE message_id = $1 ORDER BY created_at ASC',
      [messageId]
    );

    res.json({
      success: true,
      reactions: result.rows
    });
  } catch (error) {
    console.error('Error fetching reactions:', error);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

router.patch('/:messageId/pin', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId, roomCode } = req.body;

    if (!userId || !roomCode) {
      return res.status(400).json({ error: 'userId and roomCode are required' });
    }

    // Check if user is host
    const roomCheck = await pool.query(
      'SELECT created_by FROM rooms WHERE code = $1',
      [roomCode]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (roomCheck.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only host can pin messages' });
    }

    const result = await pool.query(
      `UPDATE messages 
       SET is_pinned = TRUE, pinned_at = NOW(), pinned_by = $1
       WHERE id = $2
       RETURNING *`,
      [userId, messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error pinning message:', error);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

router.patch('/:messageId/unpin', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId, roomCode } = req.body;

    if (!userId || !roomCode) {
      return res.status(400).json({ error: 'userId and roomCode are required' });
    }

    // Check if user is host
    const roomCheck = await pool.query(
      'SELECT created_by FROM rooms WHERE code = $1',
      [roomCode]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (roomCheck.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only host can unpin messages' });
    }

    const result = await pool.query(
      `UPDATE messages 
       SET is_pinned = FALSE, pinned_at = NULL, pinned_by = NULL
       WHERE id = $1
       RETURNING *`,
      [messageId]
    );

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error unpinning message:', error);
    res.status(500).json({ error: 'Failed to unpin message' });
  }
});

router.post('/:messageId/seen', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await pool.query(
      `INSERT INTO message_seen (message_id, user_id, seen_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [messageId, userId]
    );

    res.json({
      success: true,
      message: 'Message marked as seen'
    });
  } catch (error) {
    console.error('Error marking message as seen:', error);
    res.status(500).json({ error: 'Failed to mark message as seen' });
  }
});

router.get('/search/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const result = await pool.query(
      `SELECT m.* FROM messages m
       JOIN rooms r ON m.room_id = r.id
       WHERE r.code = $1 
         AND m.is_deleted = FALSE 
         AND m.content ILIKE $2
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [roomCode, `%${query}%`]
    );

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

module.exports = router;
