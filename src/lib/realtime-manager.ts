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
  // 页面隐藏后的重连阈值（毫秒）- 降低到 3 秒，更积极地重连
  VISIBILITY_RECONNECT_THRESHOLD: 3000,
  // 最大软重连次数
  MAX_SOFT_RECONNECT_ATTEMPTS: 2,
  // 最大硬重连次数 - 增加到 10 次，确保能恢复
  MAX_HARD_RECONNECT_ATTEMPTS: 10,
  // 基础重连延迟（毫秒）- 降低到 100ms，更快开始重连
  BASE_RECONNECT_DELAY: 100,
  // 最大重连延迟（毫秒）- 降低到 3 秒，避免等待太久
  MAX_RECONNECT_DELAY: 3000,
  // 默认 channel 超时（毫秒）
  DEFAULT_CHANNEL_TIMEOUT: 10000,
  // 连接稳定等待时间（毫秒）
  CONNECTION_STABLE_DELAY: 50,
  // 清理等待时间（毫秒）
  CLEANUP_DELAY: 30,
  // 网络恢复后立即重连延迟（毫秒）- 几乎立即
  NETWORK_RECOVERY_DELAY: 10,
  // 等待重连完成的最大时间（毫秒）
  WAIT_FOR_RECONNECT_TIMEOUT: 10000,
  // 网络状态检测间隔（毫秒）
  NETWORK_CHECK_INTERVAL: 50,
  // 健康检查间隔（毫秒）- 每 5 秒检查一次连接状态
  HEALTH_CHECK_INTERVAL: 5000,
  // 重连锁定超时（毫秒）- 防止 isReconnecting 卡住
  RECONNECT_LOCK_TIMEOUT: 15000,
  // WebSocket 断开等待时间（毫秒）
  WS_DISCONNECT_DELAY: 200,
  // WebSocket 连接等待时间（毫秒）- 初始等待
  WS_CONNECT_DELAY: 300,
  // WebSocket 连接最大等待时间（毫秒）
  WS_CONNECT_MAX_WAIT: 5000,
  // WebSocket 连接检查间隔（毫秒）
  WS_CONNECT_CHECK_INTERVAL: 100,
  // Channel 订阅间隔（毫秒）- 避免并发订阅冲突
  CHANNEL_SUBSCRIBE_DELAY: 50,
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
  private reconnectLockTime = 0  // 记录重连锁定开始时间
  
  // 事件监听器是否已添加
  private listenersInitialized = false
  
  // 页面是否正在卸载
  private isUnloading = false
  
  // 健康检查定时器
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  
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
    this.startHealthCheck()
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
  private async waitForReconnect(maxWait = CONFIG.WAIT_FOR_RECONNECT_TIMEOUT): Promise<void> {
    const startTime = Date.now()
    let waitCount = 0
    while (this.isReconnecting && Date.now() - startTime < maxWait) {
      waitCount++
      if (waitCount % 10 === 0) {
        this.log(`Still waiting for reconnect... (${Math.round((Date.now() - startTime) / 1000)}s)`)
      }
      await new Promise(resolve => setTimeout(resolve, CONFIG.NETWORK_CHECK_INTERVAL))
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
    this.log('Force reconnecting all channels...')
    
    // 重置所有重连计数器和状态
    this.clearReconnectTimer()
    this.softReconnectAttempts = 0
    this.hardReconnectAttempts = 0
    this.isReconnecting = false  // 强制重置，允许立即重连
    this.reconnectLockTime = 0
    
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
    if (!managed?.channel || managed.status !== 'connected') {
      // 静默忽略，channel 可能正在重连中
      return
    }
    
    try {
      managed.channel.send({
        type: 'broadcast',
        event,
        payload,
      })
    } catch (e) {
      // 忽略发送错误
    }
  }
  
  /**
   * 更新 presence 状态
   */
  async trackPresence(channelName: string, state: Record<string, unknown>): Promise<void> {
    const managed = this.channels.get(channelName)
    if (!managed?.channel || managed.status !== 'connected') {
      // 静默忽略，channel 可能正在重连中
      return
    }
    
    try {
      await managed.channel.track(state)
    } catch (e) {
      // 忽略 track 错误，可能是连接断开
    }
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
    this.stopHealthCheck()
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
    
    // 使用配置的 channel 名称作为 Supabase channel 名称
    // 注意：所有客户端必须使用相同的 channel 名称才能互相通信
    const channelName = config.name
    
    // 创建 channel
    const channelOptions: any = {
      config: {
        broadcast: { self: false },
      },
    }
    
    if (config.presenceConfig) {
      channelOptions.config.presence = { key: config.presenceConfig.key }
    }
    
    const channel = supabase.channel(channelName, channelOptions)
    
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
    window.addEventListener('focus', this.handleFocus)  // 添加 focus 事件监听
    window.addEventListener('pageshow', this.handlePageShow)  // 添加 pageshow 事件监听
    
    // 监听网络连接变化（包括网络切换、休眠恢复等）
    if ('connection' in navigator) {
      const connection = (navigator as any).connection
      if (connection) {
        connection.addEventListener('change', this.handleNetworkChange)
      }
    }
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
    window.removeEventListener('focus', this.handleFocus)
    window.removeEventListener('pageshow', this.handlePageShow)
    
    // 移除网络连接变化监听
    if ('connection' in navigator) {
      const connection = (navigator as any).connection
      if (connection) {
        connection.removeEventListener('change', this.handleNetworkChange)
      }
    }
  }
  
  /**
   * 处理网络连接变化（休眠恢复、网络切换等）
   */
  private handleNetworkChange = async (): Promise<void> => {
    this.log('Network connection changed')
    
    // 检查当前网络状态
    if (!navigator.onLine) {
      this.handleOffline()
      return
    }
    
    // 网络已恢复，立即尝试重连
    this._isOnline.value = true
    
    // 如果连接已断开，立即重连
    if (!this.isAllConnected()) {
      this.log('Network changed and not all connected, triggering immediate reconnect')
      this.clearReconnectTimer()
      this.softReconnectAttempts = 0
      this.hardReconnectAttempts = 0
      // 强制重置重连状态
      this.isReconnecting = false
      this.reconnectLockTime = 0
      
      // 立即重连，不等待
      await this.hardReconnect()
    }
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
    // 强制重置重连状态
    this.isReconnecting = false
    this.reconnectLockTime = 0
    
    // 立即检查连接状态，快速重连
    await new Promise(resolve => setTimeout(resolve, CONFIG.NETWORK_RECOVERY_DELAY))
    
    if (this._isOnline.value && !this.isAllConnected()) {
      this.log('Network online and not all connected, triggering immediate reconnect')
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
      
      // 重置重连计数
      this.softReconnectAttempts = 0
      this.hardReconnectAttempts = 0
      
      // 无论隐藏时间多长，只要连接断开就立即重连
      if (!this.isAllConnected()) {
        this.log('Triggering hard reconnect due to disconnected channels after visibility change')
        // 强制重置重连状态，确保能立即重连
        this.isReconnecting = false
        this.reconnectLockTime = 0
        await this.hardReconnect()
      } else if (hiddenDuration > CONFIG.VISIBILITY_RECONNECT_THRESHOLD) {
        // 隐藏时间超过阈值，即使看起来连接正常也强制重连确保状态正确
        this.log('Triggering hard reconnect due to long visibility change')
        this.isReconnecting = false
        this.reconnectLockTime = 0
        await this.hardReconnect()
      }
    }
  }
  
  /**
   * 处理页面关闭
   */
  private handleBeforeUnload = (): void => {
    // 标记页面正在卸载，阻止任何重连尝试
    this.isUnloading = true
    
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
  private handlePageHide = (event: PageTransitionEvent): void => {
    // 如果是页面卸载（刷新/关闭），标记为正在卸载
    if (event.persisted === false) {
      this.isUnloading = true
    }
    this.handleBeforeUnload()
  }
  
  /**
   * 处理窗口获得焦点（移动端切换 app 回来）
   */
  private handleFocus = async (): Promise<void> => {
    this.log('Window focused')
    
    // 只有在网络在线时才处理
    if (!this._isOnline.value) return
    
    // 检查连接状态，如果断开则立即重连
    if (!this.isAllConnected() && !this.isReconnecting) {
      this.log('Window focused and not all connected, triggering reconnect')
      this.softReconnectAttempts = 0
      this.hardReconnectAttempts = 0
      await this.hardReconnect()
    }
  }
  
  /**
   * 处理页面显示（从 bfcache 恢复）
   */
  private handlePageShow = async (event: PageTransitionEvent): Promise<void> => {
    if (event.persisted) {
      // 页面从 bfcache 恢复
      this.log('Page restored from bfcache')
      this.isUnloading = false
      
      if (this._isOnline.value && !this.isAllConnected()) {
        this.log('Page restored and not all connected, triggering reconnect')
        this.softReconnectAttempts = 0
        this.hardReconnectAttempts = 0
        await this.hardReconnect()
      }
    }
  }
  
  /**
   * 启动健康检查
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) return
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, CONFIG.HEALTH_CHECK_INTERVAL)
  }
  
  /**
   * 停止健康检查
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }
  
  /**
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    if (this.isUnloading) return
    if (!this._isOnline.value) return
    if (document.visibilityState === 'hidden') return
    
    // 检查重连锁定是否超时
    if (this.isReconnecting && this.reconnectLockTime > 0) {
      const lockDuration = Date.now() - this.reconnectLockTime
      if (lockDuration > CONFIG.RECONNECT_LOCK_TIMEOUT) {
        this.warn(`Reconnect lock timeout after ${lockDuration}ms, forcing reset`)
        this.isReconnecting = false
        this.reconnectLockTime = 0
      }
    }
    
    // 检查是否有 channel 断开
    if (!this.isAllConnected() && !this.isReconnecting) {
      this.log('Health check: found disconnected channels, triggering reconnect')
      await this.hardReconnect()
    }
    
    // 更新全局状态
    this.updateGlobalStatus()
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.isUnloading) return  // 页面正在卸载，不重连
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
      
      if (this.isUnloading) return  // 页面正在卸载，不重连
      if (!this._isOnline.value || this.isAllConnected()) return
      
      this.softReconnectAttempts++
      await this.softReconnect()
    }, delay)
  }
  
  /**
   * 软重连：只重连断开的 channel
   */
  private async softReconnect(): Promise<void> {
    if (this.isUnloading) return  // 页面正在卸载，不重连
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
    // 页面正在卸载，不重连
    if (this.isUnloading) return
    
    if (this.hardReconnectAttempts >= CONFIG.MAX_HARD_RECONNECT_ATTEMPTS) {
      this.warn('Max hard reconnect attempts reached, resetting counter and trying again')
      this.hardReconnectAttempts = 0
      // 不放弃，继续尝试
    }
    
    // 检查重连锁定是否超时
    if (this.isReconnecting) {
      const lockDuration = Date.now() - this.reconnectLockTime
      if (lockDuration > CONFIG.RECONNECT_LOCK_TIMEOUT) {
        this.warn(`Reconnect lock timeout, forcing reset`)
        this.isReconnecting = false
        this.reconnectLockTime = 0
      } else {
        this.log('Already reconnecting, skip duplicate call')
        return
      }
    }
    
    this.hardReconnectAttempts++
    this.isReconnecting = true
    this.reconnectLockTime = Date.now()
    this._status.value = 'reconnecting'
    this.notifyStatus('reconnecting')
    
    this.log(`Hard reconnecting (attempt ${this.hardReconnectAttempts})...`)
    
    try {
      // 1. 刷新 session
      const hasSession = await this.refreshSession()
      if (!hasSession) {
        this.warn('No valid session, cannot reconnect')
        this.isReconnecting = false
        this.reconnectLockTime = 0
        this.updateGlobalStatus()
        this.scheduleHardReconnect()
        return
      }
      
      // 2. 保存需要重订阅的 channel 配置
      const channelsToResubscribe = Array.from(this.channels.values())
        .filter(m => m.config.autoResubscribe)
        .map(m => ({ ...m.config }))  // 深拷贝配置
      
      // 3. 清理所有 channel（不删除配置，只清理连接）
      for (const managed of this.channels.values()) {
        await this.cleanupChannel(managed)
      }
      this.channels.clear()
      
      // 4. 移除所有残留的 channel
      try {
        await supabase.removeAllChannels()
      } catch (e) {
        // 忽略错误
      }
      
      // 5. 断开 Realtime
      try {
        // @ts-ignore
        if (supabase.realtime?.disconnect) {
          // @ts-ignore
          supabase.realtime.disconnect()
        }
      } catch (e) {
        // 忽略错误
      }
      
      // 等待 WebSocket 完全断开
      await new Promise(resolve => setTimeout(resolve, CONFIG.WS_DISCONNECT_DELAY))
      
      // 6. 重连 Realtime
      try {
        // @ts-ignore
        if (supabase.realtime?.connect) {
          // @ts-ignore
          supabase.realtime.connect()
        }
      } catch (e) {
        // 忽略错误
      }
      
      // 等待 WebSocket 连接建立（带超时检测）
      const wsConnected = await this.waitForWebSocketConnection()
      if (!wsConnected) {
        this.warn('WebSocket connection timeout, will retry')
        this.isReconnecting = false
        this.reconnectLockTime = 0
        this.scheduleHardReconnect()
        return
      }
      
      // 7. 重新订阅所有 channel（标记为非重连状态以避免死锁）
      this.isReconnecting = false
      this.reconnectLockTime = 0
      
      // 串行订阅 channel，避免并发冲突
      // 按优先级排序：
      // 1. challenge room channel（最高优先级，游戏核心功能）
      // 2. challenge-notifications（挑战赛通知）
      // 3. 其他 channel（如 app-version-updates）
      const sortedChannels = channelsToResubscribe.sort((a, b) => {
        const getPriority = (name: string) => {
          if (name.startsWith('challenge:')) return 0  // 挑战赛房间最高优先级
          if (name === 'challenge-notifications') return 1  // 挑战赛通知次之
          return 2  // 其他 channel 最低优先级
        }
        return getPriority(a.name) - getPriority(b.name)
      })
      
      for (const config of sortedChannels) {
        try {
          await this.subscribe(config)
          // 短暂延迟，避免并发订阅冲突
          await new Promise(resolve => setTimeout(resolve, CONFIG.CHANNEL_SUBSCRIBE_DELAY))
        } catch (e) {
          // 订阅失败不阻塞其他 channel
          this.warn(`Failed to resubscribe channel ${config.name}:`, e)
          // 如果是非关键 channel（如 app-version-updates），继续处理其他 channel
          // 关键 channel 失败会在后续健康检查中重试
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
      this.isReconnecting = false
      this.reconnectLockTime = 0
      this.updateGlobalStatus()
      this.scheduleHardReconnect()
    }
  }
  
  /**
   * 安排硬重连
   */
  private scheduleHardReconnect(): void {
    if (this.isUnloading) return  // 页面正在卸载，不重连
    
    // 快速指数退避：200ms, 400ms, 800ms, 1.6s, 3.2s, 5s...
    const delay = Math.min(
      CONFIG.BASE_RECONNECT_DELAY * Math.pow(2, this.hardReconnectAttempts),
      CONFIG.MAX_RECONNECT_DELAY
    )
    
    this.log(`Scheduling hard reconnect in ${delay}ms`)
    
    setTimeout(() => {
      if (this.isUnloading) return  // 页面正在卸载，不重连
      if (this._isOnline.value && !this.isAllConnected()) {
        // 检查是否卡在 isReconnecting 状态
        if (this.isReconnecting) {
          const lockDuration = Date.now() - this.reconnectLockTime
          if (lockDuration > CONFIG.RECONNECT_LOCK_TIMEOUT) {
            this.isReconnecting = false
            this.reconnectLockTime = 0
          }
        }
        if (!this.isReconnecting) {
          this.hardReconnect()
        }
      }
    }, delay)
  }
  
  /**
   * 等待 WebSocket 连接建立
   * 返回 true 表示连接成功，false 表示超时
   */
  private async waitForWebSocketConnection(): Promise<boolean> {
    const startTime = Date.now()
    
    // 先等待初始延迟
    await new Promise(resolve => setTimeout(resolve, CONFIG.WS_CONNECT_DELAY))
    
    // 检查 WebSocket 状态
    while (Date.now() - startTime < CONFIG.WS_CONNECT_MAX_WAIT) {
      try {
        // @ts-ignore - 访问内部 WebSocket 状态
        const ws = supabase.realtime?.conn
        if (ws && ws.readyState === WebSocket.OPEN) {
          this.log('WebSocket connected')
          return true
        }
        
        // 如果 WebSocket 不存在或正在连接中，继续等待
        // @ts-ignore
        const isConnecting = supabase.realtime?.isConnected?.() === false
        if (!isConnecting && ws?.readyState === WebSocket.CLOSED) {
          // WebSocket 已关闭，尝试重新连接
          try {
            // @ts-ignore
            supabase.realtime?.connect()
          } catch (e) {
            // 忽略
          }
        }
      } catch (e) {
        // 忽略访问错误
      }
      
      await new Promise(resolve => setTimeout(resolve, CONFIG.WS_CONNECT_CHECK_INTERVAL))
    }
    
    this.warn('WebSocket connection wait timeout')
    return false
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
