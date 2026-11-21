/**
 * 统一构造 spellingbee 的应用 URL。
 *
 * 应用（开发、构建、线上）统一部署在 /spellingbee/ 子路径下。
 * 邮箱验证、重置密码、OAuth 等所有回跳地址都必须显式带上这个前缀，
 * 不能依赖 window.location.pathname（用户可能恰好停在根路径或其他页面）。
 */

function normalizeBase(base: string): string {
  if (!base || base === '/') return '/'
  return `/${base.replace(/^\/+|\/+$/g, '')}/`
}

/** 应用部署前缀，统一为 '/spellingbee/' */
export const APP_BASE_PATH = normalizeBase(import.meta.env.BASE_URL)

/** 应用内相对路径：appPath('reset-password') => '/spellingbee/reset-password' */
export function appPath(path = ''): string {
  const clean = path.replace(/^\/+/, '')
  if (!clean) return APP_BASE_PATH
  return `${APP_BASE_PATH}${clean}`
}

/** 应用内绝对 URL：appUrl('reset-password') => 'https://yangruoji.com/spellingbee/reset-password' */
export function appUrl(path = ''): string {
  return `${window.location.origin}${appPath(path)}`
}

/**
 * _if_ 当前地址不在应用前缀下，跳转到带前缀的等价地址。
 * 保留 query 与 hash（Supabase recovery token 在 hash 中）。
 * 在 main.ts 挂载应用之前调用；若 base 为 '/' 则不做任何跳转。
 */
export function ensureAppBase(): void {
  if (APP_BASE_PATH === '/') return

  const path = window.location.pathname
  const prefix = APP_BASE_PATH.slice(0, -1)

  if (path.startsWith(`${prefix}/`)) return

  const relative = path === '/' || path === prefix ? '' : path.replace(/^\/+/, '')
  const target = `${appUrl(relative)}${window.location.search}${window.location.hash}`
  if (target !== window.location.href) {
    window.location.replace(target)
  }
}
