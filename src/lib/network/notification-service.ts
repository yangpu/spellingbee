/**
 * 全局挑战赛通知服务
 * 订阅 Supabase Realtime 服务，监听新挑战赛创建等事件
 * 
 * 设计原则：
 * 1. 简单可靠 - 只管理 channel，不干预底层 socket
 * 2. 自动恢复 - 网络恢复、应用激活时自动重连
 * 3. 状态准确 - 连接状态始终反映真实情况
 */

import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
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
  private readonly MAX_RECONNECT_ATTEMPTS = 10
  private readonly BASE_RECONNECT_DELAY = 2000
  
  // 事件监听器是否已添加
  private listenersAdded = false
  
  // 连接超时（秒）
  private readonly CONNECTION_TIMEOUT = 5000
  
  // 是否正在连接中
  private isConnecting = false
  
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
    //console.log('[NotificationService] Network online')
    // 网络刚恢复时延迟再连接，让底层网络稳定
    this.scheduleReconnect(500)
  }
  
  /**
   * 处理网络离线
   */
  private handleOffline = (): void => {
    //console.log('[NotificationService] Network offline')
    this._isConnected.value = false
    this._isReconnecting.value = false
    this.clearReconnectTimer()
    
    // 立即清理 channel，防止网络恢复时旧 channel 的 rejoin 干扰新连接
    this.cleanupChannel()
  }
  
  /**
   * 处理页面可见性变化
   */
  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      //console.log('[NotificationService] Page visible')
      // 检查当前连接状态
      if (this.userId && navigator.onLine && !this._isConnected.value && !this.isConnecting) {
        this.scheduleReconnect(500)
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
    
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      //console.log('[NotificationService] Max reconnect attempts reached, stopping')
      this._isReconnecting.value = false
      this.reconnectAttempts = 0
      return
    }
    
    // 计算延迟：使用指数退避，但第一次使用传入的 delay
    const actualDelay = this.reconnectAttempts === 0 
      ? delay 
      : Math.min(this.BASE_RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts - 1), 30000)
    
    //console.log(`[NotificationService] Scheduling reconnect in ${actualDelay}ms (attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`)
    
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
        // 连接成功，重置计数
        this.reconnectAttempts = 0
        this._isReconnecting.value = false
      } catch (error) {
        console.warn('[NotificationService] Reconnect attempt failed:', error)
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
      //console.log('[NotificationService] Already connecting, skip')
      return
    }
    
    this.isConnecting = true
    
    try {
      // 先清理旧 channel
      await this.cleanupChannel()
      
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          //console.log('[NotificationService] Connection timeout')
          this._isConnected.value = false
          reject(new Error('Connection timeout'))
        }, this.CONNECTION_TIMEOUT)
        
        try {
          // 创建新的 channel
          this.channel = supabase
            .channel('challenge-notifications', {
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
                this.handleChallengeUpdate(payload.new as Challenge, payload.old as Challenge)
              }
            )
          
          // 订阅并监听状态
          this.channel.subscribe((status, err) => {
            //console.log('[NotificationService] Channel status:', status, err || '')
            
            if (status === 'SUBSCRIBED') {
              clearTimeout(timeoutId)
              this._isConnected.value = true
              this._isReconnecting.value = false
              //console.log('[NotificationService] Connected successfully')
              resolve()
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              clearTimeout(timeoutId)
              this._isConnected.value = false
              console.warn('[NotificationService] Channel error:', status, err)
              reject(new Error(`Channel ${status}: ${err}`))
            } else if (status === 'CLOSED') {
              // channel 被关闭，尝试重连
              if (this.userId && navigator.onLine) {
                //console.log('[NotificationService] Channel closed, will reconnect')
                this._isConnected.value = false
                this.scheduleReconnect(2000)
              }
            }
          })
        } catch (error) {
          clearTimeout(timeoutId)
          console.error('[NotificationService] Error creating channel:', error)
          this._isConnected.value = false
          reject(error)
        }
      })
    } finally {
      this.isConnecting = false
    }
  }
  
  /**
   * 清理 channel
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
        if (ch.topic === 'realtime:challenge-notifications') {
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
    if (!this.userId) {
      //console.log('[NotificationService] forceReconnect: no userId')
      return
    }

    if (!navigator.onLine) {
      //console.log('[NotificationService] forceReconnect: offline')
      this._isConnected.value = false
      this._isReconnecting.value = false
      return
    }

    //console.log('[NotificationService] Force reconnecting...')
    
    // 清除定时器和重置状态
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    this._isReconnecting.value = true
    
    // 如果正在连接中，等待完成
    if (this.isConnecting) {
      //console.log('[NotificationService] Waiting for current connect...')
      const startTime = Date.now()
      while (this.isConnecting && Date.now() - startTime < 25000) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      
      // 如果连接成功了，直接返回
      if (this._isConnected.value) {
        //console.log('[NotificationService] Already connected')
        this._isReconnecting.value = false
        return
      }
    }
    
    try {
      await this.connect()
      //console.log('[NotificationService] Force reconnect completed')
    } catch (error) {
      console.error('[NotificationService] Force reconnect failed:', error)
      this._isReconnecting.value = false
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
        console.error('[NotificationService] Handler error:', error)
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
    //console.log('[NotificationService] Disconnecting...')
    
    this.clearReconnectTimer()
    this.removeEventListeners()
    await this.cleanupChannel()
    
    this._isConnected.value = false
    this._isReconnecting.value = false
    this.userId = null
    this.reconnectAttempts = 0
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
