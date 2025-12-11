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
    }
  }
})

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

// 重新连接 Realtime（用于移动端后台恢复）
export async function reconnectRealtime(): Promise<void> {
  try {
    // 【关键】先刷新 session token，解决 JWT 过期问题
    const hasValidSession = await refreshSessionToken()
    if (!hasValidSession) {
      console.warn('[Supabase] Cannot reconnect realtime: no valid session')
      return
    }
    
    // 先断开所有现有连接
    const channels = supabase.getChannels()
    for (const ch of channels) {
      try {
        await supabase.removeChannel(ch)
      } catch {}
    }
    
    // 强制重新连接 Realtime
    // @ts-ignore - 访问内部 API
    if (supabase.realtime) {
      // @ts-ignore
      supabase.realtime.disconnect()
      // 等待断开完成
      await new Promise(resolve => setTimeout(resolve, 500))
      // @ts-ignore
      supabase.realtime.connect()
    }
  } catch (e) {
    console.warn('[Supabase] Reconnect realtime failed:', e)
  }
}
