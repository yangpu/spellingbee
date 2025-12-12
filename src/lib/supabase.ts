import { createClient } from '@supabase/supabase-js'
import fetchRetry from 'fetch-retry'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.')
}

// 使用 fetch-retry 包装 fetch，处理网络错误时的自动重试
// 这是 Supabase 官方推荐的方案：https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js
const fetchWithRetry = fetchRetry(fetch, {
  retries: 3, // 重试次数
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000), // 指数退避，最大10秒
  retryOn: (attempt, error, response) => {
    // 网络错误时重试
    if (error !== null) {
      return attempt < 3
    }
    // 服务器错误时重试 (5xx)
    if (response && response.status >= 500) {
      return attempt < 3
    }
    // Cloudflare 错误时重试
    if (response && response.status === 520) {
      return attempt < 3
    }
    return false
  },
})

// 创建 Supabase 客户端
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    // 使用带重试的 fetch
    fetch: fetchWithRetry,
  },
  realtime: {
    params: {
      eventsPerSecond: 10
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
