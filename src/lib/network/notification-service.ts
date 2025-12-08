/**
 * 全局挑战赛通知服务
 * 订阅 Supabase Realtime 服务，监听新挑战赛创建等事件
 * 在应用启动后自动连接，实现跨用户的实时通知
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
  private _lastNotification = ref<ChallengeNotification | null>(null)
  private userId: string | null = null
  // 用于去重的已处理挑战赛ID集合
  private processedChallengeIds: Set<string> = new Set()
  // 去重时间窗口（毫秒）
  private readonly DEDUP_WINDOW = 5000
  
  get isConnected() {
    return this._isConnected.value
  }
  
  get lastNotification() {
    return this._lastNotification.value
  }
  
  /**
   * 初始化通知服务
   * 应在用户登录后调用
   */
  async init(userId: string): Promise<void> {
    this.userId = userId
    
    // 如果已经连接，先断开
    if (this.channel) {
      await this.disconnect()
    }
    
    // 订阅 challenges 表的变化
    this.channel = supabase
      .channel('challenge-notifications')
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
    
    // 使用回调方式订阅
    this.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this._isConnected.value = true
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this._isConnected.value = false
      }
    })
  }
  
  /**
   * 处理新挑战赛创建
   */
  private handleNewChallenge(challenge: Challenge): void {
    // 不通知自己创建的挑战赛
    if (this.userId && challenge.creator_id === this.userId) {
      return
    }
    
    // 去重检查：如果这个挑战赛ID已经处理过，跳过
    const dedupKey = `new_${challenge.id}`
    if (this.processedChallengeIds.has(dedupKey)) {
      return
    }
    
    // 标记为已处理，并在一定时间后清除（防止内存泄漏）
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
    // 状态变化通知
    if (oldChallenge.status !== newChallenge.status) {
      // 比赛开始
      if (newChallenge.status === 'in_progress' && oldChallenge.status !== 'in_progress') {
        // 检查当前用户是否是参与者
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
      
      // 比赛结束
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
    
    // 返回取消订阅函数
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
    if (this.channel) {
      await this.channel.unsubscribe()
      this.channel = null
    }
    this._isConnected.value = false
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
  const lastNotification = computed(() => notificationService.lastNotification)
  
  const subscribe = (handler: NotificationHandler) => {
    return notificationService.addHandler(handler)
  }
  
  const clearNotification = () => {
    notificationService.clearLastNotification()
  }
  
  return {
    isConnected,
    lastNotification,
    subscribe,
    clearNotification
  }
}
