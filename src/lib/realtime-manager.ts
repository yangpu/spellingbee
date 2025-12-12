/**
 * Supabase Realtime 统一管理器
 * 
 * 设计目标：
 * 1. 整个应用维护一个统一的 Realtime 连接管理器
 * 2. 所有 channel（通知、房间、版本更新等）通过管理器统一管理
 * 3. 可靠的自动重连机制，重连后自动恢复所有订阅
 * 4. 正确处理浏览器最小化、手机锁屏等场景
 * 
 * 核心问题解决：
 * - 浏览器最小化时 WebSocket 可能被节流或断开
 * - 页面恢复可见时需要检测连接状态并重连
 * - 多个服务独立管理连接导致的重复重连问题
 * - JWT token 过期导致的连接失败
 */

import { ref, computed, shallowRef } from 'vue'
import { supabase } from './supabase'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

// ==================== 类型定义 ====================

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface ChannelConfig {
  // channel 唯一标识
  name: string
  // channel 类型
  type: 'broadcast' | 'presence' | 'postgres_changes' | 'mixed'
  // 是否在重连后自动恢复
  autoResubscribe: boolean
  // 订阅配置
  subscriptions: ChannelSubscription[]
  // presence 配置（可选）
  presenceConfig?: {
    key: string
    initialState?: Record<string, unknown>
  }
  // 超时时间（毫秒）
  timeout?: number
}

export interface ChannelSubscription {
  // 订阅类型
  type: 'broadcast' | 'presence' | 'postgres_changes'
  // broadcast 事件名
  event?: string
  // postgres_changes 配置
  postgresChanges?: {
    event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    schema: string
    table: string
    filter?: string
  }
  // presence 事件类型
  presenceEvent?: 'sync' | 'join' | 'leave'
  // 回调函数
  callback: (payload: any) => void
}

export interface ManagedChannel {
  config: ChannelConfig
  channel: RealtimeChannel | null
  status: RealtimeStatus
  subscribePromise: Promise<void> | null
  lastError: Error | null
  retryCount: number
}

type StatusCallback = (status: RealtimeStatus) => void
type ErrorCallback = (error: Error, channelName?: string) => void

// ==================== 常量配置 ====================

const CONFIG = {
  // 心跳间隔（毫秒）
  HEARTBEAT_INTERVAL: 15000,
  // 页面隐藏后的重连阈值（毫秒）
  VISIBILITY_RECONNECT_THRESHOLD: 30000,
  // 最大软重连次数
  MAX_SOFT_RECONNECT_ATTEMPTS: 3,
  // 最大硬重连次数
  MAX_HARD_RECONNECT_ATTEMPTS: 5,
  // 基础重连延迟（毫秒）
  BASE_RECONNECT_DELAY: 1000,
  // 最大重连延迟（毫秒）
  MAX_RECONNECT_DELAY: 30000,
  // 默认 channel 超时（毫秒）
  DEFAULT_CHANNEL_TIMEOUT: 15000,
  // 连接稳定等待时间（毫秒）
  CONNECTION_STABLE_DELAY: 500,
  // 清理等待时间（毫秒）
  CLEANUP_DELAY: 100,
} as const

// ==================== RealtimeManager 类 ====================

class RealtimeManager {
  // 管理的所有 channel
  private channels: Map<string, ManagedChannel> = new Map()
  
  // 全局状态
  private _status = ref<RealtimeStatus>('disconnected')
  private _isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  private _lastHiddenTime = 0
  
  // 回调
  private statusCallbacks: Set<StatusCallback> = new Set()
  private errorCallbacks: Set<ErrorCallback> = new Set()
  
  // 重连相关
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private softReconnectAttempts = 0
  private hardReconnectAttempts = 0
  private isReconnecting = false
  
  // 事件监听器是否已添加
  private listenersInitialized = false
  
  // channel ID 计数器（用于生成唯一名称）
  private channelIdCounter = 0
  
  // ==================== 公共 API ====================
  
  /**
   * 获取全局连接状态
   */
  get status() {
    return computed(() => this._status.value)
  }
  
  /**
   * 获取网络在线状态
   */
  get isOnline() {
    return computed(() => this._isOnline.value)
  }
  
