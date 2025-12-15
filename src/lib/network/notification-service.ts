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
  
  // 状态同步定时器
  private statusSyncTimer: ReturnType<typeof setInterval> | null = null
  
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
   * 注意：连接失败不会抛出错误，允许应用继续运行
   */
  async init(userId: string): Promise<void> {
    this.userId = userId
    
    // 监听 RealtimeManager 状态变化
    this.unsubscribeStatus = realtimeManager.onStatusChange((status) => {
      this.syncStatus()
    })
    
    // 启动状态同步定时器，确保状态始终正确
    this.startStatusSync()
    
    // 订阅通知 channel（不阻塞，失败也继续）
    try {
      await this.connect()
    } catch (error) {
      // 连接失败不影响应用启动
      console.warn('[NotificationService] Initial connection failed, will retry on reconnect')
    }
  }
  
  /**
   * 同步状态
   */
  private syncStatus(): void {
    const channelStatus = realtimeManager.getChannelStatus(NOTIFICATION_CHANNEL)
    const managerStatus = realtimeManager.status.value
    
    this._isConnected.value = channelStatus === 'connected'
    this._isReconnecting.value = managerStatus === 'reconnecting' || channelStatus === 'connecting'
  }
  
  /**
   * 启动状态同步定时器
   */
  private startStatusSync(): void {
    if (this.statusSyncTimer) return
    
    this.statusSyncTimer = setInterval(() => {
      this.syncStatus()
    }, 1000)
  }
  
  /**
   * 停止状态同步定时器
   */
  private stopStatusSync(): void {
    if (this.statusSyncTimer) {
      clearInterval(this.statusSyncTimer)
      this.statusSyncTimer = null
    }
  }
  
  /**
   * 建立连接
   * 挑战赛通知是核心功能，需要确保订阅成功
   */
  private async connect(): Promise<void> {
    if (!this.userId) {
      throw new Error('No userId')
    }
    
    const config: ChannelConfig = {
      name: NOTIFICATION_CHANNEL,
      type: 'postgres_changes',
      autoResubscribe: true,
      timeout: 20000,  // 增加超时时间，确保有足够时间建立连接
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
      console.warn('[NotificationService] Failed to subscribe to challenge notifications:', error)
      // 不抛出错误，允许应用继续运行
      // 用户可以通过手动刷新列表获取新挑战赛
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
    
    this.stopStatusSync()
    
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
