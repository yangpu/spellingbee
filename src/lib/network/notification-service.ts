/**
 * 全局挑战赛通知服务
 * 订阅 Supabase Realtime 服务，监听新挑战赛创建等事件
 * 
 * 设计原则：
 * 1. 彻底清理 - 重连前完全销毁旧连接，避免 Supabase 内部 rejoin 干扰
 * 2. 延迟重连 - 网络恢复后等待足够时间再重连
 * 3. 状态准确 - 连接状态始终反映真实情况
 */

import { ref, computed } from 'vue'
import { supabase, refreshSessionToken, forceReconnectRealtime } from '@/lib/supabase'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { Challenge } from '@/types'
import type { ChallengeNotification, NotificationHandler } from './types'

class ChallengeNotificationService {
  private channel: RealtimeChannel | null = null
  private handlers: Set<NotificationHandler> = new Set()
  private _isConnected = ref(false)
  private _isReconnecting = ref(false)
  private _lastNotification = ref<ChallengeNotification | null>(null)
  private userId: string | null = null
  
  // 用于去重的已处理挑战赛ID集合
  private processedChallengeIds: Set<string> = new Set()
  private readonly DEDUP_WINDOW = 5000
  
  // 重连相关
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private readonly MAX_RECONNECT_ATTEMPTS = 3 // 软重连最多尝试3次
  private readonly BASE_RECONNECT_DELAY = 2000
  private hardReconnectAttempts = 0 // 硬重连尝试次数
  private readonly MAX_HARD_RECONNECT_ATTEMPTS = 10 // 硬重连最多尝试10次
  
  // 事件监听器是否已添加
  private listenersAdded = false
  
  // 连接超时（毫秒）- 增加到 15 秒
  private readonly CONNECTION_TIMEOUT = 15000
  
  // 是否正在连接中
  private isConnecting = false
  
  // channel 唯一标识，用于区分不同的连接实例
  private channelId = 0
  
  // 日志辅助方法
  private log(message: string, ...args: any[]): void {
    const timestamp = new Date().toISOString().slice(11, 23) // HH:mm:ss.SSS
    console.log(`[${timestamp}] [NotificationService] ${message}`, ...args)
  }
  
  private warn(message: string, ...args: any[]): void {
    const timestamp = new Date().toISOString().slice(11, 23)
    console.warn(`[${timestamp}] [NotificationService] ${message}`, ...args)
  }
  
  private error(message: string, ...args: any[]): void {
    const timestamp = new Date().toISOString().slice(11, 23)
    console.error(`[${timestamp}] [NotificationService] ${message}`, ...args)
  }
  
  get isConnected() {
    return this._isConnected.value
  }
  
  get isReconnecting() {
    return this._isReconnecting.value
  }
  
  get lastNotification() {
    return this._lastNotification.value
  }
  
  /**
   * 初始化通知服务
   */
  async init(userId: string): Promise<void> {
    //console.log('[NotificationService] Initializing for user:', userId)
    this.userId = userId
    
    // 添加全局事件监听
    this.addEventListeners()
    
    // 尝试连接
    await this.connect()
  }
  
  /**
   * 添加全局事件监听器
   */
  private addEventListeners(): void {
    if (this.listenersAdded || typeof window === 'undefined') return
    
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    
    this.listenersAdded = true
  }
  
  /**
   * 移除全局事件监听器
   */
  private removeEventListeners(): void {
    if (!this.listenersAdded || typeof window === 'undefined') return
    
    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('offline', this.handleOffline)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    
    this.listenersAdded = false
  }
  
  /**
   * 处理网络上线
   */
  private handleOnline = (): void => {
    // 网络刚恢复时，先彻底清理旧连接，再延迟重连
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    this.hardReconnectAttempts = 0 // 重置硬重连计数
    this._isConnected.value = false
    
    // 彻底清理旧 channel，防止 Supabase 内部 rejoin 干扰
    this.forceCleanupAllChannels()
    
    // 立即开始重连
    this.scheduleReconnect(100)
  }
  
  /**
   * 处理网络离线
   */
  private handleOffline = (): void => {
    //this.log('Network offline')
    this._isConnected.value = false
    this._isReconnecting.value = false
    this.clearReconnectTimer()
    
    // 立即彻底清理所有 channel
    this.forceCleanupAllChannels()
  }
  