  /**
   * 检查是否已连接
   */
  get isConnected(): boolean {
    return this._status.value === 'connected'
  }
  
  /**
   * 初始化管理器
   * 应在应用启动时调用一次
   */
  init(): void {
    if (this.listenersInitialized) return
    this.listenersInitialized = true
    
    this.setupEventListeners()
    this.log('Manager initialized')
  }
  
  /**
   * 创建并订阅一个 channel
   */
  async subscribe(config: ChannelConfig): Promise<RealtimeChannel> {
    this.log(`Subscribe called for ${config.name}`)
    this.init() // 确保已初始化
    
    // 如果正在重连，等待重连完成
    if (this.isReconnecting) {
      this.log(`Waiting for reconnect to complete before subscribing ${config.name}...`)
      await this.waitForReconnect()
      this.log(`Reconnect wait completed for ${config.name}`)
    }
    
    const existingManaged = this.channels.get(config.name)
    if (existingManaged?.channel && existingManaged.status === 'connected') {
      this.log(`Channel ${config.name} already subscribed, returning existing`)
      return existingManaged.channel
    }
    
    // 如果存在旧的 channel，先清理
    if (existingManaged) {
      this.log(`Cleaning up existing channel ${config.name}`)
      await this.unsubscribe(config.name)
    }
    
    // 创建新的 managed channel
    const managed: ManagedChannel = {
      config,
      channel: null,
      status: 'connecting',
      subscribePromise: null,
      lastError: null,
      retryCount: 0,
    }
    
    this.channels.set(config.name, managed)
    this.log(`Created managed channel for ${config.name}, calling doSubscribe...`)
    
    // 执行订阅
    try {
      const channel = await this.doSubscribe(managed)
      this.log(`doSubscribe completed for ${config.name}`)
      return channel
    } catch (error) {
      this.error(`doSubscribe failed for ${config.name}:`, error)
      managed.status = 'disconnected'
      managed.lastError = error as Error
      throw error
    }
  }
  
