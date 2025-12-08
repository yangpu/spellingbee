/**
 * PeerJS WebRTC 连接器
 * 使用 PeerJS 实现点对点 WebRTC 连接，适用于局域网或互联网受限场景
 */

import Peer, { DataConnection } from 'peerjs'
import { supabase } from '@/lib/supabase'
import type { ChallengeMessage, ChallengeParticipant } from '@/types'
import type {
  NetworkConnector,
  ConnectionType,
  ConnectionStatus,
  MessageHandler,
  StatusChangeHandler,
  ParticipantChangeHandler
} from './types'

export class PeerJSConnector implements NetworkConnector {
  readonly type: ConnectionType = 'peerjs'
  
  private _status: ConnectionStatus = 'disconnected'
  private _connectionId: string = ''
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private userIdToPeerId: Map<string, string> = new Map()
  private peerIdToUserId: Map<string, string> = new Map()
  private challengeId: string = ''
  private userId: string = ''
  private userInfo: { nickname: string; avatar_url?: string } = { nickname: '' }
  private isHost: boolean = false
  
  // 事件处理器
  private messageHandler: MessageHandler | null = null
  private statusChangeHandler: StatusChangeHandler | null = null
  private participantChangeHandler: ParticipantChangeHandler | null = null
  
  get status(): ConnectionStatus {
    return this._status
  }
  
  get connectionId(): string {
    return this._connectionId
  }
  
  /**
   * 初始化 PeerJS 连接
   */
  async init(): Promise<string> {
    // 获取用户信息
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('用户未登录')
    }
    
    this.userId = user.id
    
    // 获取用户 profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('nickname, avatar_url')
      .eq('user_id', user.id)
      .single()
    
    if (profile) {
      this.userInfo = {
        nickname: profile.nickname || user.email?.split('@')[0] || 'Unknown',
        avatar_url: profile.avatar_url
      }
    } else {
      this.userInfo = {
        nickname: user.email?.split('@')[0] || 'Unknown'
      }
    }
    
    return new Promise((resolve, reject) => {
      if (this.peer && !this.peer.destroyed) {
        resolve(this._connectionId)
        return
      }
      
      this._status = 'connecting'
      this.notifyStatusChange('connecting')
      
      // 创建 PeerJS 实例，配置 ICE 服务器
      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            // STUN 服务器
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            // TURN 服务器（OpenRelay 项目提供的免费服务）
            {
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443?transport=tcp',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            }
          ]
        }
      })
      
      this.peer.on('open', (id) => {
        this._connectionId = id
        this._status = 'connected'
        this.notifyStatusChange('connected')
        resolve(id)
      })
      
      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn)
      })
      
      this.peer.on('error', (err) => {
        console.error('PeerJS error:', err)
        this._status = 'error'
        this.notifyStatusChange('error', err)
        reject(err)
      })
      
      this.peer.on('disconnected', () => {
        this._status = 'disconnected'
        this.notifyStatusChange('disconnected')
        
        // 尝试重连
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed) {
            this.peer.reconnect()
          }
        }, 3000)
      })
      
      // 超时处理
      setTimeout(() => {
        if (this._status === 'connecting') {
          reject(new Error('PeerJS connection timeout'))
        }
      }, 15000)
    })
  }
  
  /**
   * 处理传入连接（作为主机）
   */
  private handleIncomingConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn)
    })
    
    conn.on('data', (data) => {
      const message = data as ChallengeMessage
      
      // 处理 join 消息，建立 userId 和 peerId 的映射
      if (message.type === 'join') {
        const joinData = message.data as { user_id: string; peer_id: string; nickname: string; avatar_url?: string }
        this.userIdToPeerId.set(joinData.user_id, conn.peer)
        this.peerIdToUserId.set(conn.peer, joinData.user_id)
        
        // 通知参与者加入
        this.notifyParticipantChange('join', {
          user_id: joinData.user_id,
          nickname: joinData.nickname,
          avatar_url: joinData.avatar_url,
          is_online: true,
          is_ready: false,
          score: 0,
          peer_id: conn.peer
        })
      }
      
      const fromUserId = this.peerIdToUserId.get(conn.peer) || message.sender_id
      if (this.messageHandler) {
        this.messageHandler(message, fromUserId)
      }
    })
    
    conn.on('close', () => {
      const userId = this.peerIdToUserId.get(conn.peer)
      this.connections.delete(conn.peer)
      this.peerIdToUserId.delete(conn.peer)
      if (userId) {
        this.userIdToPeerId.delete(userId)
        this.notifyParticipantChange('leave', {
          user_id: userId,
          is_online: false
        })
      }
    })
    
    conn.on('error', (err) => {
      console.error('Connection error:', err)
      this.connections.delete(conn.peer)
    })
  }
  
  /**
   * 创建房间（作为主机）
   */
  async createRoom(challengeId: string): Promise<void> {
    this.challengeId = challengeId
    this.isHost = true
    
    // 确保 PeerJS 已初始化
    if (!this.peer || this.peer.destroyed) {
      await this.init()
    }
    
    // 更新数据库中的 peer_id
    await this.updatePeerIdInDb()
  }
  
  /**
   * 加入房间（作为参与者）
   */
  async joinRoom(challengeId: string, hostPeerId?: string): Promise<void> {
    this.challengeId = challengeId
    this.isHost = false
    
    // 确保 PeerJS 已初始化
    if (!this.peer || this.peer.destroyed) {
      await this.init()
    }
    
    if (!hostPeerId) {
      // 从数据库获取主机的 peer_id
      const { data: challenge } = await supabase
        .from('challenges')
        .select('creator_id, participants')
        .eq('id', challengeId)
        .single()
      
      if (!challenge) {
        throw new Error('挑战赛不存在')
      }
      
      const creator = challenge.participants?.find(
        (p: ChallengeParticipant) => p.user_id === challenge.creator_id
      )
      
      if (!creator?.peer_id) {
        throw new Error('房主不在线')
      }
      
      hostPeerId = creator.peer_id
    }
    
    // 连接到主机
    await this.connectToHost(hostPeerId)
    
    // 更新数据库中的 peer_id
    await this.updatePeerIdInDb()
  }
  
  /**
   * 连接到主机
   */
  private async connectToHost(hostPeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) {
        reject(new Error('PeerJS not initialized'))
        return
      }
      
      const conn = this.peer.connect(hostPeerId, { reliable: true })
      
      conn.on('open', () => {
        this.connections.set(hostPeerId, conn)
        
        // 发送加入消息
        const joinMessage: ChallengeMessage = {
          type: 'join',
          data: {
            user_id: this.userId,
            nickname: this.userInfo.nickname,
            avatar_url: this.userInfo.avatar_url,
            peer_id: this._connectionId
          },
          sender_id: this.userId,
          timestamp: Date.now()
        }
        conn.send(joinMessage)
        
        resolve()
      })
      
      conn.on('data', (data) => {
        const message = data as ChallengeMessage
        if (this.messageHandler) {
          this.messageHandler(message, message.sender_id)
        }
      })
      
      conn.on('close', () => {
        this.connections.delete(hostPeerId)
        this.notifyParticipantChange('leave', {
          user_id: 'host',
          is_online: false
        })
      })
      
      conn.on('error', (err) => {
        console.error('Connection to host error:', err)
        reject(err)
      })
      
      // 超时处理
      setTimeout(() => {
        if (!conn.open) {
          reject(new Error('Connection to host timeout'))
        }
      }, 10000)
    })
  }
  
  /**
   * 更新数据库中的 peer_id
   */
  private async updatePeerIdInDb(): Promise<void> {
    const { data: challenge } = await supabase
      .from('challenges')
      .select('participants')
      .eq('id', this.challengeId)
      .single()
    
    if (challenge?.participants) {
      const participants = challenge.participants.map((p: ChallengeParticipant) => {
        if (p.user_id === this.userId) {
          return { ...p, peer_id: this._connectionId, is_online: true }
        }
        return p
      })
      
      await supabase
        .from('challenges')
        .update({ participants })
        .eq('id', this.challengeId)
    }
  }
  
  /**
   * 离开房间
   */
  async leaveRoom(): Promise<void> {
    // 发送离开消息
    const leaveMessage: ChallengeMessage = {
      type: 'leave',
      data: {},
      sender_id: this.userId,
      timestamp: Date.now()
    }
    this.broadcast(leaveMessage)
    
    // 关闭所有连接
    this.connections.forEach(conn => conn.close())
    this.connections.clear()
    this.userIdToPeerId.clear()
    this.peerIdToUserId.clear()
    
    this.challengeId = ''
    this._status = 'disconnected'
    this.notifyStatusChange('disconnected')
  }
  
  /**
   * 发送消息给指定用户
   */
  sendTo(userId: string, message: ChallengeMessage): void {
    const peerId = this.userIdToPeerId.get(userId)
    if (peerId) {
      const conn = this.connections.get(peerId)
      if (conn?.open) {
        conn.send(message)
      }
    }
  }
  
  /**
   * 广播消息给所有连接的用户
   */
  broadcast(message: ChallengeMessage): void {
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(message)
      }
    })
  }
  
  /**
   * 设置消息处理器
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }
  
  /**
   * 设置状态变化处理器
   */
  onStatusChange(handler: StatusChangeHandler): void {
    this.statusChangeHandler = handler
  }
  
  /**
   * 设置参与者变化处理器
   */
  onParticipantChange(handler: ParticipantChangeHandler): void {
    this.participantChangeHandler = handler
  }
  
  /**
   * 通知状态变化
   */
  private notifyStatusChange(status: ConnectionStatus, error?: Error): void {
    if (this.statusChangeHandler) {
      this.statusChangeHandler(status, error)
    }
  }
  
  /**
   * 通知参与者变化
   */
  private notifyParticipantChange(
    type: 'join' | 'leave' | 'update',
    participant: Partial<ChallengeParticipant>
  ): void {
    if (this.participantChangeHandler) {
      this.participantChangeHandler(type, participant)
    }
  }
  
  /**
   * 销毁连接器
   */
  async destroy(): Promise<void> {
    await this.leaveRoom()
    
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy()
    }
    this.peer = null
    this._connectionId = ''
    
    this.messageHandler = null
    this.statusChangeHandler = null
    this.participantChangeHandler = null
  }
}
