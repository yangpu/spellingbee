/**
 * 连接管理器
 * 管理多种网络连接方式，支持自动切换和故障转移
 */

import { ref, computed } from 'vue'
import type { ChallengeMessage, ChallengeParticipant } from '@/types'
import type {
  NetworkConnector,
  ConnectionType,
  ConnectionStatus,
  ConnectionManagerConfig,
  MessageHandler,
  StatusChangeHandler,
  ParticipantChangeHandler
} from './types'
import { SupabaseConnector } from './supabase-connector'
import { PeerJSConnector } from './peerjs-connector'

// 默认配置
// 注意：当前禁用 PeerJS，专注于 Supabase Realtime 服务
const DEFAULT_CONFIG: ConnectionManagerConfig = {
  preferredType: 'supabase',
  autoFallback: false, // 禁用自动切换到 PeerJS
  connectionTimeout: 10000,
  maxRetries: 3
}

/**
 * 连接管理器类
 * 负责管理网络连接，支持 Supabase Realtime 和 PeerJS 两种方式
 */
export class ConnectionManager {
  private config: ConnectionManagerConfig
  private connector: NetworkConnector | null = null
  private fallbackConnector: NetworkConnector | null = null
  private retryCount: number = 0
  private isHost: boolean = false
  private challengeId: string = ''
  
  // 响应式状态
  private _status = ref<ConnectionStatus>('disconnected')
  private _activeType = ref<ConnectionType | null>(null)
  private _connectionId = ref<string>('')
  
  // 事件处理器
  private messageHandler: MessageHandler | null = null
  private statusChangeHandler: StatusChangeHandler | null = null
  private participantChangeHandler: ParticipantChangeHandler | null = null
  
  constructor(config: Partial<ConnectionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }
  
  // 响应式 getters
  get status() {
    return this._status.value
  }
  
  get activeType() {
    return this._activeType.value
  }
  
  get connectionId() {
    return this._connectionId.value
  }
  
  get isConnected() {
    return this._status.value === 'connected'
  }
  
  /**
   * 初始化连接管理器
   */
  async init(): Promise<string> {
    // 根据首选类型创建连接器
    this.connector = this.createConnector(this.config.preferredType)
    this.setupConnectorHandlers(this.connector)
    
    try {
      const connectionId = await this.connector.init()
      this._connectionId.value = connectionId
      this._activeType.value = this.config.preferredType
      return connectionId
    } catch (error) {
      console.error(`Failed to init ${this.config.preferredType} connector:`, error)
      
      // 如果启用了自动切换，尝试备用连接
      if (this.config.autoFallback) {
        return await this.switchToFallback()
      }
      
      throw error
    }
  }
  
  /**
   * 创建房间（作为主机）
   */
  async createRoom(challengeId: string): Promise<void> {
    this.challengeId = challengeId
    this.isHost = true
    
    if (!this.connector) {
      await this.init()
    }
    
    try {
      await this.connector!.createRoom(challengeId)
    } catch (error) {
      console.error('Failed to create room:', error)
      
      if (this.config.autoFallback && this.retryCount < this.config.maxRetries) {
        this.retryCount++
        await this.switchToFallback()
        await this.connector!.createRoom(challengeId)
      } else {
        throw error
      }
    }
  }
  
  /**
   * 加入房间（作为参与者）
   */
  async joinRoom(challengeId: string, hostId?: string): Promise<void> {
    this.challengeId = challengeId
    this.isHost = false
    
    if (!this.connector) {
      await this.init()
    }
    
    try {
      await this.connector!.joinRoom(challengeId, hostId)
    } catch (error) {
      console.error('Failed to join room:', error)
      
      if (this.config.autoFallback && this.retryCount < this.config.maxRetries) {
        this.retryCount++
        await this.switchToFallback()
        await this.connector!.joinRoom(challengeId, hostId)
      } else {
        throw error
      }
    }
  }
  
  /**
   * 离开房间
   */
  async leaveRoom(): Promise<void> {
    if (this.connector) {
      await this.connector.leaveRoom()
    }
    this.challengeId = ''
    this.isHost = false
    this.retryCount = 0
  }
  
  /**
   * 发送消息给指定用户
   */
  sendTo(userId: string, message: ChallengeMessage): void {
    if (this.connector && this.isConnected) {
      this.connector.sendTo(userId, message)
    }
  }
  