  /**
   * 等待重连完成
   */
  private async waitForReconnect(maxWait = 30000): Promise<void> {
    const startTime = Date.now()
    let waitCount = 0
    while (this.isReconnecting && Date.now() - startTime < maxWait) {
      waitCount++
      if (waitCount % 10 === 0) {
        this.log(`Still waiting for reconnect... (${Math.round((Date.now() - startTime) / 1000)}s)`)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (this.isReconnecting) {
      this.warn('Reconnect wait timeout, proceeding anyway')
    }
  }
  
  /**
   * 取消订阅一个 channel
   */
  async unsubscribe(name: string): Promise<void> {
    const managed = this.channels.get(name)
    if (!managed) return
    
    await this.cleanupChannel(managed)
    this.channels.delete(name)
    this.log(`Channel ${name} unsubscribed`)
  }
  
  /**
   * 取消订阅所有 channel
   */
  async unsubscribeAll(): Promise<void> {
    const names = Array.from(this.channels.keys())
    await Promise.all(names.map(name => this.unsubscribe(name)))
    this.log('All channels unsubscribed')
  }
  
  /**
   * 获取指定 channel
   */
  getChannel(name: string): RealtimeChannel | null {
    return this.channels.get(name)?.channel || null
  }
  
  /**
   * 获取 channel 状态
   */
  getChannelStatus(name: string): RealtimeStatus {
    return this.channels.get(name)?.status || 'disconnected'
  }
  
  /**
   * 强制重连所有 channel
   */
  async forceReconnect(): Promise<void> {
    if (this.isReconnecting) {
      this.log('Already reconnecting, skip')
      return
    }
    
    this.log('Force reconnecting all channels...')
    await this.hardReconnect()
  }
  
  /**
   * 注册状态变化回调
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }
  
  /**
   * 注册错误回调
   */
  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }
  
  /**
   * 在 channel 上发送广播消息
   */
  broadcast(channelName: string, event: string, payload: unknown): void {
    const managed = this.channels.get(channelName)
    if (!managed?.channel) {
      this.warn(`Cannot broadcast to ${channelName}: channel not found`)
      return
    }
    
    managed.channel.send({
      type: 'broadcast',
      event,
      payload,
    })
  }
  
  /**
   * 更新 presence 状态
   */
  async trackPresence(channelName: string, state: Record<string, unknown>): Promise<void> {
    const managed = this.channels.get(channelName)
    if (!managed?.channel) {
      this.warn(`Cannot track presence on ${channelName}: channel not found`)
      return
    }
    
    await managed.channel.track(state)
  }
  
  /**
   * 离开 presence
   */
  async untrackPresence(channelName: string): Promise<void> {
    const managed = this.channels.get(channelName)
    if (!managed?.channel) return
    
    try {
      await managed.channel.untrack()
    } catch (e) {
      // 忽略错误
    }
  }
  
  /**
   * 获取 presence 状态
   */
  getPresenceState(channelName: string): Record<string, unknown[]> {
    const managed = this.channels.get(channelName)
    if (!managed?.channel) return {}
    
    return managed.channel.presenceState()
  }
  
  /**
   * 刷新 session token
   */
  async refreshSession(): Promise<boolean> {
    try {
      const { data, error } = await supabase.auth.refreshSession()
      if (error) {
        const { data: sessionData } = await supabase.auth.getSession()
        if (!sessionData.session) {
          this.warn('No valid session available')
          return false
        }
        return true
      }
      return true
    } catch (e) {
      this.warn('Error refreshing session:', e)
      return false
    }
  }
  
  /**
   * 销毁管理器
   */
  async destroy(): Promise<void> {
    this.clearReconnectTimer()
    this.removeEventListeners()
    await this.unsubscribeAll()
    this.statusCallbacks.clear()
    this.errorCallbacks.clear()
    this.listenersInitialized = false
    this.log('Manager destroyed')
  }
  
  // ==================== 私有方法 ====================
  
  /**
   * 执行 channel 订阅
   */
  private async doSubscribe(managed: ManagedChannel): Promise<RealtimeChannel> {
    const { config } = managed
    const timeout = config.timeout || CONFIG.DEFAULT_CHANNEL_TIMEOUT
    
    // 生成唯一的 channel 名称（避免冲突）
    this.channelIdCounter++
    const uniqueName = `${config.name}-${this.channelIdCounter}`
    
    // 创建 channel
    const channelOptions: any = {
      config: {
        broadcast: { self: false },
      },
    }
    
    if (config.presenceConfig) {
      channelOptions.config.presence = { key: config.presenceConfig.key }
    }
    
    const channel = supabase.channel(uniqueName, channelOptions)
    
    // 添加订阅
    for (const sub of config.subscriptions) {
      if (sub.type === 'broadcast' && sub.event) {
        channel.on('broadcast', { event: sub.event }, sub.callback)
      } else if (sub.type === 'presence' && sub.presenceEvent) {
        // @ts-ignore - Supabase 类型定义问题
        channel.on('presence', { event: sub.presenceEvent }, sub.callback)
      } else if (sub.type === 'postgres_changes' && sub.postgresChanges) {
        // @ts-ignore - Supabase 类型定义问题
        channel.on('postgres_changes', sub.postgresChanges, sub.callback)
      }
    }
    
    // 订阅并等待连接
    return new Promise((resolve, reject) => {
      let resolved = false
      
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          managed.status = 'disconnected'
          this.cleanupChannel(managed)
          reject(new Error(`Channel ${config.name} subscription timeout`))
        }
      }, timeout)
      
      channel.subscribe(async (status, err) => {
        if (resolved) return
        
        this.log(`Channel ${config.name} status: ${status}`)
        
        if (status === 'SUBSCRIBED') {
          resolved = true
          clearTimeout(timeoutId)
          managed.channel = channel
          managed.status = 'connected'
          managed.retryCount = 0
          
          // 更新全局状态
          this.updateGlobalStatus()
          
          // 如果有 presence 初始状态，立即 track
          if (config.presenceConfig?.initialState) {
            try {
              await channel.track(config.presenceConfig.initialState)
            } catch (e) {
              this.warn(`Failed to track initial presence for ${config.name}:`, e)
            }
          }
          
          resolve(channel)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          resolved = true
          clearTimeout(timeoutId)
          managed.status = 'disconnected'
          managed.lastError = new Error(`Channel ${status}: ${err}`)
          this.notifyError(managed.lastError, config.name)
          reject(managed.lastError)
        } else if (status === 'CLOSED') {
          if (!resolved) {
            managed.status = 'disconnected'
            this.updateGlobalStatus()
            // 如果配置了自动重订阅，安排重连
            if (config.autoResubscribe && this._isOnline.value) {
              this.scheduleReconnect()
            }
          }
        }
      })
    })
  }
  
  /**
   * 清理单个 channel
   */
  private async cleanupChannel(managed: ManagedChannel): Promise<void> {
    const channel = managed.channel
    managed.channel = null
    managed.status = 'disconnected'
    
    if (!channel) return
    
    try {
      await Promise.race([
        (async () => {
          try { await channel.untrack() } catch {}
          try { await channel.unsubscribe() } catch {}
          try { await supabase.removeChannel(channel) } catch {}
        })(),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ])
    } catch (e) {
      // 忽略清理错误
    }
  }
  
  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    if (typeof window === 'undefined') return
    
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    window.addEventListener('beforeunload', this.handleBeforeUnload)
    window.addEventListener('pagehide', this.handlePageHide)
  }
  
  /**
   * 移除事件监听器
   */
  private removeEventListeners(): void {
    if (typeof window === 'undefined') return
    
    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('offline', this.handleOffline)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    window.removeEventListener('beforeunload', this.handleBeforeUnload)
    window.removeEventListener('pagehide', this.handlePageHide)
  }
  
  /**
   * 处理网络上线
   */
  private handleOnline = async (): Promise<void> => {
    this.log('Network online')
    this._isOnline.value = true
    
    // 清除之前的重连计时器
    this.clearReconnectTimer()
    this.softReconnectAttempts = 0
    this.hardReconnectAttempts = 0
    
    // 延迟后检查并重连
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    if (this._isOnline.value && !this.isAllConnected()) {
      await this.hardReconnect()
    }
  }
  
  /**
   * 处理网络离线
   */
  private handleOffline = (): void => {
    this.log('Network offline')
    this._isOnline.value = false
    this._status.value = 'disconnected'
    
    // 清除重连计时器
    this.clearReconnectTimer()
    
    // 标记所有 channel 为断开
    for (const managed of this.channels.values()) {
      managed.status = 'disconnected'
    }
    
    this.notifyStatus('disconnected')
  }
  
  /**
   * 处理页面可见性变化
   */
  private handleVisibilityChange = async (): Promise<void> => {
    if (document.visibilityState === 'hidden') {
      this._lastHiddenTime = Date.now()
      this.log('Page hidden')
    } else if (document.visibilityState === 'visible') {
      const hiddenDuration = Date.now() - this._lastHiddenTime
      this.log(`Page visible, was hidden for ${hiddenDuration}ms`)
      
      // 只有在网络在线时才处理
      if (!this._isOnline.value) return
      
      // 如果隐藏时间超过阈值，强制硬重连
      if (hiddenDuration > CONFIG.VISIBILITY_RECONNECT_THRESHOLD) {
        this.log('Triggering hard reconnect due to long visibility change')
        this.softReconnectAttempts = 0
        this.hardReconnectAttempts = 0
        await this.hardReconnect()
      } else if (!this.isAllConnected()) {
        // 短时间隐藏但连接已断开，尝试软重连
        this.log('Triggering soft reconnect due to disconnected channels')
        this.softReconnectAttempts = 0
        await this.softReconnect()
      }
      // 短时间隐藏且连接正常，不做任何操作
    }
  }
  
  /**
   * 处理页面关闭
   */
  private handleBeforeUnload = (): void => {
    // 同步离开所有 presence
    for (const managed of this.channels.values()) {
      if (managed.channel) {
        try {
          managed.channel.untrack()
        } catch {}
      }
    }
  }
  
  /**
   * 处理页面隐藏（移动端）
   */
  private handlePageHide = (): void => {
    this.handleBeforeUnload()
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting || this.reconnectTimer) return
    if (!this._isOnline.value) return
    
    // 检查是否超过最大重试次数
    if (this.softReconnectAttempts >= CONFIG.MAX_SOFT_RECONNECT_ATTEMPTS) {
      this.log('Max soft reconnect attempts reached, triggering hard reconnect')
      this.softReconnectAttempts = 0
      this.hardReconnect()
      return
    }
    
    // 计算延迟（指数退避）
    const delay = Math.min(
      CONFIG.BASE_RECONNECT_DELAY * Math.pow(2, this.softReconnectAttempts),
      CONFIG.MAX_RECONNECT_DELAY
    )
    
    this.log(`Scheduling soft reconnect in ${delay}ms (attempt ${this.softReconnectAttempts + 1})`)
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      
      if (!this._isOnline.value || this.isAllConnected()) return
      
      this.softReconnectAttempts++
      await this.softReconnect()
    }, delay)
  }
  
  /**
   * 软重连：只重连断开的 channel
   */
  private async softReconnect(): Promise<void> {
    if (this.isReconnecting) return
    this.isReconnecting = true
    this._status.value = 'reconnecting'
    this.notifyStatus('reconnecting')
    
    try {
      // 刷新 session
      const hasSession = await this.refreshSession()
      if (!hasSession) {
        this.warn('No valid session, cannot reconnect')
        return
      }
      
      // 重连断开的 channel
      const disconnectedChannels = Array.from(this.channels.values())
        .filter(m => m.status !== 'connected' && m.config.autoResubscribe)
      
      for (const managed of disconnectedChannels) {
        try {
          await this.cleanupChannel(managed)
          await new Promise(resolve => setTimeout(resolve, CONFIG.CLEANUP_DELAY))
          await this.doSubscribe(managed)
        } catch (e) {
          this.warn(`Failed to reconnect channel ${managed.config.name}:`, e)
        }
      }
      
      this.updateGlobalStatus()
      
      if (this.isAllConnected()) {
        this.log('Soft reconnect successful')
        this.softReconnectAttempts = 0
      } else {
        this.scheduleReconnect()
      }
    } catch (e) {
      this.error('Soft reconnect failed:', e)
      this.scheduleReconnect()
    } finally {
      this.isReconnecting = false
    }
  }
  
  /**
   * 硬重连：彻底销毁所有连接并重建
   */
  private async hardReconnect(): Promise<void> {
    if (this.hardReconnectAttempts >= CONFIG.MAX_HARD_RECONNECT_ATTEMPTS) {
      this.warn('Max hard reconnect attempts reached, giving up')
      this.hardReconnectAttempts = 0
      return
    }
    
    this.hardReconnectAttempts++
    this.isReconnecting = true
    this._status.value = 'reconnecting'
    this.notifyStatus('reconnecting')
    
    this.log(`Hard reconnecting (attempt ${this.hardReconnectAttempts}/${CONFIG.MAX_HARD_RECONNECT_ATTEMPTS})...`)
    
    try {
      // 1. 刷新 session
      const hasSession = await this.refreshSession()
      if (!hasSession) {
        this.warn('No valid session, cannot reconnect')
        this.scheduleHardReconnect()
        return
      }
      
      // 2. 保存需要重订阅的 channel 配置
      const channelsToResubscribe = Array.from(this.channels.values())
        .filter(m => m.config.autoResubscribe)
        .map(m => m.config)
      
      // 3. 清理所有 channel
      for (const managed of this.channels.values()) {
        await this.cleanupChannel(managed)
      }
      this.channels.clear()
      
      // 4. 移除所有残留的 channel
      try {
        await supabase.removeAllChannels()
      } catch (e) {
        this.warn('Error removing all channels:', e)
      }
      
      // 5. 断开并重连 Realtime
      try {
        // @ts-ignore
        if (supabase.realtime?.disconnect) {
          // @ts-ignore
          supabase.realtime.disconnect()
        }
      } catch (e) {
        this.warn('Error disconnecting realtime:', e)
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      try {
        // @ts-ignore
        if (supabase.realtime?.connect) {
          // @ts-ignore
          supabase.realtime.connect()
        }
      } catch (e) {
        this.warn('Error connecting realtime:', e)
      }
      
      await new Promise(resolve => setTimeout(resolve, CONFIG.CONNECTION_STABLE_DELAY))
      
      // 6. 重新订阅所有 channel
      for (const config of channelsToResubscribe) {
        try {
          await this.subscribe(config)
        } catch (e) {
          this.warn(`Failed to resubscribe channel ${config.name}:`, e)
        }
      }
      
      this.updateGlobalStatus()
      
      if (this.isAllConnected()) {
        this.log('Hard reconnect successful')
        this.hardReconnectAttempts = 0
        this.softReconnectAttempts = 0
      } else {
        this.scheduleHardReconnect()
      }
    } catch (e) {
      this.error('Hard reconnect failed:', e)
      this.scheduleHardReconnect()
    } finally {
      this.isReconnecting = false
    }
  }
  
  /**
   * 安排硬重连
   */
  private scheduleHardReconnect(): void {
    if (this.hardReconnectAttempts >= CONFIG.MAX_HARD_RECONNECT_ATTEMPTS) {
      this.warn('Max hard reconnect attempts reached')
      return
    }
    
    const delay = Math.min(
      2000 * Math.pow(2, this.hardReconnectAttempts),
      CONFIG.MAX_RECONNECT_DELAY
    )
    
    this.log(`Scheduling hard reconnect in ${delay}ms`)
    
    setTimeout(() => {
      if (this._isOnline.value && !this.isAllConnected()) {
        this.hardReconnect()
      }
    }, delay)
  }
  
  /**
   * 清除重连计时器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
  
  /**
   * 检查是否所有 channel 都已连接
   */
  private isAllConnected(): boolean {
    if (this.channels.size === 0) return true
    
    for (const managed of this.channels.values()) {
      if (managed.status !== 'connected') return false
    }
    return true
  }
  
  /**
   * 更新全局状态
   */
  private updateGlobalStatus(): void {
    if (!this._isOnline.value) {
      this._status.value = 'disconnected'
    } else if (this.isAllConnected()) {
      this._status.value = 'connected'
    } else if (this.isReconnecting) {
      this._status.value = 'reconnecting'
    } else {
      this._status.value = 'connecting'
    }
    
    this.notifyStatus(this._status.value)
  }
  
  /**
   * 通知状态变化
   */
  private notifyStatus(status: RealtimeStatus): void {
    this.statusCallbacks.forEach(cb => {
      try { cb(status) } catch {}
    })
  }
  
  /**
   * 通知错误
   */
  private notifyError(error: Error, channelName?: string): void {
    this.errorCallbacks.forEach(cb => {
      try { cb(error, channelName) } catch {}
    })
  }
  
  // ==================== 日志方法 ====================
  
  private log(_message: string, ..._args: unknown[]): void {
    // 调试日志已禁用
  }
  
  private warn(message: string, ...args: unknown[]): void {
    console.warn(`[RealtimeManager] ${message}`, ...args)
  }
  
  private error(message: string, ...args: unknown[]): void {
    console.error(`[RealtimeManager] ${message}`, ...args)
  }
}

