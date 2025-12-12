/**
 * 全局挑战赛通知服务
 * 订阅 Supabase Realtime 服务，监听新挑战赛创建等事件
 * 
 * 使用统一的 RealtimeManager 管理连接
 */

import { ref, computed } from 'vue'
import { realtimeManager, type ChannelConfig } from '@/lib/realtime-manager'
import type { Challenge } from '@/types'
import type { ChallengeNotification, NotificationHandler } from './types'

// Channel 名称常量
const NOTIFICATION_CHANNEL = 'challenge-notifications'

class ChallengeNotificationService {
  private handlers: Set<NotificationHandler> = new Set()
  private _isConnected = ref(false)
  private _isReconnecting = ref(false)
  private _lastNotification = ref<ChallengeNotification | null>(null)
  private userId: string | null = null
  
  // 用于去重的已处理挑战赛ID集合
  private processedChallengeIds: Set<string> = new Set()
  private readonly DEDUP_WINDOW = 5000
  
  // 状态变化回调取消函数
  private unsubscribeStatus: (() => void) | null = null
  
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
    this.userId = userId
    
    // 监听 RealtimeManager 状态变化
    this.unsubscribeStatus = realtimeManager.onStatusChange((status) => {
      const channelStatus = realtimeManager.getChannelStatus(NOTIFICATION_CHANNEL)
      this._isConnected.value = channelStatus === 'connected'
      this._isReconnecting.value = status === 'reconnecting'
    })
    
    // 订阅通知 channel
    await this.connect()
  }
  
  /**
   * 建立连接
   */
  private async connect(): Promise<void> {
    if (!this.userId) {
      throw new Error('No userId')
    }
    
    const config: ChannelConfig = {
      name: NOTIFICATION_CHANNEL,
      type: 'postgres_changes',
      autoResubscribe: true,
      timeout: 15000,
      subscriptions: [
        {
          type: 'postgres_changes',
          postgresChanges: {
            event: 'INSERT',
            schema: 'public',
            table: 'challenges',
          },
          callback: (payload) => {
            this.handleNewChallenge(payload.new as Challenge)
          },
        },
        {
          type: 'postgres_changes',
          postgresChanges: {
            event: 'UPDATE',
            schema: 'public',
            table: 'challenges',
          },
          callback: (payload) => {
            this.handleChallengeUpdate(payload.new as Challenge, payload.old as Challenge)
          },
        },
      ],
    }
    
    try {
      await realtimeManager.subscribe(config)
      this._isConnected.value = true
    } catch (error) {
      this._isConnected.value = false
      throw error
    }
  }
  
  /**
   * 强制重连（外部调用）
   */
  async forceReconnect(): Promise<void> {
    await realtimeManager.forceReconnect()
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
        // 静默处理错误
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
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus()
      this.unsubscribeStatus = null
    }
    
    await realtimeManager.unsubscribe(NOTIFICATION_CHANNEL)
    
    this._isConnected.value = false
    this._isReconnecting.value = false
    this.userId = null
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
