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

// 重新连接 Realtime（用于移动端后台恢复）
export async function reconnectRealtime(): Promise<void> {
  try {
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