// ==================== 导出单例 ====================

export const realtimeManager = new RealtimeManager()

// ==================== Vue Composable ====================

export function useRealtimeManager() {
  const status = realtimeManager.status
  const isOnline = realtimeManager.isOnline
  
  return {
    status,
    isOnline,
    isConnected: computed(() => realtimeManager.isConnected),
    subscribe: (config: ChannelConfig) => realtimeManager.subscribe(config),
    unsubscribe: (name: string) => realtimeManager.unsubscribe(name),
    getChannel: (name: string) => realtimeManager.getChannel(name),
    getChannelStatus: (name: string) => realtimeManager.getChannelStatus(name),
    broadcast: (channelName: string, event: string, payload: unknown) => 
      realtimeManager.broadcast(channelName, event, payload),
    trackPresence: (channelName: string, state: Record<string, unknown>) =>
      realtimeManager.trackPresence(channelName, state),
    untrackPresence: (channelName: string) =>
      realtimeManager.untrackPresence(channelName),
    getPresenceState: (channelName: string) =>
      realtimeManager.getPresenceState(channelName),
    forceReconnect: () => realtimeManager.forceReconnect(),
    onStatusChange: (callback: StatusCallback) => realtimeManager.onStatusChange(callback),
    onError: (callback: ErrorCallback) => realtimeManager.onError(callback),
  }
}
