/**
 * 网络连接抽象层类型定义
 * 支持多种连接方式：Supabase Realtime、PeerJS WebRTC
 */

import type { ChallengeMessage, Challenge, ChallengeParticipant } from '@/types'

// 连接类型
export type ConnectionType = 'supabase' | 'peerjs'

// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// 网络连接器接口
export interface NetworkConnector {
  // 连接类型
  readonly type: ConnectionType
  
  // 当前状态
  readonly status: ConnectionStatus
  
  // 连接标识（peerId 或 channel name）
  readonly connectionId: string
  
  // 初始化连接
  init(): Promise<string>
  
  // 作为主机创建房间
  createRoom(challengeId: string): Promise<void>
  
  // 作为参与者加入房间
  joinRoom(challengeId: string, hostId?: string): Promise<void>
  
  // 离开房间
  leaveRoom(): Promise<void>
  
  // 发送消息给指定用户
  sendTo(userId: string, message: ChallengeMessage): void
  
  // 广播消息给所有连接的用户
  broadcast(message: ChallengeMessage): void
  
  // 设置消息处理器
  onMessage(handler: MessageHandler): void
  
  // 设置连接状态变化处理器
  onStatusChange(handler: StatusChangeHandler): void
  
  // 设置参与者状态变化处理器
  onParticipantChange(handler: ParticipantChangeHandler): void
  
  // 清理资源
  destroy(): Promise<void>
}

// 消息处理器
export type MessageHandler = (message: ChallengeMessage, fromUserId: string) => void

// 状态变化处理器
export type StatusChangeHandler = (status: ConnectionStatus, error?: Error) => void

// 参与者变化处理器
export type ParticipantChangeHandler = (
  type: 'join' | 'leave' | 'update',
  participant: Partial<ChallengeParticipant>
) => void

// 连接管理器配置
export interface ConnectionManagerConfig {
  // 首选连接类型
  preferredType: ConnectionType
  // 是否启用自动切换
  autoFallback: boolean
  // 连接超时时间（毫秒）
  connectionTimeout: number
  // 重连次数
  maxRetries: number
}

// 全局通知事件
export interface ChallengeNotification {
  type: 'new_challenge' | 'challenge_started' | 'challenge_finished' | 'invite'
  challenge: Challenge
  fromUser?: {
    id: string
    nickname: string
    avatar_url?: string
  }
  timestamp: number
}

// 通知处理器
export type NotificationHandler = (notification: ChallengeNotification) => void

// Supabase Realtime 特定类型
export interface RealtimePresenceState {
  [key: string]: {
    user_id: string
    nickname: string
    avatar_url?: string
    is_ready: boolean
    score: number
    online_at: string
  }[]
}

// PeerJS 特定类型
export interface PeerConnectionInfo {
  peerId: string
  userId: string
  connection: unknown // DataConnection
}
