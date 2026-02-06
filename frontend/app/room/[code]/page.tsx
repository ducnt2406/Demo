'use client'

import { useEffect, useState, useRef } from 'react'
import { useUser, UserButton } from '@clerk/nextjs'
import { useParams, useRouter } from 'next/navigation'
import axios from 'axios'
import toast from 'react-hot-toast'
import { io, Socket } from 'socket.io-client'
import { Send, Paperclip, ArrowLeft, Users, Image as ImageIcon, FileText, MoreVertical, Trash2, Edit, Home, Pin, Reply, Smile, X, Check, Search, Settings } from 'lucide-react'

interface Message {
  id: number
  user_id: string
  user_name: string
  content: string
  type: string
  file_url?: string
  created_at: string
  is_edited?: boolean
  is_deleted?: boolean
  is_pinned?: boolean
  reply_to_id?: number
  reactions?: Array<{emoji: string, user_id: string, user_name: string}>
}

interface Room {
  id: number
  name: string
  code: string
  created_by: string
  created_by_name: string
}

export default function RoomPage() {
  const { user, isLoaded } = useUser()
  const params = useParams()
  const router = useRouter()
  const roomCode = params.code as string

  const [socket, setSocket] = useState<Socket | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [typing, setTyping] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [showMessageMenu, setShowMessageMenu] = useState<number | null>(null)
  const [editingMessage, setEditingMessage] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState<number | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  const [members, setMembers] = useState<Array<{user_id: string, user_name: string, role: string}>>([])
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [showImagePreview, setShowImagePreview] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showRoomSettings, setShowRoomSettings] = useState(false)
  const [roomSettings, setRoomSettings] = useState({name: '', allowInvites: true, allowFileUpload: true})
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout>()

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

  useEffect(() => {
    if (isLoaded && user) {
      initializeRoom()
    }

    return () => {
      if (socket) {
        socket.emit('leave-room', roomCode, user?.id)
        socket.disconnect()
      }
    }
  }, [isLoaded, user, roomCode])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Auto-mark messages as seen
  useEffect(() => {
    const markMessagesAsSeen = async () => {
      if (!user?.id || messages.length === 0) return
      
      // Mark last 10 messages as seen
      const recentMessages = messages.slice(-10)
      for (const message of recentMessages) {
        if (message.user_id !== user?.id) {
          try {
            await axios.post(`${API_URL}/api/messages/${message.id}/seen`, {
              userId: user?.id
            })
          } catch (error) {
            // Silent fail for seen status
          }
        }
      }
    }
    
    const timer = setTimeout(markMessagesAsSeen, 1000)
    return () => clearTimeout(timer)
  }, [messages, user?.id])

  const initializeRoom = async () => {
    try {
      // Kiểm tra quyền truy cập bằng cách gửi userId
      const roomResponse = await axios.get(`${API_URL}/api/rooms/${roomCode}`, {
        params: { userId: user?.id }
      })
      setRoom(roomResponse.data.room)

      const messagesResponse = await axios.get(`${API_URL}/api/messages/room/${roomCode}`)
      setMessages(messagesResponse.data.messages)

      const newSocket = io(API_URL)
      setSocket(newSocket)

      newSocket.on('connect', () => {
        console.log('Connected to server')
        newSocket.emit('join-user', user?.id)
        newSocket.emit('join-room', roomCode, user?.id)
      })

      newSocket.on('joined-room', (data) => {
        console.log('Joined room:', data)
        setOnlineUsers(new Set(data.onlineUsers || []))
        toast.success('Joined room!')
      })

      newSocket.on('user-online', (data) => {
        setOnlineUsers(new Set(data.onlineUsers || []))
      })

      newSocket.on('user-offline', (data) => {
        setOnlineUsers(new Set(data.onlineUsers || []))
      })

      newSocket.on('receive-message', (message: Message) => {
        setMessages((prev) => {
          const exists = prev.some(m => m.id === message.id)
          if (exists) return prev
          return [...prev, message]
        })
      })

      newSocket.on('message-reaction', (data) => {
        setMessages((prev) => prev.map(msg => 
          msg.id === data.messageId 
            ? { ...msg, reactions: data.reactions }
            : msg
        ))
      })

      newSocket.on('message-edited', (data) => {
        setMessages((prev) => prev.map(msg => 
          msg.id === data.messageId 
            ? { ...msg, content: data.content, is_edited: true }
            : msg
        ))
      })

      newSocket.on('message-deleted', (data) => {
        setMessages((prev) => prev.map(msg => 
          msg.id === data.messageId 
            ? { ...msg, content: 'Message deleted', is_deleted: true }
            : msg
        ))
      })

      newSocket.on('message-pinned', (data) => {
        setMessages((prev) => prev.map(msg => 
          msg.id === data.messageId 
            ? { ...msg, is_pinned: data.isPinned }
            : msg
        ))
      })

      newSocket.on('user-joined', (data) => {
        toast.success('New user joined the room')
        fetchMembers()
      })

      newSocket.on('user-left', (data) => {
        toast('User left the room')
        fetchMembers()
      })

      newSocket.on('member-kicked', (data) => {
        fetchMembers()
      })

      newSocket.on('kicked-from-room', (data) => {
        toast.error('You have been removed from this room')
        setTimeout(() => {
          router.push('/dashboard')
        }, 1000)
      })

      newSocket.on('user-typing', (data) => {
        setTyping((prev) => [...prev.filter(name => name !== data.userName), data.userName])
      })

      newSocket.on('user-stop-typing', (data) => {
        setTyping((prev) => prev.filter(name => name !== data.userName))
      })

      newSocket.on('error', (error) => {
        toast.error(error.message)
      })

      setLoading(false)
    } catch (error: any) {
      console.error('Error initializing room:', error)
      if (error.response?.status === 404) {
        toast.error('Room not found')
        router.push('/dashboard')
      } else if (error.response?.status === 403 || error.response?.data?.code === 'NOT_MEMBER') {
        toast.error('You are not a member of this room. Please join using the room code.')
        router.push('/dashboard')
      } else {
        toast.error('Cannot load room')
      }
      setLoading(false)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputMessage.trim() || !socket) return

    const messageData = {
      roomCode,
      message: inputMessage,
      userId: user?.id,
      userName: user?.fullName || user?.username || 'Anonymous',
      type: 'text',
      replyToId: replyingTo?.id
    }

    socket.emit('send-message', messageData)
    setInputMessage('')
    setReplyingTo(null)
    handleStopTyping()
  }

  const handleTyping = () => {
    if (!socket) return

    socket.emit('typing', {
      roomCode,
      userId: user?.id,
      userName: user?.fullName || user?.username || 'Anonymous'
    })

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      handleStopTyping()
    }, 2000)
  }

  const handleStopTyping = () => {
    if (!socket) return
    
    socket.emit('stop-typing', {
      roomCode,
      userId: user?.id
    })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !socket) return

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large! Maximum 5MB')
      return
    }

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await axios.post(`${API_URL}/api/messages/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      const fileData = response.data.file
      const fileType = fileData.mimetype.startsWith('image/') ? 'image' : 'file'

      const messageData = {
        roomCode,
        message: fileData.originalname,
        userId: user?.id,
        userName: user?.fullName || user?.username || 'Anonymous',
        type: fileType,
        fileUrl: fileData.url
      }

      socket.emit('send-message', messageData)
      toast.success('File sent!')
    } catch (error) {
      console.error('Error uploading file:', error)
      toast.error('Cannot upload file')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDeleteMessage = async (messageId: number) => {
    if (!confirm('Are you sure you want to delete this message?')) return

    try {
      await axios.delete(`${API_URL}/api/messages/${messageId}`, {
        data: { userId: user?.id }
      })
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content: 'Message deleted', is_deleted: true }
          : msg
      ))
      
      if (socket) {
        socket.emit('message-deleted', {
          roomCode,
          messageId
        })
      }
      
      toast.success('Message deleted')
      setShowMessageMenu(null)
    } catch (error) {
      console.error('Error deleting message:', error)
      toast.error('Cannot delete message')
    }
  }

  const handleEditMessage = async (messageId: number) => {
    if (!editContent.trim()) {
      toast.error('Content cannot be empty')
      return
    }

    try {
      await axios.patch(`${API_URL}/api/messages/${messageId}`, {
        content: editContent,
        userId: user?.id
      })
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content: editContent, is_edited: true }
          : msg
      ))
      
      if (socket) {
        socket.emit('message-edited', {
          roomCode,
          messageId,
          content: editContent
        })
      }
      
      toast.success('Message updated')
      setEditingMessage(null)
      setEditContent('')
    } catch (error) {
      console.error('Error editing message:', error)
      toast.error('Cannot edit message')
    }
  }

  const handleReactMessage = async (messageId: number, emoji: string) => {
    try {
      await axios.post(`${API_URL}/api/messages/${messageId}/react`, {
        userId: user?.id,
        userName: user?.fullName || user?.username || 'Anonymous',
        emoji
      })
      
      const reactionsResponse = await axios.get(`${API_URL}/api/messages/${messageId}/reactions`)
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, reactions: reactionsResponse.data.reactions }
          : msg
      ))
      
      if (socket) {
        socket.emit('message-reaction', {
          roomCode,
          messageId,
          reactions: reactionsResponse.data.reactions
        })
      }
      
      setShowEmojiPicker(null)
    } catch (error) {
      console.error('Error reacting to message:', error)
      toast.error('Cannot add reaction')
    }
  }

  const handlePinMessage = async (messageId: number, currentPinStatus: boolean) => {
    try {
      await axios.patch(`${API_URL}/api/messages/${messageId}/pin`, {
        userId: user?.id,
        roomCode
      })
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, is_pinned: !currentPinStatus }
          : msg
      ))
      
      if (socket) {
        socket.emit('message-pinned', {
          roomCode,
          messageId,
          isPinned: !currentPinStatus
        })
      }
      
      toast.success(currentPinStatus ? 'Message unpinned' : 'Message pinned')
      setShowMessageMenu(null)
    } catch (error) {
      console.error('Error pinning message:', error)
      toast.error('Cannot pin message')
    }
  }

  const fetchMembers = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/members/room/${roomCode}`)
      setMembers(response.data.members)
    } catch (error) {
      console.error('Error fetching members:', error)
    }
  }

  const handleKickMember = async (userId: string) => {
    if (!confirm('Are you sure you want to kick this member?')) return
    
    try {
      await axios.delete(`${API_URL}/api/members/room/${roomCode}/kick/${userId}`, {
        data: { requestUserId: user?.id }
      })
      
      toast.success('Member removed from room')
      // No need to call fetchMembers() - socket event will handle it
    } catch (error: any) {
      console.error('Error kicking member:', error)
      if (error.response?.status === 403) {
        toast.error('Only host can kick members')
      } else {
        toast.error('Cannot kick member')
      }
    }
  }

  const renderMessage = (message: Message) => {
    const isOwnMessage = message.user_id === user?.id
    const isHost = room?.created_by === user?.id
    const replyToMessage = message.reply_to_id 
      ? messages.find(m => m.id === message.reply_to_id) 
      : null
    const isEditing = editingMessage === message.id

    const formatMessageTime = (dateString: string) => {
      const messageDate = new Date(dateString)
      const now = new Date()
      const diffMs = now.getTime() - messageDate.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      
      const time = messageDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      
      if (diffDays === 0) {
        return time
      }
      
      if (diffDays === 1) {
        return `Yesterday ${time}`
      }
      
      if (diffDays < 7) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        return `${dayNames[messageDate.getDay()]} ${time}`
      }
      
      const date = messageDate.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })
      return `${date} ${time}`
    }

    return (
      <div
        key={message.id}
        className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-4 group`}
      >
        <div className={`max-w-[70%] ${isOwnMessage ? 'order-2' : 'order-1'} relative`}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`text-sm font-medium text-gray-900 ${isOwnMessage ? 'text-right' : 'text-left'}`}>
              {message.user_name}
            </span>
            <span className="text-xs text-gray-400">
              {formatMessageTime(message.created_at)}
            </span>
            
            {!message.is_deleted && (
              <div className="relative ml-2">
                <button
                  onClick={() => setShowMessageMenu(showMessageMenu === message.id ? null : message.id)}
                  className="p-1 hover:bg-gray-200 rounded transition"
                  title="Options"
                >
                  <MoreVertical className="w-4 h-4 text-gray-600" />
                </button>
                
                {showMessageMenu === message.id && (
                  <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-gray-200 z-10 min-w-[150px]">
                    <button
                      onClick={() => {
                        setReplyingTo(message)
                        setShowMessageMenu(null)
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-gray-900"
                    >
                      <Reply className="w-4 h-4" />
                      Reply
                    </button>
                    {isOwnMessage && (
                      <>
                        <button
                          onClick={() => {
                            setEditingMessage(message.id)
                            setEditContent(message.content)
                            setShowMessageMenu(null)
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-gray-900"
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteMessage(message.id)}
                          className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-red-600 border-t border-gray-200"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </>
                    )}
                    {isHost && (
                      <button
                        onClick={() => handlePinMessage(message.id, message.is_pinned || false)}
                        className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-gray-900 border-t border-gray-200"
                      >
                        <Pin className="w-4 h-4" />
                        {message.is_pinned ? 'Unpin' : 'Pin'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {replyToMessage && (
            <div className="px-3 py-1.5 mb-1 bg-gray-100 rounded text-xs border-l-2 border-primary-500">
              <span className="font-medium text-gray-900">{replyToMessage.user_name}</span>
              <p className="text-gray-600 truncate">{replyToMessage.content}</p>
            </div>
          )}

          {message.is_pinned && (
            <div className="flex items-center gap-1 text-xs text-primary-600 mb-1">
              <Pin className="w-3 h-3" />
              <span>Pinned message</span>
            </div>
          )}
          
          {isEditing ? (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEditMessage(message.id)
                  if (e.key === 'Escape') {
                    setEditingMessage(null)
                    setEditContent('')
                  }
                }}
                className="flex-1 px-3 py-2 border rounded-lg bg-white border-gray-300 text-gray-900"
                autoFocus
              />
              <button
                onClick={() => handleEditMessage(message.id)}
                className="p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setEditingMessage(null)
                  setEditContent('')
                }}
                className="p-2 bg-gray-300 rounded-lg hover:bg-gray-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : message.type === 'text' && (
            <div className="relative">
              <div className={`px-4 py-2 rounded-lg ${
              isOwnMessage 
                ? 'bg-primary-600 text-white rounded-tr-none' 
                : 'bg-gray-200 text-gray-900 rounded-tl-none'
            }`}>
              {message.content}
              {message.is_edited && <span className="text-xs opacity-70 ml-2">(edited)</span>}
              
              {!message.is_deleted && (
                <button
                  onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}
                  className="absolute -bottom-2 right-2 p-1 bg-white rounded-full border border-gray-200 opacity-0 group-hover:opacity-100 transition"
                >
                  <Smile className="w-3 h-3 text-gray-600" />
                </button>
              )}
              
              {showEmojiPicker === message.id && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-20 max-w-xs">
                  <div className="text-xs text-gray-500 mb-2 font-medium">Quick Reactions</div>
                  <div className="grid grid-cols-6 gap-2 mb-3">
                    {['👍', '❤️', '😂', '😮', '😢', '😍', '🔥', '👏', '🎉', '💯', '✨', '👌'].map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleReactMessage(message.id, emoji)}
                        className="text-2xl hover:scale-125 hover:bg-gray-100 p-2 rounded transition"
                        title={emoji}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="border-t pt-2">
                    <div className="text-xs text-gray-500 mb-2 font-medium">More Reactions</div>
                    <div className="grid grid-cols-8 gap-1 max-h-32 overflow-y-auto">
                      {['😀', '😃', '😄', '😁', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'].map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => handleReactMessage(message.id, emoji)}
                          className="text-lg hover:scale-125 hover:bg-gray-100 p-1 rounded transition"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {message.reactions && message.reactions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(
                  message.reactions.reduce((acc: any, r) => {
                    if (!acc[r.emoji]) acc[r.emoji] = []
                    acc[r.emoji].push(r.user_name)
                    return acc
                  }, {})
                ).map(([emoji, users]) => {
                  const userList = users as string[]
                  const displayNames = userList.slice(0, 3).join(', ') + (userList.length > 3 ? ` and ${userList.length - 3} more` : '')
                  return (
                    <button
                      key={emoji}
                      onClick={() => handleReactMessage(message.id, emoji)}
                      className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded-full text-xs flex items-center gap-1 transition cursor-pointer group relative"
                      title={displayNames}
                    >
                      <span>{emoji}</span>
                      <span className="text-gray-600 font-medium">{userList.length}</span>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none">
                        {displayNames}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          )}

          {message.type === 'image' && (
            <div className="space-y-2 relative group">
              <img
                src={`${API_URL}${message.file_url}`}
                alt={message.content}
                className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90"
                onClick={() => setShowImagePreview(`${API_URL}${message.file_url}`)}
              />
              <p className={`text-sm px-2 text-gray-900 ${isOwnMessage ? 'text-right' : 'text-left'}`}>
                {message.content}
              </p>
              
              {!message.is_deleted && (
                <button
                  onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}
                  className="absolute bottom-2 right-2 p-1 bg-white rounded-full border border-gray-200 opacity-0 group-hover:opacity-100 transition shadow-md"
                >
                  <Smile className="w-3 h-3 text-gray-600" />
                </button>
              )}
              
              {showEmojiPicker === message.id && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-20 max-w-xs">
                  <div className="text-xs text-gray-500 mb-2 font-medium">Quick Reactions</div>
                  <div className="grid grid-cols-6 gap-2 mb-3">
                    {['👍', '❤️', '😂', '😮', '😢', '😍', '🔥', '👏', '🎉', '💯', '✨', '👌'].map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleReactMessage(message.id, emoji)}
                        className="text-2xl hover:scale-125 hover:bg-gray-100 p-2 rounded transition"
                        title={emoji}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="border-t pt-2">
                    <div className="text-xs text-gray-500 mb-2 font-medium">More Reactions</div>
                    <div className="grid grid-cols-8 gap-1 max-h-32 overflow-y-auto">
                      {['😀', '😃', '😄', '😁', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'].map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => handleReactMessage(message.id, emoji)}
                          className="text-lg hover:scale-125 hover:bg-gray-100 p-1 rounded transition"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {message.reactions && message.reactions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(
                    message.reactions.reduce((acc: any, r) => {
                      if (!acc[r.emoji]) acc[r.emoji] = []
                      acc[r.emoji].push(r.user_name)
                      return acc
                    }, {})
                  ).map(([emoji, users]) => {
                    const userList = users as string[]
                    const displayNames = userList.slice(0, 3).join(', ') + (userList.length > 3 ? ` and ${userList.length - 3} more` : '')
                    return (
                      <button
                        key={emoji}
                        onClick={() => handleReactMessage(message.id, emoji)}
                        className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded-full text-xs flex items-center gap-1 transition cursor-pointer group relative"
                        title={displayNames}
                      >
                        <span>{emoji}</span>
                        <span className="text-gray-600 font-medium">{userList.length}</span>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none">
                          {displayNames}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {message.type === 'file' && (
            <div className="relative group">
              <a
                href={`${API_URL}${message.file_url}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 hover:bg-gray-50 transition ${
                  isOwnMessage 
                    ? 'bg-primary-50 border-primary-200 text-primary-900' 
                    : 'bg-gray-100 border-gray-300 text-gray-900'
                }`}
              >
                <FileText className="w-5 h-5" />
                <span className="font-medium">{message.content}</span>
              </a>
              
              {!message.is_deleted && (
                <button
                  onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}
                  className="absolute top-1/2 right-2 transform -translate-y-1/2 p-1 bg-white rounded-full border border-gray-200 opacity-0 group-hover:opacity-100 transition shadow-md"
                >
                  <Smile className="w-3 h-3 text-gray-600" />
                </button>
              )}
              
              {showEmojiPicker === message.id && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-20 max-w-xs">
                  <div className="text-xs text-gray-500 mb-2 font-medium">Quick Reactions</div>
                  <div className="grid grid-cols-6 gap-2 mb-3">
                    {['👍', '❤️', '😂', '😮', '😢', '😍', '🔥', '👏', '🎉', '💯', '✨', '👌'].map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleReactMessage(message.id, emoji)}
                        className="text-2xl hover:scale-125 hover:bg-gray-100 p-2 rounded transition"
                        title={emoji}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="border-t pt-2">
                    <div className="text-xs text-gray-500 mb-2 font-medium">More Reactions</div>
                    <div className="grid grid-cols-8 gap-1 max-h-32 overflow-y-auto">
                      {['😀', '😃', '😄', '😁', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'].map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => handleReactMessage(message.id, emoji)}
                          className="text-lg hover:scale-125 hover:bg-gray-100 p-1 rounded transition"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {message.reactions && message.reactions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(
                    message.reactions.reduce((acc: any, r) => {
                      if (!acc[r.emoji]) acc[r.emoji] = []
                      acc[r.emoji].push(r.user_name)
                      return acc
                    }, {})
                  ).map(([emoji, users]) => {
                    const userList = users as string[]
                    const displayNames = userList.slice(0, 3).join(', ') + (userList.length > 3 ? ` and ${userList.length - 3} more` : '')
                    return (
                      <button
                        key={emoji}
                        onClick={() => handleReactMessage(message.id, emoji)}
                        className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded-full text-xs flex items-center gap-1 transition cursor-pointer group relative"
                        title={displayNames}
                      >
                        <span>{emoji}</span>
                        <span className="text-gray-600 font-medium">{userList.length}</span>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none">
                          {displayNames}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/dashboard')}
                className="p-2 bg-primary-100 hover:bg-primary-200 rounded-lg transition"
                title="Back to home"
              >
                <Home className="w-6 h-6 text-primary-600" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{room?.name}</h1>
                <p className="text-sm text-gray-500">Code: {roomCode}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {room?.created_by === user?.id && (
                <button
                  onClick={() => setShowRoomSettings(true)}
                  className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                  title="Room Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setShowSearch(!showSearch)}
                className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                title="Search Messages"
              >
                <Search className="w-5 h-5" />
              </button>
              <button
                onClick={() => {
                  setShowMembers(!showMembers)
                  if (!showMembers) fetchMembers()
                }}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition"
              >
                <Users className="w-5 h-5 text-gray-700" />
                <span className="text-gray-700 hidden sm:inline">Members</span>
              </button>
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </header>

      {/* Search Bar */}
      {showSearch && (
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

      <div className="flex flex-1 overflow-hidden">
        {/* Messages Area */}
        <div className="flex-1 flex flex-col">
          {/* Pinned Messages */}
          {messages.filter(m => m.is_pinned).length > 0 && (
            <div className="bg-primary-50 border-b border-primary-200 px-4 py-2">
              <div className="flex items-center gap-2 text-sm text-primary-900 font-medium mb-2">
                <Pin className="w-4 h-4" />
                <span>Pinned messages ({messages.filter(m => m.is_pinned).length})</span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {messages.filter(m => m.is_pinned).map(msg => {
                  const isHostUser = room?.created_by === user?.id
                  return (
                    <div key={msg.id} className="flex items-start gap-2 text-xs bg-white rounded p-2">
                      <div className="flex-1">
                        <span className="font-medium text-gray-900">{msg.user_name}:</span>
                        <span className="text-gray-700 ml-1">{msg.content}</span>
                      </div>
                      {isHostUser && (
                        <button
                          onClick={() => handlePinMessage(msg.id, true)}
                          className="text-gray-400 hover:text-red-600"
                          title="Unpin"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
            {(searchQuery ? messages.filter(m => 
              m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
              m.user_name.toLowerCase().includes(searchQuery.toLowerCase())
            ) : messages).map(renderMessage)}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply Preview */}
          {replyingTo && (
            <div className="px-4 py-2 bg-gray-100 border-t border-gray-200 flex items-center justify-between">
              <div className="flex-1">
                <div className="text-xs text-gray-600">Replying to {replyingTo.user_name}</div>
                <div className="text-sm text-gray-900 truncate">{replyingTo.content}</div>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="p-1 hover:bg-gray-200 rounded"
              >
                <X className="w-4 h-4 text-gray-700" />
              </button>
            </div>
          )}

          {/* Input Area */}
          <div className="border-t border-gray-200 bg-white p-4">
            <form onSubmit={handleSendMessage} className="flex items-end gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.txt"
              />
              
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="p-2 text-gray-500 hover:text-primary-600 transition disabled:opacity-50"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <input
                type="text"
                value={inputMessage}
                onChange={(e) => {
                  setInputMessage(e.target.value)
                  handleTyping()
                }}
                placeholder="Type a message..."
                className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 bg-white placeholder-gray-500"
              />

              <button
                type="submit"
                disabled={!inputMessage.trim() || uploading}
                className="p-3 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
            
            {uploading && (
              <div className="mt-2 text-sm text-gray-500">Uploading file...</div>
            )}
          </div>
        </div>

        {/* Members Sidebar */}
        {showMembers && (
          <div className="w-64 bg-white border-l border-gray-200 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Members</h3>
              <button
                onClick={() => setShowMembers(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-4 h-4 text-gray-700" />
              </button>
            </div>
            <div className="space-y-2">
              {members.map((member) => {
                const isHostUser = room?.created_by === user?.id
                const isSelf = member.user_id === user?.id
                return (
                  <div
                    key={member.user_id}
                    className="flex items-center justify-between p-2 hover:bg-gray-50 rounded"
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <div className="relative">
                        <div className="w-8 h-8 bg-primary-200 rounded-full flex items-center justify-center text-primary-700 font-medium">
                          {member.user_name[0].toUpperCase()}
                        </div>
                        <div className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-white rounded-full ${
                          onlineUsers.has(member.user_id) ? 'bg-green-500' : 'bg-gray-400'
                        }`} />
                      </div>
                      <div className="flex-1">
                        <div className="text-gray-900 font-medium flex items-center gap-2">
                          {member.user_name}
                          {onlineUsers.has(member.user_id) && (
                            <span className="text-xs text-green-600">Online</span>
                          )}
                        </div>
                        {member.role === 'host' && (
                          <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded mt-1 inline-block">
                            Host
                          </span>
                        )}
                      </div>
                    </div>
                    {isHostUser && !isSelf && member.role !== 'host' && (
                      <button
                        onClick={() => handleKickMember(member.user_id)}
                        className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded transition"
                        title="Kick member"
                      >
                        Kick
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Image Preview Modal */}
      {showImagePreview && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setShowImagePreview(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 bg-white rounded-full hover:bg-gray-100 transition"
            onClick={() => setShowImagePreview(null)}
          >
            <X className="w-6 h-6 text-gray-900" />
          </button>
          <img
            src={showImagePreview}
            alt="Preview"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Room Settings Modal */}
      {showRoomSettings && room?.created_by === user?.id && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowRoomSettings(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Room Settings</h2>
              <button
                onClick={() => setShowRoomSettings(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5 text-gray-700" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Room Name
                </label>
                <input
                  type="text"
                  value={roomSettings.name || room?.name || ''}
                  onChange={(e) => setRoomSettings({...roomSettings, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900"
                  placeholder="Enter room name"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium text-gray-900">Online Members</div>
                  <div className="text-sm text-gray-600">{onlineUsers.size} online now</div>
                </div>
                <div className="text-2xl font-bold text-primary-600">{onlineUsers.size}</div>
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium text-gray-900">Total Messages</div>
                  <div className="text-sm text-gray-600">All time</div>
                </div>
                <div className="text-2xl font-bold text-primary-600">{messages.length}</div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <div className="text-sm text-gray-600 space-y-1">
                  <p><span className="font-medium">Room Code:</span> {roomCode}</p>
                  <p><span className="font-medium">Created:</span> {new Date(room?.created_at || '').toLocaleDateString()}</p>
                  <p><span className="font-medium">Host:</span> {room?.created_by_name}</p>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  onClick={async () => {
                    if (roomSettings.name && roomSettings.name !== room?.name) {
                      try {
                        await axios.patch(`${API_URL}/api/rooms/${roomCode}`, {
                          name: roomSettings.name,
                          userId: user?.id
                        })
                        toast.success('Room name updated!')
                        setRoom({...room!, name: roomSettings.name})
                      } catch (error) {
                        toast.error('Failed to update room name')
                      }
                    }
                    setShowRoomSettings(false)
                  }}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setShowRoomSettings(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
