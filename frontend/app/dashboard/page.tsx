'use client'

import { useEffect, useState } from 'react'
import { useUser, UserButton } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Plus, LogIn, MessageSquare, User, Bell, Trash2 } from 'lucide-react'
import { io, Socket } from 'socket.io-client'

interface Room {
  id: number
  name: string
  code: string
  created_by: string
  created_by_name: string
  created_at: string
  last_message?: string
  last_message_sender?: string
  last_message_time?: string
  unread_count?: number
}

interface Notification {
  id: number
  type: string
  title: string
  message: string
  room_code?: string
  is_read: boolean
  created_at: string
}

export default function Dashboard() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [socket, setSocket] = useState<Socket | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

  useEffect(() => {
    if (isLoaded && user) {
      fetchUserRooms()
      fetchNotifications()
      
      const newSocket = io(API_URL)
      setSocket(newSocket)

      newSocket.on('connect', () => {
        newSocket.emit('join-user', user.id)
      })

      newSocket.on('new-notification', (data) => {
        fetchNotifications()
        fetchUserRooms()
        toast.info(`${data.fromUserName} sent a message`)
      })

      return () => {
        newSocket.disconnect()
      }
    }
  }, [isLoaded, user])

  const fetchUserRooms = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/rooms/user/${user?.id}`)
      setRooms(response.data.rooms)
    } catch (error) {
      console.error('Error fetching rooms:', error)
      toast.error('Cannot load room list')
    } finally {
      setLoading(false)
    }
  }

  const fetchNotifications = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/notifications/user/${user?.id}?limit=20`)
      setNotifications(response.data.notifications)
      setUnreadCount(response.data.unreadCount)
    } catch (error) {
      console.error('Error fetching notifications:', error)
    }
  }

  const markNotificationAsRead = async (notificationId: number) => {
    try {
      await axios.patch(`${API_URL}/api/notifications/${notificationId}/read`)
      fetchNotifications()
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }

  const markAllAsRead = async () => {
    try {
      await axios.patch(`${API_URL}/api/notifications/user/${user?.id}/read-all`)
      fetchNotifications()
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomName.trim()) {
      toast.error('Please enter room name')
      return
    }

    try {
      const response = await axios.post(`${API_URL}/api/rooms/create`, {
        name: roomName,
        createdBy: user?.id,
        createdByName: user?.fullName || user?.username || 'Anonymous'
      })

      toast.success(`Room created! Code: ${response.data.room.code}`)
      setShowCreateModal(false)
      setRoomName('')
      fetchUserRooms()
      
      router.push(`/room/${response.data.room.code}`)
    } catch (error) {
      console.error('Error creating room:', error)
      toast.error('Cannot create room')
    }
  }

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomCode.trim() || roomCode.length !== 6) {
      toast.error('Please enter 6-digit room code')
      return
    }

    const alreadyJoined = rooms.find(room => room.code === roomCode)
    if (alreadyJoined) {
      toast.error('You have already joined this room!')
      setRoomCode('')
      return
    }

    try {
      const response = await axios.post(`${API_URL}/api/rooms/join`, {
        code: roomCode,
        userId: user?.id
      })

      toast.success('Successfully joined room!')
      setShowJoinModal(false)
      setRoomCode('')
      
      fetchUserRooms()
      
      router.push(`/room/${roomCode}`)
    } catch (error: any) {
      console.error('Error joining room:', error)
      if (error.response?.status === 404) {
        toast.error('Room not found with this code')
      } else if (error.response?.data?.error?.includes('already')) {
        toast.info('Already in this room')
        router.push(`/room/${roomCode}`)
      } else {
        toast.error('Cannot join room')
      }
    }
  }

  const handleDeleteRoom = async (roomCode: string, roomName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!confirm(`Are you sure you want to permanently delete "${roomName}"? This will delete all messages and cannot be undone.`)) {
      return
    }

    try {
      await axios.delete(`${API_URL}/api/rooms/${roomCode}`, {
        data: { userId: user?.id }
      })

      toast.success('Room deleted successfully')
      fetchUserRooms()
    } catch (error: any) {
      console.error('Error deleting room:', error)
      if (error.response?.status === 403) {
        toast.error('Only the host can delete the room')
      } else {
        toast.error('Cannot delete room')
      }
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-8 h-8 text-primary-600" />
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-gray-700" />
                <span className="font-medium text-gray-900">{user?.fullName || user?.username}</span>
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <Bell className="w-5 h-5 text-gray-700" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
                
                {showNotifications && (
                  <div className="absolute right-0 top-12 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
                    <div className="flex items-center justify-between p-3 border-b border-gray-200">
                      <h3 className="font-semibold text-gray-900">Notifications</h3>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllAsRead}
                          className="text-xs text-primary-600 hover:text-primary-700"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-gray-500">
                        No notifications
                      </div>
                    ) : (
                      <div>
                        {notifications.map((notif) => (
                          <div
                            key={notif.id}
                            onClick={() => {
                              if (!notif.is_read) markNotificationAsRead(notif.id)
                              if (notif.room_code) {
                                router.push(`/room/${notif.room_code}`)
                                setShowNotifications(false)
                              }
                            }}
                            className={`p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                              !notif.is_read ? 'bg-primary-50' : ''
                            }`}
                          >
                            <p className="text-sm font-medium text-gray-900">{notif.title}</p>
                            <p className="text-xs text-gray-600 mt-1 line-clamp-2">{notif.message}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {new Date(notif.created_at).toLocaleString('en-US')}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Action Buttons */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center justify-center gap-3 bg-primary-600 text-white p-6 rounded-xl hover:bg-primary-700 transition shadow-lg"
          >
            <Plus className="w-6 h-6" />
            <span className="text-lg font-semibold">Create New Room</span>
          </button>

          <button
            onClick={() => setShowJoinModal(true)}
            className="flex items-center justify-center gap-3 bg-green-600 text-white p-6 rounded-xl hover:bg-green-700 transition shadow-lg"
          >
            <LogIn className="w-6 h-6" />
            <span className="text-lg font-semibold">Join Room</span>
          </button>
        </div>

        {/* Rooms List */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-2xl font-bold mb-4 text-gray-900">Your Rooms</h2>
          
          {rooms.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>You don't have any rooms yet. Create a new room to get started!</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  onClick={() => router.push(`/room/${room.code}`)}
                  className="border border-gray-200 rounded-lg p-4 hover:border-primary-500 hover:shadow-md transition cursor-pointer bg-white relative"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-lg text-gray-900 flex-1">{room.name}</h3>
                    {room.created_by === user?.id && (
                      <button
                        onClick={(e) => handleDeleteRoom(room.code, room.name, e)}
                        className="p-1.5 hover:bg-red-50 rounded transition text-red-600"
                        title="Delete room"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  
                  {room.last_message && (
                    <div className="mb-2 text-sm text-gray-600">
                      <span className="font-medium">{room.last_message_sender}: </span>
                      <span className="line-clamp-1">{room.last_message}</span>
                      <p className="text-xs text-gray-400 mt-1">
                        {room.last_message_time && new Date(room.last_message_time).toLocaleString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit'
                        })}
                      </p>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="bg-primary-100 text-primary-700 px-3 py-1 rounded font-mono font-bold">
                      {room.code}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-2xl font-bold mb-4 text-gray-900">Create New Room</h3>
            <form onSubmit={handleCreateRoom}>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Enter room name..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 bg-white placeholder-gray-500"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setRoomName('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  Create Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Room Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-2xl font-bold mb-4 text-gray-900">Join Room</h3>
            <form onSubmit={handleJoinRoom}>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit room code..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-primary-500 text-center text-2xl font-mono font-bold tracking-wider text-gray-900 bg-white placeholder-gray-500"
                maxLength={6}
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowJoinModal(false)
                    setRoomCode('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
