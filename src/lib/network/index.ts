/**
 * 网络模块导出
 */

// 类型
export * from './types'

// 连接器
export { SupabaseConnector } from './supabase-connector'
export { PeerJSConnector } from './peerjs-connector'

// 连接管理器
export {
  ConnectionManager,
  getConnectionManager,
  resetConnectionManager
} from './connection-manager'

// 网络适配器（为现有 challenge store 提供兼容接口）
export {
  NetworkAdapter,
  getNetworkAdapter,
  resetNetworkAdapter
} from './network-adapter'
export type { NetworkMode } from './network-adapter'

// 通知服务
export {
  notificationService,
  useChallengeNotifications
} from './notification-service'
