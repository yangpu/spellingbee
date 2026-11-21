import { createClient } from '@supabase/supabase-js'

// 走本站同源代理 /spellingbee/sb/ → nginx 转发到 Supabase。
// 手机直连 *.supabase.co 时 TLS 会被重置，同源代理可彻底绕开该问题；
// 配置成绝对地址时会保持直连（便于特殊部署）。
const configuredUrl = import.meta.env.VITE_SUPABASE_URL || '/spellingbee/sb/'
export const supabaseUrl = new URL(configuredUrl, window.location.origin).toString()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.')
}

/**
 * iOS Safari 的无痕模式 / “阻止跨站跟踪”可能让 localStorage 读写直接抛错，
 * supabase-js 在初始化或登录时就会失败（页面表现为 Load failed）。
 * 用内存存储兜底，保证至少当前会话可以完成认证。
 */
const memoryStorage = new Map<string, string>()
let storageUsable = true

try {
  const testKey = '__spellingbee_storage_test__'
  window.localStorage.setItem(testKey, '1')
  window.localStorage.removeItem(testKey)
} catch {
  storageUsable = false
}

export const safeStorage = {
  getItem(key: string): string | null {
    if (storageUsable) {
      try {
        const value = window.localStorage.getItem(key)
        if (value !== null) return value
      } catch {
        storageUsable = false
      }
    }
    return memoryStorage.get(key) ?? null
  },

  setItem(key: string, value: string): void {
    memoryStorage.set(key, value)
    if (!storageUsable) return
    try {
      window.localStorage.setItem(key, value)
    } catch {
      storageUsable = false
    }
  },

  removeItem(key: string): void {
    memoryStorage.delete(key)
    if (!storageUsable) return
    try {
      window.localStorage.removeItem(key)
    } catch {
      storageUsable = false
    }
  }
}

/**
 * 把 GoTrue 的 /auth/v1/token 请求改造成「CORS 简单请求」。
 *
 * supabase-js 默认带 apikey / Authorization / x-client-info 等自定义头，
 * 会触发 OPTIONS 预检；iPhone 上的 WebKit 对该预检（服务端还带 Set-Cookie）
 * 的处理与 Chromium 不一致，导致登录请求直接 Load failed。
 * Supabase 接受 apikey 放在查询参数、请求体为 text/plain 的 JSON，
 * 这样不产生预检，Mac / Android / iPhone 行为一致。
 */
const AUTH_SIMPLE_PATH = /\/auth\/v1\/(?:token|signup|recover|otp|resend|verify|magiclink)(?:\?|$)/

function toPreflightFreeRequest(input: RequestInfo | URL, init?: RequestInit): { input: RequestInfo | URL; init?: RequestInit } {
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : null

  if (!rawUrl || !AUTH_SIMPLE_PATH.test(rawUrl)) return { input, init }

  const headers = new Headers(init?.headers)
  const url = new URL(rawUrl)
  url.searchParams.set('apikey', supabaseAnonKey)

  // 这些端点只需要 anon key；去掉所有自定义头即可避免 OPTIONS 预检
  headers.delete('apikey')
  headers.delete('authorization')
  headers.delete('x-client-info')
  headers.set('Content-Type', 'text/plain;charset=UTF-8')

  return {
    input: url.toString(),
    init: {
      ...init,
      headers,
      credentials: 'omit',
      cache: 'no-store'
    }
  }
}

/**
 * 原生 fetch + 可控重试。
 * 不再使用第三方 fetch-retry 包装，避免 WebKit 上对 Request/body 的克隆差异；
 * 只对字符串/空 body 重试，避免流 body 被重复消费。
 */
export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = toPreflightFreeRequest(input, init)
  const maxRetries = 3
  const canRetry = !request.init?.body || typeof request.init.body === 'string'

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(request.input, request.init)
      if (!canRetry || attempt >= maxRetries || (response.status < 500 && response.status !== 520)) {
        return response
      }
    } catch (error) {
      if (!canRetry || attempt >= maxRetries) throw error
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 10000)))
  }
}

// 创建 Supabase 客户端
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: safeStorage
  },
  global: {
    // 使用原生 fetch，避免 iOS WebKit 与第三方包装器不兼容
    fetch: fetchWithRetry
  },
  realtime: {
    params: {
      // 挑战赛同时跑 Presence + Broadcast + postgres_changes，10/s 容易被限流丢包
      eventsPerSecond: 25
    },
    heartbeatIntervalMs: 15000,
  },
})

/**
 * 注意：Realtime 连接管理已迁移到 RealtimeManager
 * 
 * 以下函数保留用于向后兼容，但建议使用 realtimeManager：
 * - import { realtimeManager } from '@/lib/realtime-manager'
 * - realtimeManager.forceReconnect()
 * - realtimeManager.onStatusChange(callback)
 */

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