  /**
   * 处理页面可见性变化
   */
  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      // 页面恢复可见时，检查连接状态
      if (this.userId && navigator.onLine && !this._isConnected.value && !this.isConnecting) {
        this.log('Page visible, connection lost, triggering reconnect')
        // 重置重连计数，给予新的机会
        this.reconnectAttempts = 0
        this.hardReconnectAttempts = 0
        // 先清理旧连接
        this.forceCleanupAllChannels()
        // 触发硬重连，因为页面长时间后台后软重连往往无效
        this.hardReconnect()
      }
    }
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(delay: number): void {
    // 如果已连接或正在连接，不需要重连
    if (this._isConnected.value || this.isConnecting) {
      return
    }
    
    // 如果已有定时器，不重复安排
    if (this.reconnectTimer) {
      return
    }
    
    // 没有用户或离线
    if (!this.userId || !navigator.onLine) {
      return
    }
    
    // 软重连达到上限，触发硬重连
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts = 0
      this._isReconnecting.value = false
      
      // 如果硬重连也达到上限，停止
      if (this.hardReconnectAttempts >= this.MAX_HARD_RECONNECT_ATTEMPTS) {
        this.warn('Max hard reconnect attempts reached, stopping')
        this.hardReconnectAttempts = 0
        return
      }
      
      // 触发硬重连
      this.hardReconnectAttempts++
      this.log(`Soft reconnect failed, triggering hard reconnect (attempt ${this.hardReconnectAttempts}/${this.MAX_HARD_RECONNECT_ATTEMPTS})`)
      this.hardReconnect()
      return
    }
    
    // 计算延迟：使用指数退避
    const actualDelay = this.reconnectAttempts === 0 
      ? delay 
      : Math.min(this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1), 15000)
    
    this._isReconnecting.value = true
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      
      // 再次检查条件
      if (this._isConnected.value || this.isConnecting) {
        this._isReconnecting.value = false
        return
      }
      
      if (!this.userId || !navigator.onLine) {
        this._isReconnecting.value = false
        return
      }
      
      this.reconnectAttempts++
      
      try {
        await this.connect()
        // 连接成功，重置所有计数
        this.reconnectAttempts = 0
        this.hardReconnectAttempts = 0
        this._isReconnecting.value = false
      } catch (error) {
        this.warn('Reconnect attempt failed:', error)
        // 继续尝试
        this.scheduleReconnect(0)
      }
    }, actualDelay)
  }
  
  /**
   * 清除重连定时器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
  
  /**
   * 建立连接
   */
  private async connect(): Promise<void> {
    if (!this.userId) {
      throw new Error('No userId')
    }
    
    if (!navigator.onLine) {
      this._isConnected.value = false
      throw new Error('Offline')
    }
    
    if (this.isConnecting) {
      //this.log('Already connecting, skip')
      return
    }
    
    this.isConnecting = true
    
    // 生成新的 channel ID
    this.channelId++
    const currentChannelId = this.channelId
    
    try {
      // 【关键】先刷新 session token，解决 JWT 过期问题
      const hasValidSession = await refreshSessionToken()
      if (!hasValidSession) {
        this.warn('No valid session, cannot connect')
        this._isConnected.value = false
        throw new Error('No valid session')
      }
      
      // 先彻底清理所有旧 channel
      this.forceCleanupAllChannels()
      
      // 等待一小段时间，确保清理完成
      await new Promise(resolve => setTimeout(resolve, 100))
      
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          //this.log('Connection timeout')
          this._isConnected.value = false
          // 清理这个超时的 channel
          this.forceCleanupAllChannels()
          reject(new Error('Connection timeout'))
        }, this.CONNECTION_TIMEOUT)
        
        try {
          // 使用唯一的 channel 名称，避免冲突
          const channelName = `challenge-notifications-${currentChannelId}`
          
          // 创建新的 channel
          this.channel = supabase
            .channel(channelName, {
              config: {
                broadcast: { self: false },
                presence: { key: this.userId! }
              }
            })
            .on(
              'postgres_changes',
              {
                event: 'INSERT',
                schema: 'public',
                table: 'challenges'
              },
              (payload: RealtimePostgresChangesPayload<Challenge>) => {
                // 检查是否是当前 channel
                if (this.channelId !== currentChannelId) return
                this.handleNewChallenge(payload.new as Challenge)
              }
            )
            .on(
              'postgres_changes',
              {
                event: 'UPDATE',
                schema: 'public',
                table: 'challenges'
              },
              (payload: RealtimePostgresChangesPayload<Challenge>) => {
                // 检查是否是当前 channel
                if (this.channelId !== currentChannelId) return
                this.handleChallengeUpdate(payload.new as Challenge, payload.old as Challenge)
              }
            )
          
          // 订阅并监听状态
          this.channel.subscribe((status, err) => {
            // 检查是否是当前 channel
            if (this.channelId !== currentChannelId) {
              //this.log('Ignoring status from old channel:', status)
              return
            }
            
            //this.log('Channel status:', status, err || '')
            
            if (status === 'SUBSCRIBED') {
              clearTimeout(timeoutId)
              this._isConnected.value = true
              this._isReconnecting.value = false
              //this.log('Connected successfully')
              resolve()
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              clearTimeout(timeoutId)
              this._isConnected.value = false
              this.warn('Channel error:', status, err)
              reject(new Error(`Channel ${status}: ${err}`))
            } else if (status === 'CLOSED') {
              // channel 被关闭，尝试重连
              if (this.userId && navigator.onLine && this.channelId === currentChannelId) {
                //this.log('Channel closed, will reconnect')
                this._isConnected.value = false
                // 先清理再重连
                this.forceCleanupAllChannels()
                this.scheduleReconnect(1000)
              }
            }
          })
        } catch (error) {
          clearTimeout(timeoutId)
          this.error('Error creating channel:', error)
          this._isConnected.value = false
          reject(error)
        }
      })
    } finally {
      this.isConnecting = false
    }
  }
  
  /**
   * 彻底清理所有 channel（同步方法，不等待）
   * 用于网络断开等需要立即清理的场景
   */
  private forceCleanupAllChannels(): void {
    // 清理当前 channel 引用
    const channelToClean = this.channel
    this.channel = null
    
    if (channelToClean) {
      try {
        // 不等待，直接调用
        channelToClean.unsubscribe().catch(() => {})
        supabase.removeChannel(channelToClean).catch(() => {})
      } catch (e) {
        // 忽略
      }
    }
    
    // 清理所有可能残留的 notification channel
    try {
      const channels = supabase.getChannels()
      for (const ch of channels) {
        // 匹配所有 challenge-notifications 开头的 channel
        if (ch.topic && ch.topic.includes('challenge-notifications')) {
          try {
            ch.unsubscribe().catch(() => {})
            supabase.removeChannel(ch).catch(() => {})
          } catch (e) {
            // 忽略
          }
        }
      }
    } catch (e) {
      // 忽略
    }
  }
  
  /**
   * 清理 channel（异步方法，等待完成）
   * 先 unsubscribe 停止 rejoin，再 removeChannel 彻底清理
   */
  private async cleanupChannel(): Promise<void> {
    const channelToClean = this.channel
    this.channel = null
    
    if (channelToClean) {
      try {
        // 先 unsubscribe，这会停止 Supabase 内部的 rejoin 机制
        await channelToClean.unsubscribe()
      } catch (e) {
        // 忽略
      }
      
      try {
        await supabase.removeChannel(channelToClean)
      } catch (e) {
        // 忽略
      }
    }
    
    // 清理可能残留的同名 channel
    try {
      const channels = supabase.getChannels()
      for (const ch of channels) {
        if (ch.topic && ch.topic.includes('challenge-notifications')) {
          try {
            await ch.unsubscribe()
          } catch (e) {
            // 忽略
          }
          await supabase.removeChannel(ch)
        }
      }
    } catch (e) {
      // 忽略
    }
  }
  
  /**
   * 强制重连（外部调用）
   */
  async forceReconnect(): Promise<void> {
    // 直接调用硬重连
    await this.hardReconnect()
  }
  
  /**
   * 硬重连 - 完全销毁并重新初始化连接
   * 当软重连多次失败时自动调用，或者用户手动点击"立即重连"时调用
   */
  private async hardReconnect(): Promise<void> {
    if (!this.userId) {
      return
    }

    if (!navigator.onLine) {
      this._isConnected.value = false
      this._isReconnecting.value = false
      return
    }

    this.log('Hard reconnecting - destroying all connections...')
    
    // 清除所有定时器和状态
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    this._isReconnecting.value = true
    this._isConnected.value = false
    this.isConnecting = false // 强制重置连接中状态
    
    // 增加 channel ID，使旧的回调失效
    this.channelId++
    
    // 彻底清理所有 channel
    this.forceCleanupAllChannels()
    await this.cleanupChannel()
    
    // 【关键】使用 forceReconnectRealtime 彻底销毁 WebSocket 连接并重建
    // 这会断开底层 WebSocket，刷新 session token，然后重新连接
    this.log('Force reconnecting Supabase Realtime...')
    try {
      await forceReconnectRealtime()
      this.log('Supabase Realtime force reconnected')
    } catch (e) {
      this.warn('Force reconnect Realtime failed:', e)
    }
    
    // 等待足够时间，确保所有清理完成
    await new Promise(resolve => setTimeout(resolve, 500))
    
    try {
      await this.connect()
      this.log('Hard reconnect successful')
      this.reconnectAttempts = 0
      this.hardReconnectAttempts = 0
      this._isReconnecting.value = false
    } catch (error) {
      this.error('Hard reconnect failed:', error)
      this._isReconnecting.value = false
      
      // 如果还有硬重连次数，继续尝试
      if (this.hardReconnectAttempts < this.MAX_HARD_RECONNECT_ATTEMPTS && navigator.onLine) {
        this.hardReconnectAttempts++
        const delay = Math.min(2000 * Math.pow(2, this.hardReconnectAttempts - 1), 30000)
        this.log(`Scheduling next hard reconnect in ${delay}ms (attempt ${this.hardReconnectAttempts}/${this.MAX_HARD_RECONNECT_ATTEMPTS})`)
        setTimeout(() => {
          if (navigator.onLine && !this._isConnected.value && !this.isConnecting) {
            this.hardReconnect()
          }
        }, delay)
      }
    }
  }
  
  /**
   * 处理新挑战赛创建
   */
  private handleNewChallenge(challenge: Challenge): void {
    if (this.userId && challenge.creator_id === this.userId) {
      return
    }
    
    const dedupKey = `new_${challenge.id}`
    if (this.processedChallengeIds.has(dedupKey)) {
      return
    }
    
    this.processedChallengeIds.add(dedupKey)
    setTimeout(() => {
      this.processedChallengeIds.delete(dedupKey)
    }, this.DEDUP_WINDOW)
    
    const notification: ChallengeNotification = {
      type: 'new_challenge',
      challenge,
      fromUser: {
        id: challenge.creator_id,
        nickname: challenge.creator_name || 'Unknown',
        avatar_url: challenge.creator_avatar
      },
      timestamp: Date.now()
    }
    
    this._lastNotification.value = notification
    this.notifyHandlers(notification)
  }
  
  /**
   * 处理挑战赛更新
   */
  private handleChallengeUpdate(newChallenge: Challenge, oldChallenge: Challenge): void {
    if (oldChallenge.status !== newChallenge.status) {
      if (newChallenge.status === 'in_progress' && oldChallenge.status !== 'in_progress') {
        const isParticipant = newChallenge.participants?.some(
          p => p.user_id === this.userId
        )
        
        if (isParticipant) {
          const notification: ChallengeNotification = {
            type: 'challenge_started',
            challenge: newChallenge,
            timestamp: Date.now()
          }
          
          this._lastNotification.value = notification
          this.notifyHandlers(notification)
        }
      }
      
      if (newChallenge.status === 'finished' && oldChallenge.status !== 'finished') {
        const isParticipant = newChallenge.participants?.some(
          p => p.user_id === this.userId
        )
        
        if (isParticipant) {
          const notification: ChallengeNotification = {
            type: 'challenge_finished',
            challenge: newChallenge,
            timestamp: Date.now()
          }
          
          this._lastNotification.value = notification
          this.notifyHandlers(notification)
        }
      }
    }
  }
  
  /**
   * 通知所有处理器
   */
  private notifyHandlers(notification: ChallengeNotification): void {
    this.handlers.forEach(handler => {
      try {
        handler(notification)
      } catch (error) {
        this.error('Handler error:', error)
      }
    })
  }
  
  /**
   * 添加通知处理器
   */
  addHandler(handler: NotificationHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }
  
  /**
   * 移除通知处理器
   */
  removeHandler(handler: NotificationHandler): void {
    this.handlers.delete(handler)
  }
  
  /**
   * 清除最后通知
   */
  clearLastNotification(): void {
    this._lastNotification.value = null
  }
  
  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    //this.log('Disconnecting...')
    
    this.clearReconnectTimer()
    this.removeEventListeners()
    
    // 彻底清理所有 channel
    this.forceCleanupAllChannels()
    await this.cleanupChannel()
    
    this._isConnected.value = false
    this._isReconnecting.value = false
    this.userId = null
    this.reconnectAttempts = 0
    this.hardReconnectAttempts = 0
    this.isConnecting = false
  }
  
  /**
   * 销毁服务
   */
  async destroy(): Promise<void> {
    await this.disconnect()
    this.handlers.clear()
    this._lastNotification.value = null
    this.processedChallengeIds.clear()
  }
}

// 导出单例
export const notificationService = new ChallengeNotificationService()

// Vue composable
export function useChallengeNotifications() {
  const isConnected = computed(() => notificationService.isConnected)
  const isReconnecting = computed(() => notificationService.isReconnecting)
  const lastNotification = computed(() => notificationService.lastNotification)
  
  const subscribe = (handler: NotificationHandler) => {
    return notificationService.addHandler(handler)
  }
  
  const clearNotification = () => {
    notificationService.clearLastNotification()
  }
  
  return {
    isConnected,
    isReconnecting,
    lastNotification,
    subscribe,
    clearNotification
  }
}
