import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10
    },
    // 缩短心跳间隔，更快检测连接问题
    heartbeatIntervalMs: 15000,
  }
})

// Realtime 连接状态变化回调列表
type RealtimeStatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void
const realtimeStatusCallbacks: Set<RealtimeStatusCallback> = new Set()

// 注册 Realtime 状态变化回调
export function onRealtimeStatusChange(callback: RealtimeStatusCallback): () => void {
  realtimeStatusCallbacks.add(callback)
  return () => realtimeStatusCallbacks.delete(callback)
}

// 通知所有回调
function notifyRealtimeStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
  realtimeStatusCallbacks.forEach(cb => {
    try { cb(status) } catch {}
  })
}

// 设置心跳监听（检测连接问题）
let heartbeatInitialized = false
export function initRealtimeHeartbeat(): void {
  if (heartbeatInitialized) return
  heartbeatInitialized = true
  
  try {
    // @ts-ignore - onHeartbeat 是新版本 API
    if (typeof supabase.realtime?.onHeartbeat === 'function') {
      // @ts-ignore
      supabase.realtime.onHeartbeat((status: string) => {
        console.log('[Supabase] Heartbeat status:', status)
        if (status === 'ok') {
          notifyRealtimeStatus('connected')
        } else if (status === 'timeout' || status === 'disconnected') {
          notifyRealtimeStatus('disconnected')
        }
      })
    }
  } catch (e) {
    console.warn('[Supabase] Failed to setup heartbeat listener:', e)
  }
}

// 刷新 session token（解决 JWT 过期问题）
export async function refreshSessionToken(): Promise<boolean> {
  try {
    // 先尝试刷新 session
    const { data, error } = await supabase.auth.refreshSession()
    if (error) {
      console.warn('[Supabase] Failed to refresh session:', error.message)
      // 如果刷新失败，检查是否有有效的 session
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        console.warn('[Supabase] No valid session available')
        return false
      }
      // 有 session 但刷新失败，可能是网络问题，返回 true 继续尝试
      return true
    }
    console.log('[Supabase] Session refreshed successfully')
    return true
  } catch (e) {
    console.warn('[Supabase] Error refreshing session:', e)
    return false
  }
}

// 检查 Realtime 是否已连接
export function isRealtimeConnected(): boolean {
  try {
    // @ts-ignore - isConnected 是新版本 API
    if (typeof supabase.realtime?.isConnected === 'function') {
      // @ts-ignore
      return supabase.realtime.isConnected()
    }
    // 回退：检查是否有活跃的 channels
    return supabase.getChannels().length > 0
  } catch {
    return false
  }
}

// 强制重新连接 Realtime（彻底销毁旧连接，创建新连接）
export async function forceReconnectRealtime(): Promise<boolean> {
  console.log('[Supabase] Force reconnecting realtime...')
  notifyRealtimeStatus('reconnecting')
  
  try {
    // 1. 刷新 session token（解决 JWT 过期问题）
    const hasValidSession = await refreshSessionToken()
    if (!hasValidSession) {
      console.warn('[Supabase] Cannot reconnect realtime: no valid session')
      notifyRealtimeStatus('disconnected')
      return false
    }
    
    // 2. 使用官方 API 移除所有 channels（这会触发 unsubscribe）
    try {
      await supabase.removeAllChannels()
      console.log('[Supabase] All channels removed')
    } catch (e) {
      console.warn('[Supabase] Error removing channels:', e)
    }
    
    // 3. 强制断开 Realtime 连接
    try {
      // @ts-ignore - 访问内部 API
      if (supabase.realtime) {
        // @ts-ignore - disconnect 方法
        if (typeof supabase.realtime.disconnect === 'function') {
          // @ts-ignore
          supabase.realtime.disconnect()
          console.log('[Supabase] Realtime disconnected')
        }
      }
    } catch (e) {
      console.warn('[Supabase] Error disconnecting realtime:', e)
    }
    
    // 4. 等待断开完成
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 5. 强制重新连接
    try {
      // @ts-ignore - connect 方法
      if (supabase.realtime && typeof supabase.realtime.connect === 'function') {
        // @ts-ignore
        supabase.realtime.connect()
        console.log('[Supabase] Realtime connect called')
      }
    } catch (e) {
      console.warn('[Supabase] Error connecting realtime:', e)
    }
    
    // 6. 等待连接建立
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 7. 检查连接状态
    const connected = isRealtimeConnected()
    console.log('[Supabase] Realtime connected:', connected)
    
    if (connected) {
      notifyRealtimeStatus('connected')
    }
    
    return true
  } catch (e) {
    console.error('[Supabase] Force reconnect failed:', e)
    notifyRealtimeStatus('disconnected')
    return false
  }
}

// 兼容旧代码：reconnectRealtime 现在调用 forceReconnectRealtime
export async function reconnectRealtime(): Promise<void> {
  await forceReconnectRealtime()
}

// 页面可见性变化处理（用于移动端后台恢复和 PC 休眠恢复）
let visibilityChangeInitialized = false
let lastHiddenTime = 0
const RECONNECT_THRESHOLD_MS = 30000 // 30秒以上需要重连

export function initVisibilityChangeHandler(): void {
  if (visibilityChangeInitialized || typeof document === 'undefined') return
  visibilityChangeInitialized = true
  
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenTime = Date.now()
      console.log('[Supabase] Page hidden at:', new Date().toISOString())
    } else if (document.visibilityState === 'visible') {
      const hiddenDuration = Date.now() - lastHiddenTime
      console.log('[Supabase] Page visible, was hidden for:', hiddenDuration, 'ms')
      
      // 如果隐藏时间超过阈值，或者检测到连接已断开，强制重连
      if (hiddenDuration > RECONNECT_THRESHOLD_MS || !isRealtimeConnected()) {
        console.log('[Supabase] Triggering force reconnect due to visibility change')
        await forceReconnectRealtime()
      }
    }
  })
  
  // 监听 online 事件
  window.addEventListener('online', async () => {
    console.log('[Supabase] Network online, checking realtime connection...')
    // 网络恢复后，延迟检查并重连
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (!isRealtimeConnected()) {
      console.log('[Supabase] Realtime not connected, force reconnecting...')
      await forceReconnectRealtime()
    }
  })
  
  console.log('[Supabase] Visibility change handler initialized')
}

// 初始化心跳和可见性监听
initRealtimeHeartbeat()
initVisibilityChangeHandler()