  /**
   * 广播消息
   */
  broadcast(message: ChallengeMessage): void {
    if (this.connector && this.isConnected) {
      this.connector.broadcast(message)
    }
  }
  
  /**
   * 设置消息处理器
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
    if (this.connector) {
      this.connector.onMessage(handler)
    }
  }
  
  /**
   * 设置状态变化处理器
   */
  onStatusChange(handler: StatusChangeHandler): void {
    this.statusChangeHandler = handler
  }
  
  /**
   * 设置参与者变化处理器
   */
  onParticipantChange(handler: ParticipantChangeHandler): void {
    this.participantChangeHandler = handler
    if (this.connector) {
      this.connector.onParticipantChange(handler)
    }
  }
  
  /**
   * 手动切换连接类型
   */
  async switchConnectionType(type: ConnectionType): Promise<void> {
    if (this._activeType.value === type) {
      return
    }
    
    // 保存当前房间信息
    const savedChallengeId = this.challengeId
    const savedIsHost = this.isHost
    
    // 销毁当前连接器
    if (this.connector) {
      await this.connector.destroy()
    }
    
    // 创建新连接器
    this.connector = this.createConnector(type)
    this.setupConnectorHandlers(this.connector)
    
    await this.connector.init()
    this._activeType.value = type
    this._connectionId.value = this.connector.connectionId
    
    // 重新加入房间
    if (savedChallengeId) {
      if (savedIsHost) {
        await this.connector.createRoom(savedChallengeId)
      } else {
        await this.connector.joinRoom(savedChallengeId)
      }
    }
  }
  
  /**
   * 切换到备用连接
   */
  private async switchToFallback(): Promise<string> {
    const fallbackType: ConnectionType = this.config.preferredType === 'supabase' ? 'peerjs' : 'supabase'
    
    console.log(`Switching to fallback connection: ${fallbackType}`)
    
    // 销毁当前连接器
    if (this.connector) {
      await this.connector.destroy()
    }
    
    // 创建备用连接器
    this.connector = this.createConnector(fallbackType)
    this.setupConnectorHandlers(this.connector)
    
    const connectionId = await this.connector.init()
    this._connectionId.value = connectionId
    this._activeType.value = fallbackType
    
    return connectionId
  }
  
  /**
   * 创建连接器实例
   */
  private createConnector(type: ConnectionType): NetworkConnector {
    switch (type) {
      case 'supabase':
        return new SupabaseConnector()
      case 'peerjs':
        return new PeerJSConnector()
      default:
        throw new Error(`Unknown connection type: ${type}`)
    }
  }
  
  /**
   * 设置连接器事件处理器
   */
  private setupConnectorHandlers(connector: NetworkConnector): void {
    connector.onStatusChange((status, error) => {
      this._status.value = status
      
      if (this.statusChangeHandler) {
        this.statusChangeHandler(status, error)
      }
      
      // 连接错误时尝试切换
      if (status === 'error' && this.config.autoFallback && this.retryCount < this.config.maxRetries) {
        this.retryCount++
        this.switchToFallback().catch(console.error)
      }
    })
    
    if (this.messageHandler) {
      connector.onMessage(this.messageHandler)
    }
    
    if (this.participantChangeHandler) {
      connector.onParticipantChange(this.participantChangeHandler)
    }
  }
  
  /**
   * 获取当前连接器（用于特定操作）
   */
  getConnector(): NetworkConnector | null {
    return this.connector
  }
  
  /**
   * 销毁连接管理器
   */
  async destroy(): Promise<void> {
    if (this.connector) {
      await this.connector.destroy()
      this.connector = null
    }
    
    if (this.fallbackConnector) {
      await this.fallbackConnector.destroy()
      this.fallbackConnector = null
    }
    
    this._status.value = 'disconnected'
    this._activeType.value = null
    this._connectionId.value = ''
    this.challengeId = ''
    this.isHost = false
    this.retryCount = 0
    
    this.messageHandler = null
    this.statusChangeHandler = null
    this.participantChangeHandler = null
  }
}

// 导出单例工厂函数
let managerInstance: ConnectionManager | null = null

export function getConnectionManager(config?: Partial<ConnectionManagerConfig>): ConnectionManager {
  if (!managerInstance) {
    managerInstance = new ConnectionManager(config)
  }
  return managerInstance
}

export function resetConnectionManager(): void {
  if (managerInstance) {
    managerInstance.destroy()
    managerInstance = null
  }
}
