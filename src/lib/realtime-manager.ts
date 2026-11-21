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
  subscribePromise: Promise<RealtimeChannel> | null
  lastError: Error | null
  retryCount: number
  // 订阅超时句柄与作废标记：避免迟到的回调操作已被清理的 channel
  subscribeTimeoutId?: ReturnType<typeof setTimeout> | null
  aborted?: boolean
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
  // 重连期间待发广播的最大条数与有效期（毫秒）
  MAX_PENDING_BROADCASTS: 50,
  PENDING_BROADCAST_TTL: 20000,
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
  private hardReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private softReconnectAttempts = 0
  private hardReconnectAttempts = 0
  private isReconnecting = false
  private reconnectLockTime = 0  // 记录重连锁定开始时间

  // 单一重连协调器：所有重连请求合并到同一个 in-flight Promise，
  // 避免 online/visibility/focus/pageshow 同时触发多个并发 hardReconnect
  private hardReconnectInFlight: Promise<void> | null = null
  private reconnectEpoch = 0

  // 重连期间的广播/Presence 缓冲，连接恢复后按序补发
  private pendingBroadcasts: Array<{ channelName: string; event: string; payload: unknown; at: number }> = []
  private pendingPresence: Map<string, Record<string, unknown>> = new Map()
  // 重连期间期望恢复的频道；channels 被清空时不能误判为「全部已连接」
  private expectedChannels: string[] = []
  
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
  async subscribe(config: ChannelConfig, skipReconnectWait = false): Promise<RealtimeChannel> {
    this.log(`Subscribe called for ${config.name}`)
    this.init() // 确保已初始化

    // 外部订阅等待正在进行的重连；重连内部重订阅必须跳过，避免自等待死锁
    if (!skipReconnectWait && this.hardReconnectInFlight) {
      this.log(`Waiting for reconnect to complete before subscribing ${config.name}...`)
      await this.hardReconnectInFlight
    }

    const existingManaged = this.channels.get(config.name)
    if (existingManaged?.channel && existingManaged.status === 'connected') {
      this.log(`Channel ${config.name} already subscribed, returning existing`)
      return existingManaged.channel
    }

    // 同名 channel 正在订阅中：复用同一个 Promise，避免重复建连造成幽灵 channel
    if (existingManaged?.status === 'connecting' && existingManaged.subscribePromise) {
      this.log(`Channel ${config.name} is connecting, reusing in-flight subscription`)
      return await existingManaged.subscribePromise
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
      subscribeTimeoutId: null,
      aborted: false,
    }

    this.channels.set(config.name, managed)
    this.log(`Created managed channel for ${config.name}, calling doSubscribe...`)

    const subscribePromise = this.doSubscribe(managed)
    managed.subscribePromise = subscribePromise

    try {
      const channel = await subscribePromise
      this.log(`doSubscribe completed for ${config.name}`)
      return channel
    } catch (error) {
      this.error(`doSubscribe failed for ${config.name}:`, error)
      managed.status = 'disconnected'
      managed.lastError = error as Error
      throw error
    } finally {
      managed.subscribePromise = null
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
    // 主动退订时同步移除期望，避免离线后被重连逻辑反复重建
    this.expectedChannels = this.expectedChannels.filter(n => n !== name)
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
    this.log('Force reconnect requested')
    await this.requestHardReconnect()
  }

  /**
   * 单一重连协调器：合并并发请求，保证同一时刻只有一个 hardReconnect 在跑。
   * 事件监听、健康检查、业务层都走这里，避免反复 disconnect/connect 把房间踢下线。
   */
  private async requestHardReconnect(): Promise<void> {
    if (this.isUnloading) return
    if (this.hardReconnectInFlight) {
      this.log('Hard reconnect already in flight, coalescing request')
      return this.hardReconnectInFlight
    }

    this.clearReconnectTimer()
    // 不重置 hardReconnectAttempts，保留指数退避，避免失败时 200ms 无限重连
    this.reconnectEpoch++
    const epoch = this.reconnectEpoch

    const task = this.hardReconnect(epoch).finally(() => {
      if (this.reconnectEpoch === epoch) {
        this.hardReconnectInFlight = null
      }
    })
    this.hardReconnectInFlight = task
    return task
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
      // 重连期间缓存消息，连接恢复后补发，避免心跳/状态广播直接丢失
      this.queueBroadcast(channelName, event, payload)
      return
    }

    this.sendBroadcast(managed.channel, event, payload)
  }

  private queueBroadcast(channelName: string, event: string, payload: unknown): void {
    const now = Date.now()
    this.pendingBroadcasts = this.pendingBroadcasts.filter(
      item => now - item.at < CONFIG.PENDING_BROADCAST_TTL
    )
    this.pendingBroadcasts.push({ channelName, event, payload, at: now })
    if (this.pendingBroadcasts.length > CONFIG.MAX_PENDING_BROADCASTS) {
      this.pendingBroadcasts.splice(0, this.pendingBroadcasts.length - CONFIG.MAX_PENDING_BROADCASTS)
    }
  }

  private sendBroadcast(channel: RealtimeChannel, event: string, payload: unknown): void {
    try {
      const result = channel.send({
        type: 'broadcast',
        event,
        payload,
      })
      // supabase-js 的 send 可能返回 Promise，记录失败以便观测限流/断连
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        ;(result as Promise<unknown>).catch((e) => {
          this.warn(`Broadcast send failed (${event}):`, e)
        })
      }
    } catch (e) {
      this.warn(`Broadcast send threw (${event}):`, e)
    }
  }

  private flushPendingBroadcasts(channelName: string, channel: RealtimeChannel): void {
    const now = Date.now()
    const ready = this.pendingBroadcasts.filter(
      item => item.channelName === channelName && now - item.at < CONFIG.PENDING_BROADCAST_TTL
    )
    this.pendingBroadcasts = this.pendingBroadcasts.filter(item => !ready.includes(item))
    for (const item of ready) {
      this.sendBroadcast(channel, item.event, item.payload)
    }
    if (ready.length > 0) {
      this.log(`Flushed ${ready.length} queued broadcasts for ${channelName}`)
    }
  }
  
  /**
   * 更新 presence 状态
   */
  async trackPresence(channelName: string, state: Record<string, unknown>): Promise<void> {
    const managed = this.channels.get(channelName)
    if (!managed?.channel || managed.status !== 'connected') {
      // 重连期间记下最新的 Presence，恢复连接后自动重新 track
      this.pendingPresence.set(channelName, state)
      return
    }

    try {
      await managed.channel.track(state)
    } catch (e) {
      // 忽略 track 错误，可能是连接断开
      this.warn(`Presence track failed for ${channelName}:`, e)
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
    this.expectedChannels = []
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
    // 立即登记 channel，确保订阅中/超时也能被 cleanupChannel 正确移除
    managed.channel = channel
    managed.aborted = false

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
        if (!resolved && !managed.aborted) {
          resolved = true
          managed.status = 'disconnected'
          void this.cleanupChannel(managed)
          reject(new Error(`Channel ${config.name} subscription timeout`))
        }
      }, timeout)
      managed.subscribeTimeoutId = timeoutId

      channel.subscribe(async (status, err) => {
        if (managed.aborted) return

        this.log(`Channel ${config.name} status: ${status}`)

        if (status === 'SUBSCRIBED') {
          if (resolved) return
          resolved = true
          clearTimeout(timeoutId)
          managed.subscribeTimeoutId = null
          managed.channel = channel
          managed.status = 'connected'
          managed.retryCount = 0

          this.updateGlobalStatus()

          // 恢复重连期间缓存的 Presence 状态（优先于初始状态）
          const queuedPresence = this.pendingPresence.get(config.name)
          const presenceState = queuedPresence || config.presenceConfig?.initialState
          if (presenceState) {
            try {
              await channel.track(presenceState)
              this.pendingPresence.delete(config.name)
            } catch (e) {
              this.warn(`Failed to track presence for ${config.name}:`, e)
            }
          }

          // 补发重连期间缓存的广播
          this.flushPendingBroadcasts(config.name, channel)

          resolve(channel)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (resolved) return
          resolved = true
          clearTimeout(timeoutId)
          managed.subscribeTimeoutId = null
          managed.status = 'disconnected'
          managed.lastError = new Error(`Channel ${status}: ${err}`)
          this.notifyError(managed.lastError, config.name)
          reject(managed.lastError)
        } else if (status === 'CLOSED') {
          managed.status = 'disconnected'
          this.updateGlobalStatus()
          // 订阅成功后真实断连也要触发重连（原来只在未 resolve 时处理）
          if (config.autoResubscribe && this._isOnline.value && !this.isUnloading) {
            void this.requestHardReconnect()
          }
        }
      })
    })
  }
  
  /**
   * 清理单个 channel
   */
  private async cleanupChannel(managed: ManagedChannel): Promise<void> {
    // 先作废，让迟到的订阅回调/超时不再操作已清理对象
    managed.aborted = true
    if (managed.subscribeTimeoutId) {
      clearTimeout(managed.subscribeTimeoutId)
      managed.subscribeTimeoutId = null
    }
    managed.subscribePromise = null

    const channel = managed.channel
    managed.channel = null
    managed.status = 'disconnected'

    if (!channel) return

    // 先发起 removeChannel（内部会 unsubscribe），再 untrack；
    // 最多等待 1 秒，避免底层连接已死时把重连流程卡住，但移除动作仍会完成
    const removal = (async () => {
      try { await supabase.removeChannel(channel) } catch {}
    })()
    try {
      const untrack = channel.untrack()
      if (untrack && typeof (untrack as Promise<unknown>).catch === 'function') {
        ;(untrack as Promise<unknown>).catch(() => {})
      }
    } catch {}
    try {
      await Promise.race([
        removal,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])
    } catch {}
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
      this.log('Network changed and not all connected, requesting reconnect')
      // 交给单一协调器，避免与 online/visibility/focus 事件并发重连
      await this.requestHardReconnect()
    }
  }
  
  /**
   * 处理网络上线
   */
  private handleOnline = async (): Promise<void> => {
    this.log('Network online')
    this._isOnline.value = true

    // 立即检查连接状态，快速重连（由协调器合并并发请求）
    await new Promise(resolve => setTimeout(resolve, CONFIG.NETWORK_RECOVERY_DELAY))

    if (this._isOnline.value && !this.isAllConnected()) {
      this.log('Network online and not all connected, requesting reconnect')
      await this.requestHardReconnect()
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
      
      // 切回前台时健康检查会补连；只有长时间隐藏后才主动请求一次重连，
      // 避免每次 visibilitychange 都全局 disconnect/connect 把房间踢下线
      if (hiddenDuration > CONFIG.VISIBILITY_RECONNECT_THRESHOLD &&
          (!this.isAllConnected() || !this.isChannelHealthy())) {
        this.log('Requesting reconnect after long visibility change')
        await this.requestHardReconnect()
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
    
    // 检查连接状态，如果断开则请求重连（协调器会合并并发请求）
    if (!this.isChannelHealthy()) {
      this.log('Window focused and channels unhealthy, requesting reconnect')
      await this.requestHardReconnect()
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
        this.log('Page restored and not all connected, requesting reconnect')
        await this.requestHardReconnect()
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
    
    // 硬重连期间不强制解锁，避免健康检查打断重订阅循环
    if (this.isReconnecting && !this.hardReconnectInFlight && this.reconnectLockTime > 0) {
      const lockDuration = Date.now() - this.reconnectLockTime
      if (lockDuration > CONFIG.RECONNECT_LOCK_TIMEOUT) {
        this.warn(`Reconnect lock timeout after ${lockDuration}ms, forcing reset`)
        this.isReconnecting = false
        this.reconnectLockTime = 0
      }
    }
    
    // 检查是否有 channel 断开；协调器会合并重连期间的所有重复请求
    if (!this.isAllConnected() && !this.isReconnecting) {
      this.log('Health check: found disconnected channels, requesting reconnect')
      await this.requestHardReconnect()
    }
    
    // 更新全局状态
    this.updateGlobalStatus()
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.isUnloading) return  // 页面正在卸载，不重连
    if (this.isReconnecting || this.reconnectTimer || this.hardReconnectInFlight) return
    if (!this._isOnline.value) return

    // 检查是否超过最大重试次数
    if (this.softReconnectAttempts >= CONFIG.MAX_SOFT_RECONNECT_ATTEMPTS) {
      this.log('Max soft reconnect attempts reached, requesting hard reconnect')
      this.softReconnectAttempts = 0
      void this.requestHardReconnect()
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
    if (this.isReconnecting || this.hardReconnectInFlight) return
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
   * 由 requestHardReconnect 单入口调用；epoch 用于作废被新请求打断的旧流程。
   */
  private async hardReconnect(epoch: number): Promise<void> {
    if (this.isUnloading) return

    if (this.hardReconnectAttempts >= CONFIG.MAX_HARD_RECONNECT_ATTEMPTS) {
      this.warn('Max hard reconnect attempts reached, resetting counter and trying again')
      this.hardReconnectAttempts = 0
    }

    this.hardReconnectAttempts++
    this.isReconnecting = true
    this.reconnectLockTime = Date.now()
    this._status.value = 'reconnecting'
    this.notifyStatus('reconnecting')

    this.log(`Hard reconnecting (attempt ${this.hardReconnectAttempts})...`)
    const stillCurrent = () => epoch === this.reconnectEpoch && !this.isUnloading

    try {
      // 1. 刷新 session
      const hasSession = await this.refreshSession()
      if (!hasSession) {
        this.warn('No valid session, cannot reconnect')
        this.scheduleHardReconnect()
        return
      }
      if (!stillCurrent()) return

      // 2. 保存所有 channel 配置（含 autoResubscribe:false），避免版本频道永久丢失
      const channelsToResubscribe = Array.from(this.channels.values())
        .map(m => ({ ...m.config }))
      this.expectedChannels = channelsToResubscribe.map(c => c.name)

      // 3. 清理所有 channel
      for (const managed of this.channels.values()) {
        await this.cleanupChannel(managed)
      }
      this.channels.clear()

      // 4. 移除所有残留的 channel
      try { await supabase.removeAllChannels() } catch {}

      // 5. 断开 Realtime
      try {
        // @ts-ignore
        if (supabase.realtime?.disconnect) {
          // @ts-ignore
          supabase.realtime.disconnect()
        }
      } catch {}

      await new Promise(resolve => setTimeout(resolve, CONFIG.WS_DISCONNECT_DELAY))
      if (!stillCurrent()) return

      // 6. 重连 Realtime
      try {
        // @ts-ignore
        if (supabase.realtime?.connect) {
          // @ts-ignore
          supabase.realtime.connect()
        }
      } catch {}

      const wsConnected = await this.waitForWebSocketConnection()
      if (!wsConnected) {
        // 底层 WS 尚未就绪也继续订阅：supabase-js 会在 channel.subscribe 时按需建连，
        // 直接放弃会把已清空的频道永久留在断开状态
        this.warn('WebSocket not ready yet, still attempting channel resubscribe')
      }
      if (!stillCurrent()) return

      // 7. 串行重新订阅；跳过等待自身，避免死锁
      const sortedChannels = channelsToResubscribe.sort((a, b) => {
        const getPriority = (name: string) => {
          if (name.startsWith('challenge:')) return 0
          if (name === 'challenge-notifications') return 1
          return 2
        }
        return getPriority(a.name) - getPriority(b.name)
      })

      for (const config of sortedChannels) {
        if (!stillCurrent()) return
        try {
          await this.subscribe(config, true)
          await new Promise(resolve => setTimeout(resolve, CONFIG.CHANNEL_SUBSCRIBE_DELAY))
        } catch (e) {
          this.warn(`Failed to resubscribe channel ${config.name}:`, e)
        }
      }

      if (this.isAllConnected()) {
        this.log('Hard reconnect successful')
        this.expectedChannels = []
        this.hardReconnectAttempts = 0
        this.softReconnectAttempts = 0
      } else {
        this.scheduleHardReconnect()
      }
    } catch (e) {
      this.error('Hard reconnect failed:', e)
      this.scheduleHardReconnect()
    } finally {
      // 关键：锁必须在整个重订阅循环结束后才释放，否则 5s 健康检查会反复打断重连
      this.isReconnecting = false
      this.reconnectLockTime = 0
      this.updateGlobalStatus()
    }
  }

  /**
   * 安排硬重连（单一可取消定时器）
   */
  private scheduleHardReconnect(): void {
    if (this.isUnloading || this.hardReconnectTimer) return

    const delay = Math.min(
      CONFIG.BASE_RECONNECT_DELAY * Math.pow(2, this.hardReconnectAttempts),
      CONFIG.MAX_RECONNECT_DELAY
    )

    this.log(`Scheduling hard reconnect in ${delay}ms`)
    this.hardReconnectTimer = setTimeout(() => {
      this.hardReconnectTimer = null
      if (this.isUnloading || !this._isOnline.value) return
      if (!this.isAllConnected() && !this.hardReconnectInFlight) {
        void this.requestHardReconnect()
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
    if (this.hardReconnectTimer) {
      clearTimeout(this.hardReconnectTimer)
      this.hardReconnectTimer = null
    }
  }

  /**
   * 检查是否所有 channel 都已连接
   */
  private isAllConnected(): boolean {
    if (this.channels.size === 0 && this.expectedChannels.length === 0) return true

    // 重连期间按「期望频道」判定，避免 channels.clear() 之后短暂误判为已连接
    if (this.expectedChannels.length > 0) {
      for (const name of this.expectedChannels) {
        const managed = this.channels.get(name)
        if (!managed || managed.status !== 'connected') return false
      }
      return true
    }

    for (const managed of this.channels.values()) {
      if (managed.status !== 'connected') return false
    }
    return true
  }

  /**
   * 除 channel 状态外，再检查底层 WebSocket 是否真的打开。
   * 切后台再回前台时 channel 状态可能仍是 connected，但底层连接已断。
   */
  private isChannelHealthy(): boolean {
    if (!this.isAllConnected()) return false
    try {
      // @ts-ignore - 访问内部 WebSocket 状态
      const ws = supabase.realtime?.conn
      if (ws && ws.readyState !== WebSocket.OPEN) return false
    } catch {}
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
