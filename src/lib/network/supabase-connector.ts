/**
 * Supabase Realtime 连接器
 * 使用 Supabase 的 Realtime 服务实现多人挑战赛通信
 */

import { supabase } from '@/lib/supabase'
import type { RealtimeChannel, RealtimePresenceState } from '@supabase/supabase-js'
import type { ChallengeMessage, ChallengeParticipant } from '@/types'
import type {
  NetworkConnector,
  ConnectionType,
  ConnectionStatus,
  MessageHandler,
  StatusChangeHandler,
  ParticipantChangeHandler
} from './types'

export class SupabaseConnector implements NetworkConnector {
  readonly type: ConnectionType = 'supabase'
  
  private _status: ConnectionStatus = 'disconnected'
  private _connectionId: string = ''
  private channel: RealtimeChannel | null = null
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
   * 初始化连接器
   */
  async init(): Promise<string> {
    // Supabase 连接器不需要特殊初始化，返回用户 ID 作为连接标识
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('用户未登录')
    }
    
    this.userId = user.id
    this._connectionId = user.id
    
    // 获取用户信息
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
    
    return this._connectionId
  }
  
  /**
   * 创建房间（作为主机）
   */
  async createRoom(challengeId: string): Promise<void> {
    this.challengeId = challengeId
    this.isHost = true
    await this.setupChannel()
  }
  
  /**
   * 加入房间（作为参与者）
   */
  async joinRoom(challengeId: string): Promise<void> {
    this.challengeId = challengeId
    this.isHost = false
    await this.setupChannel()
  }
  
  /**
   * 设置 Realtime Channel
   */
  private async setupChannel(): Promise<void> {
    if (this.channel) {
      await this.channel.unsubscribe()
    }
    
    this._status = 'connecting'
    this.notifyStatusChange('connecting')
    
    const channelName = `challenge:${this.challengeId}`
    
    this.channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false }, // 不接收自己发送的消息
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
    
    // 监听定向消息（发给特定用户）
    this.channel.on('broadcast', { event: `message:${this.userId}` }, (payload) => {
      const message = payload.payload as ChallengeMessage
      if (this.messageHandler) {
        this.messageHandler(message, message.sender_id)
      }
    })
    
    // 监听 Presence 状态变化
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel?.presenceState() as RealtimePresenceState
      this.handlePresenceSync(state)
    })
    
    this.channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      if (key !== this.userId && newPresences.length > 0) {
        const presence = newPresences[0] as any
        this.notifyParticipantChange('join', {
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
      if (key !== this.userId) {
        this.notifyParticipantChange('leave', {
          user_id: key,
          is_online: false
        })
      }
    })
    
    // 订阅频道
    const status = await this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        this._status = 'connected'
        this.notifyStatusChange('connected')
        
        // 发送 Presence 状态
        await this.channel?.track({
          user_id: this.userId,
          nickname: this.userInfo.nickname,
          avatar_url: this.userInfo.avatar_url,
          is_ready: false,
          score: 0,
          online_at: new Date().toISOString()
        })
      } else if (status === 'CHANNEL_ERROR') {
        this._status = 'error'
        this.notifyStatusChange('error', new Error('Channel subscription failed'))
      } else if (status === 'TIMED_OUT') {
        this._status = 'error'
        this.notifyStatusChange('error', new Error('Channel subscription timed out'))
      }
    })
  }
  
  /**
   * 处理 Presence 同步
   */
  private handlePresenceSync(state: RealtimePresenceState): void {
    // 遍历所有在线用户
    Object.entries(state).forEach(([userId, presences]) => {
      if (userId !== this.userId && presences.length > 0) {
        const presence = presences[0]
        this.notifyParticipantChange('update', {
          user_id: userId,
          nickname: presence.nickname,
          avatar_url: presence.avatar_url,
          is_online: true,
          is_ready: presence.is_ready,
          score: presence.score
        })
      }
    })
  }
  
  /**
   * 离开房间
   */
  async leaveRoom(): Promise<void> {
    if (this.channel) {
      await this.channel.untrack()
      await this.channel.unsubscribe()
      this.channel = null
    }
    
    this.challengeId = ''
    this._status = 'disconnected'
    this.notifyStatusChange('disconnected')
  }
  
  /**
   * 发送消息给指定用户
   */
  sendTo(userId: string, message: ChallengeMessage): void {
    if (!this.channel || this._status !== 'connected') {
      console.warn('Cannot send message: not connected')
      return
    }
    
    this.channel.send({
      type: 'broadcast',
      event: `message:${userId}`,
      payload: message
    })
  }
  
  /**
   * 广播消息给所有用户
   */
  broadcast(message: ChallengeMessage): void {
    if (!this.channel || this._status !== 'connected') {
      console.warn('Cannot broadcast: not connected')
      return
    }
    
    this.channel.send({
      type: 'broadcast',
      event: 'message',
      payload: message
    })
  }
  
  /**
   * 更新 Presence 状态（如准备状态、分数等）
   */
  async updatePresence(data: Partial<{ is_ready: boolean; score: number }>): Promise<void> {
    if (!this.channel || this._status !== 'connected') {
      return
    }
    
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
    this.messageHandler = null
    this.statusChangeHandler = null
    this.participantChangeHandler = null
  }
}
