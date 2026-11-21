import { supabaseUrl } from '@/lib/supabase'

/**
 * 同源代理路径，例如 /spellingbee/sb/。
 * nginx / Vite dev 都会把该前缀转发到 Supabase。
 */
const proxyBase = new URL(supabaseUrl).pathname.replace(/\/?$/, '/')

/**
 * 把图片地址统一改成同源代理的相对路径。
 *
 * 历史数据里存的是 https://<project>.supabase.co/storage/... 直链，
 * iPhone 的 WebKit 直连该域名会失败（登录也遇到过同样问题），
 * 而 Chromium 能通，所以表现为 iPhone 看不到头像、Mac/Android 正常。
 *
 * 非 Supabase 资源（Unsplash / Picsum / 默认封面 / data URI 等）原样保留。
 */
export function normalizeMediaUrl(url?: string | null): string {
  if (!url) return ''
  const value = String(url).trim()
  if (!value || value === 'default' || /^(data|blob):/i.test(value)) return value

  try {
    const parsed = new URL(value, window.location.origin)
    const path = parsed.pathname

    // 已经是代理地址（可能是历史写入的绝对地址），统一成相对路径避免绑定 host
    if (path.startsWith(proxyBase)) {
      return `${path}${parsed.search}${parsed.hash}`
    }

    // 直连 Supabase 的 Storage / Edge Function 资源
    if (/\.supabase\.co$/i.test(parsed.hostname) && /^\/(storage|functions)\/v1\//.test(path)) {
      return `${proxyBase}${path.replace(/^\//, '')}${parsed.search}${parsed.hash}`
    }
  } catch {
    // 非法 URL 原样返回
  }

  return value
}
