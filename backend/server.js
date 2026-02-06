require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.json({ message: 'Learning Platform API is running' });
});

const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const memberRoutes = require('./routes/members');
const notificationRoutes = require('./routes/notifications');

app.use('/api/rooms', roomRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/notifications', notificationRoutes);

// Track online users per room
const onlineUsers = new Map(); // roomCode -> Set of userIds

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join-user', (userId) => {
    socket.userId = userId;
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined personal channel`);
  });

  socket.on('join-room', async (roomCode, userId) => {
    try {
      const roomQuery = await pool.query(
        'SELECT * FROM rooms WHERE code = $1',
        [roomCode]
      );

      if (roomQuery.rows.length === 0) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      socket.join(roomCode);
      socket.currentRoom = roomCode;
      socket.currentUserId = userId;
      
      // Track online user
      if (!onlineUsers.has(roomCode)) {
        onlineUsers.set(roomCode, new Set());
      }
      onlineUsers.get(roomCode).add(userId);
      
      // Send current online users to the joining user
      const onlineList = Array.from(onlineUsers.get(roomCode) || []);
      socket.emit('joined-room', { roomCode, room: roomQuery.rows[0], onlineUsers: onlineList });
      
      // Notify others about new online user
      socket.to(roomCode).emit('user-online', { userId, onlineUsers: onlineList });
      
      console.log(`User ${userId} joined room ${roomCode}`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('leave-room', (roomCode, userId) => {
    socket.leave(roomCode);
    
    // Remove from online users
    if (onlineUsers.has(roomCode)) {
      onlineUsers.get(roomCode).delete(userId);
      const onlineList = Array.from(onlineUsers.get(roomCode) || []);
      socket.to(roomCode).emit('user-offline', { userId, onlineUsers: onlineList });
    }
    
    console.log(`User ${userId} left room ${roomCode}`);
  });

  socket.on('send-message', async (data) => {
    try {
      const { roomCode, message, userId, userName, type, fileUrl, replyToId } = data;

      const result = await pool.query(
        `INSERT INTO messages (room_id, user_id, user_name, content, type, file_url, reply_to_id, created_at) 
         VALUES ((SELECT id FROM rooms WHERE code = $1), $2, $3, $4, $5, $6, $7, NOW()) 
         RETURNING *`,
        [roomCode, userId, userName, message, type || 'text', fileUrl || null, replyToId || null]
      );

      const savedMessage = result.rows[0];

      io.to(roomCode).emit('receive-message', savedMessage);
      
      const membersResult = await pool.query(
        `SELECT rm.user_id 
         FROM room_members rm 
         JOIN rooms r ON r.id = rm.room_id 
         WHERE r.code = $1 AND rm.user_id != $2`,
        [roomCode, userId]
      );

      for (const member of membersResult.rows) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, room_code, message_id, from_user_id, from_user_name, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            member.user_id,
            'new_message',
            `${userName} sent a message`,
            message.substring(0, 100),
            roomCode,
            savedMessage.id,
            userId,
            userName
          ]
        );

        io.to(`user-${member.user_id}`).emit('new-notification', {
          type: 'new_message',
          roomCode,
          fromUserName: userName,
          message: message.substring(0, 100)
        });
      }
      
      console.log(`Message sent to room ${roomCode}`);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('typing', (data) => {
    socket.to(data.roomCode).emit('user-typing', {
      userId: data.userId,
      userName: data.userName
    });
  });

  socket.on('stop-typing', (data) => {
    socket.to(data.roomCode).emit('user-stop-typing', {
      userId: data.userId
    });
  });

  socket.on('message-reaction', (data) => {
    socket.to(data.roomCode).emit('message-reaction', {
      messageId: data.messageId,
      reactions: data.reactions
    });
  });

  socket.on('message-edited', (data) => {
    socket.to(data.roomCode).emit('message-edited', {
      messageId: data.messageId,
      content: data.content
    });
  });

  socket.on('message-deleted', (data) => {
    socket.to(data.roomCode).emit('message-deleted', {
      messageId: data.messageId
    });
  });

  socket.on('message-pinned', (data) => {
    socket.to(data.roomCode).emit('message-pinned', {
      messageId: data.messageId,
      isPinned: data.isPinned
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove user from all rooms they were in
    if (socket.currentRoom && socket.currentUserId) {
      if (onlineUsers.has(socket.currentRoom)) {
        onlineUsers.get(socket.currentRoom).delete(socket.currentUserId);
        const onlineList = Array.from(onlineUsers.get(socket.currentRoom) || []);
        io.to(socket.currentRoom).emit('user-offline', { 
          userId: socket.currentUserId, 
          onlineUsers: onlineList 
        });
      }
    }
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };
