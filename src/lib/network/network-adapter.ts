/**
 * 网络适配器
 * 为现有的 challenge store 提供统一的网络接口
 * 支持 Supabase Realtime 和 PeerJS 两种模式的无缝切换
 */

import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import Peer, { DataConnection } from 'peerjs'
import type { ChallengeMessage, ChallengeParticipant, Challenge } from '@/types'
import type { ConnectionType, ConnectionStatus } from './types'

export type NetworkMode = 'supabase' | 'peerjs' | 'auto'

interface NetworkAdapterConfig {
  mode: NetworkMode
  autoFallback: boolean
  connectionTimeout: number
}

// 注意：当前禁用 PeerJS，专注于 Supabase Realtime 服务
const DEFAULT_CONFIG: NetworkAdapterConfig = {
  mode: 'supabase', // 仅使用 Supabase 模式
  autoFallback: false, // 禁用自动切换到 PeerJS
  connectionTimeout: 10000
}

/**
 * 网络适配器类
 * 封装 Supabase Realtime 和 PeerJS 的网络通信
 */
export class NetworkAdapter {
  private config: NetworkAdapterConfig
  
  // 当前使用的模式
  private _activeMode = ref<ConnectionType | null>(null)
  private _status = ref<ConnectionStatus>('disconnected')
  private _connectionId = ref<string>('')
  
  // Supabase 相关
  private channel: RealtimeChannel | null = null
  
  // PeerJS 相关
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private userIdToPeerId: Map<string, string> = new Map()
  private peerIdToUserId: Map<string, string> = new Map()
  
  // 用户信息
  private userId: string = ''
  private userInfo: { nickname: string; avatar_url?: string } = { nickname: '' }
  private challengeId: string = ''
  private isHost: boolean = false
  
  // 事件处理器
  private messageHandler: ((message: ChallengeMessage, fromUserId: string) => void) | null = null
  private participantJoinHandler: ((participant: Partial<ChallengeParticipant>) => void) | null = null
  private participantLeaveHandler: ((userId: string) => void) | null = null
  private statusChangeHandler: ((status: ConnectionStatus) => void) | null = null
  
  constructor(config: Partial<NetworkAdapterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }
  
  // Getters
  get activeMode() { return this._activeMode.value }
  get status() { return this._status.value }
  get connectionId() { return this._connectionId.value }
  get isConnected() { return this._status.value === 'connected' }
  
  /**
   * 初始化适配器
   */
  async init(userId: string, userInfo: { nickname: string; avatar_url?: string }): Promise<string> {
    this.userId = userId
    this.userInfo = userInfo
    
    // 根据配置模式初始化
    if (this.config.mode === 'supabase' || this.config.mode === 'auto') {
      try {
        await this.initSupabase()
        this._activeMode.value = 'supabase'
        return this._connectionId.value
      } catch (error) {
        console.error('[NetworkAdapter] Supabase init failed:', error)
        if (this.config.mode === 'auto' && this.config.autoFallback) {
          console.log('[NetworkAdapter] Falling back to PeerJS')
          return await this.initPeerJS()
        }
        throw error
      }
    } else {
      return await this.initPeerJS()
    }
  }
  
  /**
   * 初始化 Supabase 连接
   */
  private async initSupabase(): Promise<void> {
    this._status.value = 'connecting'
    this.notifyStatusChange('connecting')
    
    // Supabase 不需要特殊初始化，使用 userId 作为连接标识
    this._connectionId.value = this.userId
    this._status.value = 'connected'
    this.notifyStatusChange('connected')
  }
  
  /**
   * 初始化 PeerJS 连接
   */
  private async initPeerJS(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.peer && !this.peer.destroyed) {
        resolve(this._connectionId.value)
        return
      }
      
      this._status.value = 'connecting'
      this.notifyStatusChange('connecting')
      
      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
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
        this._connectionId.value = id
        this._activeMode.value = 'peerjs'
        this._status.value = 'connected'
        this.notifyStatusChange('connected')
        resolve(id)
      })
      
      this.peer.on('connection', (conn) => {
        this.handlePeerConnection(conn)
      })
      
      this.peer.on('error', (err) => {
        console.error('[NetworkAdapter] PeerJS error:', err)
        this._status.value = 'error'
        this.notifyStatusChange('error')
        reject(err)
      })
      
      this.peer.on('disconnected', () => {
        this._status.value = 'disconnected'
        this.notifyStatusChange('disconnected')
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed) {
            this.peer.reconnect()
          }
        }, 3000)
      })
      
      setTimeout(() => {
        if (this._status.value === 'connecting') {
          reject(new Error('PeerJS connection timeout'))
        }
      }, this.config.connectionTimeout)
    })
  }
  
  /**
   * 创建/加入房间
   */
  async joinRoom(challengeId: string, asHost: boolean, hostPeerId?: string): Promise<void> {
    this.challengeId = challengeId
    this.isHost = asHost
    
    if (this._activeMode.value === 'supabase') {
      await this.setupSupabaseChannel()
    } else if (this._activeMode.value === 'peerjs' && !asHost && hostPeerId) {
      await this.connectToPeerHost(hostPeerId)
    }
  }
  
  /**
   * 设置 Supabase Channel
   */
  private async setupSupabaseChannel(): Promise<void> {
    if (this.channel) {
      await this.channel.unsubscribe()
    }
    
    const channelName = `challenge:${this.challengeId}`
    
    this.channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: this.userId }
      }
    })
    
    // 监听广播消息
    this.channel.on('broadcast', { event: 'message' }, (payload) => {
      const message = payload.payload as ChallengeMessage
      if (this.messageHandler && message.sender_id !== this.userId) {
        this.messageHandler(message, message.sender_id)
      }
    })
    
    // 监听定向消息
    this.channel.on('broadcast', { event: `message:${this.userId}` }, (payload) => {
      const message = payload.payload as ChallengeMessage
      if (this.messageHandler) {
        this.messageHandler(message, message.sender_id)
      }
    })
    
    // 监听 Presence
    this.channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      if (key !== this.userId && newPresences.length > 0 && this.participantJoinHandler) {
        const presence = newPresences[0] as any
        this.participantJoinHandler({
          user_id: key,
          nickname: presence.nickname,
          avatar_url: presence.avatar_url,
          is_online: true,
          is_ready: presence.is_ready || false,
          score: presence.score || 0
        })
      }
    })
    
    this.channel.on('presence', { event: 'leave' }, ({ key }) => {
      if (key !== this.userId && this.participantLeaveHandler) {
        this.participantLeaveHandler(key)
      }
    })
    
    await this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await this.channel?.track({
          user_id: this.userId,
          nickname: this.userInfo.nickname,
          avatar_url: this.userInfo.avatar_url,
          is_ready: false,
          score: 0,
          online_at: new Date().toISOString()
        })
      }
    })
  }
  
  /**
   * 处理 PeerJS 传入连接
   */
  private handlePeerConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn)
    })
    
    conn.on('data', (data) => {
      const message = data as ChallengeMessage
      
      if (message.type === 'join') {
        const joinData = message.data as any
        this.userIdToPeerId.set(joinData.user_id, conn.peer)
        this.peerIdToUserId.set(conn.peer, joinData.user_id)
        
        if (this.participantJoinHandler) {
          this.participantJoinHandler({
            user_id: joinData.user_id,
            nickname: joinData.nickname,
            avatar_url: joinData.avatar_url,
            is_online: true,
            is_ready: false,
            score: 0,
            peer_id: conn.peer
          })
        }
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
        if (this.participantLeaveHandler) {
          this.participantLeaveHandler(userId)
        }
      }
    })
  }
  
  /**
   * 连接到 PeerJS 主机
   */
  private async connectToPeerHost(hostPeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) {
        reject(new Error('PeerJS not initialized'))
        return
      }
      
      const conn = this.peer.connect(hostPeerId, { reliable: true })
      
      conn.on('open', () => {
        this.connections.set(hostPeerId, conn)
        
        // 发送加入消息
        conn.send({
          type: 'join',
          data: {
            user_id: this.userId,
            nickname: this.userInfo.nickname,
            avatar_url: this.userInfo.avatar_url,
            peer_id: this._connectionId.value
          },
          sender_id: this.userId,
          timestamp: Date.now()
        })
        
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
        if (this.participantLeaveHandler) {
          this.participantLeaveHandler('host')
        }
      })
      
      conn.on('error', (err) => {
        reject(err)
      })
      
      setTimeout(() => {
        if (!conn.open) {
          reject(new Error('Connection timeout'))
        }
      }, this.config.connectionTimeout)
    })
  }
  
  /**
   * 发送消息
   */
  send(message: ChallengeMessage): void {
    if (this._activeMode.value === 'supabase') {
      this.channel?.send({
        type: 'broadcast',
        event: 'message',
        payload: message
      })
    } else {
      this.connections.forEach(conn => {
        if (conn.open) {
          conn.send(message)
        }
      })
    }
  }
  
  /**
   * 发送给指定用户
   */
  sendTo(userId: string, message: ChallengeMessage): void {
    if (this._activeMode.value === 'supabase') {
      this.channel?.send({
        type: 'broadcast',
        event: `message:${userId}`,
        payload: message
      })
    } else {
      const peerId = this.userIdToPeerId.get(userId)
      if (peerId) {
        const conn = this.connections.get(peerId)
        if (conn?.open) {
          conn.send(message)
        }
      }
    }
  }
  
  /**
   * 广播消息
   */
  broadcast(message: ChallengeMessage): void {
    this.send(message)
  }
  
  /**
   * 更新 Presence 状态（Supabase 模式）
   */
  async updatePresence(data: Partial<{ is_ready: boolean; score: number }>): Promise<void> {
    if (this._activeMode.value === 'supabase' && this.channel) {
      const currentState = this.channel.presenceState()[this.userId]?.[0] || {}
      await this.channel.track({
        ...currentState,
        user_id: this.userId,
        nickname: this.userInfo.nickname,
        avatar_url: this.userInfo.avatar_url,
        ...data,
        online_at: new Date().toISOString()
      })
    }
  }
  
  /**
   * 设置消息处理器
   */
  onMessage(handler: (message: ChallengeMessage, fromUserId: string) => void): void {
    this.messageHandler = handler
  }
  
  /**
   * 设置参与者加入处理器
   */
  onParticipantJoin(handler: (participant: Partial<ChallengeParticipant>) => void): void {
    this.participantJoinHandler = handler
  }
  
  /**
   * 设置参与者离开处理器
   */
  onParticipantLeave(handler: (userId: string) => void): void {
    this.participantLeaveHandler = handler
  }
  
  /**
   * 设置状态变化处理器
   */
  onStatusChange(handler: (status: ConnectionStatus) => void): void {
    this.statusChangeHandler = handler
  }
  
  private notifyStatusChange(status: ConnectionStatus): void {
    if (this.statusChangeHandler) {
      this.statusChangeHandler(status)
    }
  }
  
  /**
   * 离开房间
   */
  async leaveRoom(): Promise<void> {
    if (this._activeMode.value === 'supabase' && this.channel) {
      await this.channel.untrack()
      await this.channel.unsubscribe()
      this.channel = null
    }
    
    this.connections.forEach(conn => conn.close())
    this.connections.clear()
    this.userIdToPeerId.clear()
    this.peerIdToUserId.clear()
    
    this.challengeId = ''
    this.isHost = false
  }
  
  /**
   * 切换网络模式
   */
  async switchMode(mode: ConnectionType): Promise<void> {
    if (this._activeMode.value === mode) return
    
    // 保存当前状态
    const savedChallengeId = this.challengeId
    const savedIsHost = this.isHost
    
    // 清理当前连接
    await this.leaveRoom()
    
    if (mode === 'peerjs') {
      if (this.peer) {
        this.peer.destroy()
        this.peer = null
      }
      await this.initPeerJS()
    } else {
      await this.initSupabase()
    }
    
    this._activeMode.value = mode
    
    // 重新加入房间
    if (savedChallengeId) {
      await this.joinRoom(savedChallengeId, savedIsHost)
    }
  }
  
  /**
   * 获取 PeerJS 连接（兼容旧代码）
   */
  getPeer(): Peer | null {
    return this.peer
  }
  
  /**
   * 获取所有连接（兼容旧代码）
   */
  getConnections(): Map<string, DataConnection> {
    return this.connections
  }
  
  /**
   * 销毁适配器
   */
  async destroy(): Promise<void> {
    await this.leaveRoom()
    
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy()
    }
    this.peer = null
    
    this._status.value = 'disconnected'
    this._activeMode.value = null
    this._connectionId.value = ''
    
    this.messageHandler = null
    this.participantJoinHandler = null
    this.participantLeaveHandler = null
    this.statusChangeHandler = null
  }
}

// 导出单例
let adapterInstance: NetworkAdapter | null = null

export function getNetworkAdapter(config?: Partial<NetworkAdapterConfig>): NetworkAdapter {
  if (!adapterInstance) {
    adapterInstance = new NetworkAdapter(config)
  }
  return adapterInstance
}

export function resetNetworkAdapter(): void {
  if (adapterInstance) {
    adapterInstance.destroy()
    adapterInstance = null
  }
}
