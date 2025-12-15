import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { realtimeManager, type ChannelConfig, type RealtimeStatus } from '@/lib/realtime-manager'
import { useAuthStore } from './auth'
import { useWordsStore } from './words'
import { useLearningStore } from './learning'
import { useCompetitionStore } from './competition'
import { useAnnouncerStore } from './announcer'
import type { Challenge, ChallengeParticipant, ChallengeWord, ChallengeMessage, ChallengeWordResult, Word } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ==================== 心跳和保护机制常量 ====================
const HEARTBEAT_CONFIG = {
  // 选手向主持人发送心跳的间隔（毫秒）
  PLAYER_HEARTBEAT_INTERVAL: 3000,
  // 主持人广播状态的间隔（毫秒）- 正常情况
  HOST_BROADCAST_INTERVAL: 3000,  // 减少到3秒，更快同步状态
  // 主持人广播状态的间隔（毫秒）- 有离线选手时，提高频率以同步倒计时
  HOST_BROADCAST_INTERVAL_FAST: 1000,
  // 心跳超时时间（毫秒）- 超过此时间未收到心跳视为离线
  HEARTBEAT_TIMEOUT: 15000,  // 增加到15秒，减少误判
  // 离线保护时间（毫秒）- 离线后等待此时间才判定为退赛
  OFFLINE_PROTECTION_TIME: 30000,
  // 快速离线检测时间（毫秒）- 用于 UI 显示离线状态
  QUICK_OFFLINE_DETECTION: 12000,  // 增加到12秒
  // 本地倒计时检查间隔（毫秒）- 所有客户端都检查
  LOCAL_COUNTDOWN_CHECK_INTERVAL: 1000,
  // 房主离线检测容错次数 - 连续多次未收到广播才确认离线
  HOST_OFFLINE_CONFIRM_COUNT: 3,
} as const

export const useChallengeStore = defineStore('challenge', () => {
  const authStore = useAuthStore()
  const wordsStore = useWordsStore()

  // State
  const challenges = ref<Challenge[]>([])
  const currentChallenge = ref<Challenge | null>(null)
  const loading = ref(false)
  const syncing = ref(false)
  const myChallengeRecords = ref<Challenge[]>([]) // 用户参与的挑战记录
  
  // 缓存控制
  const lastLoadTime = ref<number>(0)
  const CACHE_DURATION = 30 * 1000 // 30秒内不重复请求
  const CACHE_KEY = 'challenges_cache'
  const CACHE_TIME_KEY = 'challenges_cache_time'
  
  // 从 localStorage 加载缓存
  function loadFromCache(): boolean {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      const cachedTime = localStorage.getItem(CACHE_TIME_KEY)
      if (cached && cachedTime) {
        const data = JSON.parse(cached)
        if (Array.isArray(data) && data.length > 0) {
          challenges.value = data.map(c => ({
            ...c,
            participants: c.participants || []
          }))
          lastLoadTime.value = parseInt(cachedTime, 10)
          return true
        }
      }
    } catch (e) {
      console.error('[Challenge] Failed to load from cache:', e)
    }
    return false
  }
  
  // 保存到 localStorage 缓存
  function saveToCache(): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(challenges.value))
      localStorage.setItem(CACHE_TIME_KEY, lastLoadTime.value.toString())
    } catch (e) {
      console.error('[Challenge] Failed to save to cache:', e)
    }
  }
  
  // 列表更新标志：当收到通知或其他需要刷新的事件时设置为 true
  // 进入列表页时检查此标志，如果为 true 则刷新并重置
  const needsRefresh = ref(false)

  // Supabase Realtime state (使用 RealtimeManager)
  const currentChannelName = ref<string>('')
  const connectionId = ref<string>('')
  const isHost = ref(false)
  const realtimeStatus = ref<RealtimeStatus>('disconnected')
  
  // 从 RealtimeManager 获取网络状态
  const isNetworkOnline = realtimeManager.isOnline
  
  // 真实的连接状态：结合网络状态和 Realtime 连接状态
  const connectionStatus = computed<'disconnected' | 'connecting' | 'connected'>(() => {
    if (!isNetworkOnline.value) {
      return 'disconnected'
    }
    if (realtimeStatus.value === 'reconnecting') {
      return 'connecting'
    }
    return realtimeStatus.value as 'disconnected' | 'connecting' | 'connected'
  })
  
  // 保留 PeerJS 相关变量以兼容旧代码（但不再使用）
  const peer = ref<any>(null)
  const peerId = ref<string>('')
  const connections = ref<Map<string, any>>(new Map())
  
  // RealtimeManager 状态变化回调取消函数
  let unsubscribeRealtimeStatus: (() => void) | null = null
  
  // 初始化 RealtimeManager 状态监听
  function initRealtimeStatusListener(): void {
    if (unsubscribeRealtimeStatus) return
    
    unsubscribeRealtimeStatus = realtimeManager.onStatusChange(async (status) => {
      realtimeStatus.value = status
      
      // 更新本地用户的在线状态
      if (currentChallenge.value && authStore.user) {
        const myParticipant = currentChallenge.value.participants.find(
          p => p.user_id === authStore.user!.id
        )
        if (myParticipant) {
          if (status === 'connected') {
            myParticipant.is_online = true
            if (isHost.value) {
              myParticipant.is_ready = true
            }
            
            // 重连成功后，重新发送 Presence 状态到服务器
            // 这样其他用户才能看到我们的在线状态
            if (currentChannelName.value) {
              try {
                await updatePresence({ 
                  is_ready: myParticipant.is_ready,
                  score: myParticipant.score || 0
                })
                
                // 同时触发一次 Presence 同步，获取其他用户的最新状态
                handlePresenceSync()
              } catch (e) {
                console.warn('[Challenge] Failed to update presence after reconnect:', e)
              }
            }
          } else if (status === 'disconnected') {
            myParticipant.is_online = false
            myParticipant.is_ready = false
          }
        }
      }
    })
  }
  
  // 清理 RealtimeManager 状态监听
  function cleanupRealtimeStatusListener(): void {
    if (unsubscribeRealtimeStatus) {
      unsubscribeRealtimeStatus()
      unsubscribeRealtimeStatus = null
    }
  }

  // Game state
  const gameWords = ref<ChallengeWord[]>([])
  const currentRound = ref(0)
  const currentWord = ref<Word | null>(null)
  const roundStartTime = ref(0)
  const roundTimeRemaining = ref(0)
  const roundTimer = ref<ReturnType<typeof setInterval> | null>(null)
  const gameStatus = ref<'waiting' | 'ready' | 'playing' | 'round_result' | 'finished'>('waiting')
  
  // Realtime 数据库订阅 channel（用于监听 challenges 表变更）
  const dbChannel = ref<RealtimeChannel | null>(null)
  const roundResults = ref<ChallengeWordResult[]>([])
  const myAnswer = ref('')
  const hasSubmitted = ref(false)
  const roundEnded = ref(false) // 标记当前轮是否已结束，防止竞态条件
  
  // ==================== 心跳和状态同步 ====================
  // 选手心跳定时器（非主机用）
  let playerHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  // 主机状态广播定时器
  let hostBroadcastTimer: ReturnType<typeof setInterval> | null = null
  // 记录每个选手最后心跳时间（主机用）
  const lastHeartbeatMap = new Map<string, number>()
  // 记录每个选手离线开始时间（用于保护期计算）- 所有客户端都维护
  const offlineStartTimeMap = new Map<string, number>()
  // 页面可见性和网络状态监听器清理函数
  let cleanupVisibilityListener: (() => void) | null = null
  // 非主机：记录最后收到主机广播的时间（用于检测主机离线）
  let lastHostBroadcastTime = 0
  // 非主机：检测主机离线的定时器
  let hostOfflineCheckTimer: ReturnType<typeof setInterval> | null = null
  // 非主机：标记主机是否被确认为离线（防止 Presence sync 覆盖）
  let hostConfirmedOffline = false
  // 非主机：主机离线检测计数器（连续多次未收到广播才确认离线）
  let hostOfflineCheckCount = 0
  // 本地倒计时检查定时器（所有客户端都运行）
  let localCountdownTimer: ReturnType<typeof setInterval> | null = null
  // 标记比赛是否已经由本客户端结束（防止重复结束）
  let gameEndedByMe = false

  // Computed
  const isCreator = computed(() => {
    if (!currentChallenge.value || !authStore.user) return false
    return currentChallenge.value.creator_id === authStore.user.id
  })

  const myParticipant = computed(() => {
    if (!currentChallenge.value || !authStore.user) return null
    return currentChallenge.value.participants.find(p => p.user_id === authStore.user!.id)
  })

  const allOnline = computed(() => {
    if (!currentChallenge.value) return false
    // 房主总是被认为在线（如果他在房间内），其他参与者检查 is_online
    return currentChallenge.value.participants.every(p => 
      p.user_id === currentChallenge.value!.creator_id || p.is_online
    )
  })

  const allReady = computed(() => {
    if (!currentChallenge.value) return false
    // 房主总是被认为已准备，其他参与者需要手动准备
    return currentChallenge.value.participants.every(p => 
      p.user_id === currentChallenge.value!.creator_id || p.is_ready
    )
  })

  const canStart = computed(() => {
    if (!currentChallenge.value) return false
    const hasEnoughPlayers = currentChallenge.value.participants.length >= 2
    // 使用 allReady 和 allOnline 计算属性（房主总是被认为已准备和在线）
    return isCreator.value && hasEnoughPlayers && allReady.value && allOnline.value
  })

  const sortedParticipants = computed(() => {
    if (!currentChallenge.value) return []
    return [...currentChallenge.value.participants].sort((a, b) => b.score - a.score)
  })

  // 初始化 Supabase Realtime Channel（使用 RealtimeManager）
  async function initRealtimeChannel(challengeId: string): Promise<string> {
    if (!authStore.user) {
      throw new Error('请先登录')
    }
    
    // 初始化 RealtimeManager 状态监听
    initRealtimeStatusListener()
    
    const channelName = `challenge:${challengeId}`
    currentChannelName.value = channelName
    connectionId.value = authStore.user.id
    realtimeStatus.value = 'connecting'
    
    // 获取当前用户的参与者信息
    const myParticipant = currentChallenge.value?.participants.find(
      p => p.user_id === authStore.user!.id
    )
    
    // 创建 channel 配置
    const config: ChannelConfig = {
      name: channelName,
      type: 'mixed',
      autoResubscribe: true,
      timeout: 15000,
      presenceConfig: {
        key: authStore.user.id,
        initialState: {
          user_id: authStore.user.id,
          nickname: authStore.profile?.nickname || authStore.user.email?.split('@')[0],
          avatar_url: authStore.profile?.avatar_url,
          is_ready: myParticipant?.is_ready ?? false,
          score: myParticipant?.score ?? 0,
          online_at: new Date().toISOString()
        }
      },
      subscriptions: [
        // 广播消息
        {
          type: 'broadcast',
          event: 'message',
          callback: (payload) => {
            const message = payload.payload as ChallengeMessage
            if (message.sender_id !== authStore.user?.id) {
              handleMessage(message, message.sender_id)
            }
          }
        },
        // 定向消息
        {
          type: 'broadcast',
          event: `message:${authStore.user.id}`,
          callback: (payload) => {
            const message = payload.payload as ChallengeMessage
            handleMessage(message, message.sender_id)
          }
        },
        // Presence 同步（使用节流版本减少频繁调用）
        {
          type: 'presence',
          presenceEvent: 'sync',
          callback: () => throttledPresenceSync()
        },
        // Presence 加入
        {
          type: 'presence',
          presenceEvent: 'join',
          callback: ({ key, newPresences }: any) => {
            if (key !== authStore.user?.id && newPresences?.length > 0) {
              handlePresenceJoin(key, newPresences[0])
            }
          }
        },
        // Presence 离开
        {
          type: 'presence',
          presenceEvent: 'leave',
          callback: ({ key }: any) => {
            // 忽略自己的 leave 事件
            if (key !== authStore.user?.id) {
              handlePresenceLeave(key)
            }
          }
        }
      ]
    }
    
    try {
      await realtimeManager.subscribe(config)
      realtimeStatus.value = 'connected'
      
      // 设置页面可见性和网络状态监听
      setupVisibilityAndNetworkListeners()
      
      // 注意：心跳机制需要在 isHost 确定后由调用方手动启动
      // 调用 startHeartbeatMechanism() 来启动
      
      return connectionId.value
    } catch (error) {
      realtimeStatus.value = 'disconnected'
      throw error
    }
  }
  
  // 启动心跳机制（在 isHost 确定后调用）
  function startHeartbeatMechanism(): void {
    // 重置游戏结束标志
    gameEndedByMe = false
    
    if (isHost.value) {
      startHostBroadcast()
    } else {
      startPlayerHeartbeat()
    }
    
    // 所有客户端都启动本地倒计时检查
    // 这样即使房主离线，其他客户端也能检测并结束比赛
    startLocalCountdownCheck()
  }
  
  // Presence 同步节流（减少频繁调用）
  let presenceSyncTimer: ReturnType<typeof setTimeout> | null = null
  const PRESENCE_SYNC_THROTTLE = 100  // 100ms 节流
  
  // 用于追踪用户连续离线的次数（防止 track 更新时的瞬时离线）
  const offlineCountMap = new Map<string, number>()
  const OFFLINE_CONFIRM_COUNT = 3  // 连续 3 次 sync 都不在线才确认离线
  
  // 心跳机制确认的离线用户（优先级高于 Presence sync）
  // 当心跳超时确认离线后，不再受 Presence sync 影响
  const heartbeatConfirmedOffline = new Set<string>()
  
  // 节流版本的 Presence 同步处理
  function throttledPresenceSync(): void {
    if (presenceSyncTimer) {
      clearTimeout(presenceSyncTimer)
    }
    presenceSyncTimer = setTimeout(() => {
      presenceSyncTimer = null
      handlePresenceSync()
    }, PRESENCE_SYNC_THROTTLE)
  }
  
  // 处理 Presence 同步 - 这是唯一可靠的状态来源
  // sync 事件包含当前 channel 的完整 Presence 状态快照
  // 注意：比赛进行中，分数只能由房主的 round_end 消息更新，不从 Presence 同步
  function handlePresenceSync(): void {
    if (!currentChallenge.value || !currentChannelName.value) return
    
    const state = realtimeManager.getPresenceState(currentChannelName.value)
    const creatorId = currentChallenge.value.creator_id
    const myUserId = authStore.user?.id
    const isGameInProgress = gameStatus.value === 'playing' || gameStatus.value === 'round_result'
    
    // 更新所有参与者的在线状态 - 基于 Presence 状态快照
    currentChallenge.value.participants.forEach(participant => {
      const userId = participant.user_id
      const presences = state[userId] as any[]
      const isCreator = userId === creatorId
      
      // 不要修改自己的状态（自己的状态由本地控制）
      if (userId === myUserId) {
        return
      }
      
      // 如果是主机且已被确认离线，忽略 Presence sync 的状态
      // 主机离线检测的优先级更高
      if (isCreator && hostConfirmedOffline) {
        // 不更新任何状态
        return
      }
      
      if (presences && presences.length > 0) {
        const presence = presences[0]
        
        // 如果心跳机制已确认该用户离线，忽略 Presence sync 的状态
        // 心跳机制的优先级更高，因为它是应用层的主动检测
        if (heartbeatConfirmedOffline.has(userId)) {
          console.log(`[PresenceSync] 忽略用户 ${userId.slice(0,8)} 的 Presence（已在 heartbeatConfirmedOffline 中）`)
          return
        }
        
        // 如果用户已经在离线倒计时中，不要因为 Presence 状态恢复在线
        // Presence 可能有延迟或缓存，导致用户关闭页面后状态仍然存在
        if (offlineStartTimeMap.has(userId)) {
          console.log(`[PresenceSync] 忽略用户 ${userId.slice(0,8)} 的 Presence（已在 offlineStartTimeMap 中）`)
          return
        }
        
        // 用户在 Presence 中存在，说明在线
        if (!participant.is_online) {
          console.log(`[PresenceSync] 用户 ${userId.slice(0,8)} 状态变更: 离线 -> 在线`)
        }
        participant.is_online = true
        if (isCreator) {
          participant.is_ready = true
        } else {
          participant.is_ready = presence.is_ready || false
        }
        // 【重要】比赛进行中不从 Presence 更新分数，分数只能由房主的 round_end 消息更新
        // 这样可以避免 Presence 的延迟数据覆盖最新分数
        if (!isGameInProgress && presence.score !== undefined) {
          participant.score = presence.score
        }
        // 重置离线计数
        offlineCountMap.delete(userId)
      } else {
        // 用户不在 Presence 中
        // 使用计数器确认用户真的离线，而不是 track 更新时的瞬时状态
        const count = (offlineCountMap.get(userId) || 0) + 1
        offlineCountMap.set(userId, count)
        
        // 只有连续多次 sync 都不在线才确认离线
        if (count >= OFFLINE_CONFIRM_COUNT && participant.is_online) {
          console.log(`[PresenceSync] 用户 ${userId.slice(0,8)} 状态变更: 在线 -> 离线（连续 ${count} 次不在 Presence 中）`)
          participant.is_online = false
          participant.is_ready = false
          offlineCountMap.delete(userId)
          
          // 标记为心跳确认离线，防止后续 Presence sync 覆盖状态
          heartbeatConfirmedOffline.add(userId)
          
          // 记录离线开始时间（用于倒计时）
          // 注意：不要在这里调用 handleExitGameAsHost，
          // 退赛逻辑应该由 checkHeartbeatsAndBroadcast 或 checkLocalCountdowns 
          // 在 30 秒保护期结束后处理
          if (!offlineStartTimeMap.has(userId)) {
            offlineStartTimeMap.set(userId, Date.now())
            participant.offline_since = Date.now()
            console.log(`[PresenceSync] 记录用户 ${userId.slice(0,8)} 离线开始时间: ${participant.offline_since}`)
          }
        }
      }
    })
  }
  
  // 处理参与者加入
  function handlePresenceJoin(userId: string, presence: any): void {
    if (!currentChallenge.value) return
    
    // 如果是主机且已被确认离线，忽略 Presence join 事件
    // 主机离线检测的优先级更高
    if (userId === currentChallenge.value.creator_id && hostConfirmedOffline) {
      console.log(`[PresenceJoin] 忽略主机 ${userId.slice(0,8)} 的 join 事件（hostConfirmedOffline）`)
      return
    }
    
    // 如果用户已在离线倒计时中，忽略 Presence join 事件
    // Presence 可能有延迟，需要通过心跳恢复在线
    if (offlineStartTimeMap.has(userId) || heartbeatConfirmedOffline.has(userId)) {
      console.log(`[PresenceJoin] 忽略用户 ${userId.slice(0,8)} 的 join 事件（offlineStartTimeMap: ${offlineStartTimeMap.has(userId)}, heartbeatConfirmedOffline: ${heartbeatConfirmedOffline.has(userId)}）`)
      return
    }
    
    let participant = currentChallenge.value.participants.find(p => p.user_id === userId)
    
    if (participant) {
      // 更新已存在的参与者状态
      if (!participant.is_online) {
        console.log(`[PresenceJoin] 用户 ${userId.slice(0,8)} 状态变更: 离线 -> 在线`)
      }
      participant.is_online = true
      if (userId === currentChallenge.value.creator_id) {
        participant.is_ready = true
      } else {
        participant.is_ready = presence.is_ready || false
      }
    } else {
      // 添加新参与者（通过 Presence 发现的新用户）
      const newParticipant: ChallengeParticipant = {
        user_id: userId,
        nickname: presence.nickname || '未知用户',
        avatar_url: presence.avatar_url,
        is_online: true,
        is_ready: presence.is_ready || false,
        score: presence.score || 0,
        joined_at: new Date().toISOString()
      }
      currentChallenge.value.participants.push(newParticipant)
    }
    
    if (isHost.value) {
      broadcastSync()
    }
  }
  
  // 处理参与者离开 - 不再使用，离线状态完全由 sync 事件处理
  // 保留此函数是为了兼容性，但实际上不做任何处理
  // 因为 track() 更新状态时会触发虚假的 leave 事件
  function handlePresenceLeave(_userId: string): void {
    // 不再处理 leave 事件
    // 离线状态完全由 handlePresenceSync 基于完整状态快照来判断
    // 这样可以避免 track() 更新时产生的虚假 leave 事件
  }
  
  // 更新 Presence 状态
  async function updatePresence(data: Partial<{ is_ready: boolean; score: number }>): Promise<void> {
    if (!currentChannelName.value || !authStore.user) return
    
    const state = realtimeManager.getPresenceState(currentChannelName.value)
    const currentState = (state[authStore.user.id]?.[0] as any) || {}
    
    await realtimeManager.trackPresence(currentChannelName.value, {
      ...currentState,
      user_id: authStore.user.id,
      nickname: authStore.profile?.nickname || authStore.user.email?.split('@')[0],
      avatar_url: authStore.profile?.avatar_url,
      ...data,
      online_at: new Date().toISOString()
    })
  }

  // 兼容旧代码：initPeer 现在调用 initRealtimeChannel
  async function initPeer(): Promise<string> {
    if (currentChallenge.value) {
      return await initRealtimeChannel(currentChallenge.value.id)
    }
    if (authStore.user) {
      connectionId.value = authStore.user.id
      peerId.value = authStore.user.id
      realtimeStatus.value = 'connected'
      return authStore.user.id
    }
    throw new Error('请先登录')
  }

  // Broadcast message - 使用 RealtimeManager
  function broadcast(message: ChallengeMessage): void {
    if (currentChannelName.value) {
      realtimeManager.broadcast(currentChannelName.value, 'message', message)
    }
  }
  
  // Handle incoming message
  function handleMessage(message: ChallengeMessage, _fromUserId: string): void {
    switch (message.type) {
      case 'join':
        handleJoinMessage(message)
        break
      case 'leave':
        handleLeaveMessage(message)
        break
      case 'ready':
        handleReadyMessage(message)
        break
      case 'start':
        handleStartMessage(message)
        break
      case 'word':
        handleWordMessage(message)
        break
      case 'answer':
        handleAnswerMessage(message)
        break
      case 'round_end':
        handleRoundEndMessage(message)
        break
      case 'game_end':
        handleGameEndMessage(message)
        break
      case 'sync':
        handleSyncMessage(message)
        break
      case 'exit_game':
        handleExitGameMessage(message)
        break
      case 'heartbeat':
        handleHeartbeatMessage(message)
        break
      case 'status_broadcast':
        handleStatusBroadcastMessage(message)
        break
      case 'player_offline':
        handlePlayerOfflineMessage(message)
        break
      case 'player_online':
        handlePlayerOnlineMessage(message)
        break
      case 'request_game_state':
        handleRequestGameStateMessage(message)
        break
      case 'game_state':
        handleGameStateMessage(message)
        break
    }
  }

  // Message handlers
  function handleJoinMessage(message: ChallengeMessage): void {
    if (!isHost.value || !currentChallenge.value) return

    const data = message.data as {
      user_id: string
      nickname: string
      avatar_url?: string
      peer_id: string
    }

    //console.log('handleJoinMessage: user', data.nickname, 'peer_id', data.peer_id)

    // 查找参与者
    let participant = currentChallenge.value.participants.find(p => p.user_id === data.user_id)
    
    if (participant) {
      // 更新已存在的参与者状态
      participant.is_online = true
      participant.peer_id = data.peer_id
      //console.log('handleJoinMessage: updated existing participant online status')
    } else {
      // 添加新参与者
      const newParticipant: ChallengeParticipant = {
        user_id: data.user_id,
        nickname: data.nickname,
        avatar_url: data.avatar_url,
        is_online: true,
        is_ready: false,
        score: 0,
        peer_id: data.peer_id,
        joined_at: new Date().toISOString()
      }
      currentChallenge.value.participants.push(newParticipant)
      //console.log('handleJoinMessage: added new participant', data.nickname)
    }

    // 广播同步消息
    broadcastSync()
    // 同步到数据库
    syncParticipantsToDb()
  }

  function handleLeaveMessage(message: ChallengeMessage): void {
    if (!currentChallenge.value) return

    const userId = message.sender_id
    const participant = currentChallenge.value.participants.find(p => p.user_id === userId)
    if (participant) {
      participant.is_online = false
      participant.is_ready = false // 离开时重置准备状态
    }

    // 主机负责广播同步消息和同步到数据库
    if (isHost.value) {
      broadcastSync()
      syncParticipantsToDb()
    }
  }

  function handleReadyMessage(message: ChallengeMessage): void {
    if (!currentChallenge.value) return

    const data = message.data as { is_ready: boolean }
    
    const participant = currentChallenge.value.participants.find(p => p.user_id === message.sender_id)
    if (participant) {
      participant.is_ready = data.is_ready
    }

    if (isHost.value) {
      // 检查是否所有人都准备好了
      if (allReady.value && currentChallenge.value.participants.length >= currentChallenge.value.max_participants) {
        currentChallenge.value.status = 'ready'
      }
      broadcastSync()
      // 同步到数据库
      syncParticipantsToDb()
    }
  }

  function handleStartMessage(message: ChallengeMessage): void {
    const data = message.data as { words: Word[] }
    
    // 初始化游戏
    gameWords.value = data.words.map((word, index) => ({
      word,
      round: index + 1,
      status: index === 0 ? 'active' : 'pending',
      results: []
    }))
    
    currentRound.value = 1
    gameStatus.value = 'playing'
    
    if (currentChallenge.value) {
      currentChallenge.value.status = 'in_progress'
      currentChallenge.value.started_at = new Date().toISOString()
    }
    
    // 非主机用户订阅数据库变更（替代轮询）
    if (!isHost.value) {
      subscribeToDbChanges()
    }
    
    // 开始第一轮
    startRound()
  }

  function handleWordMessage(message: ChallengeMessage): void {
    const data = message.data as { 
      word: Word
      round: number
      time_limit: number
      round_start_time?: number  // 房主的开始时间戳
    }
    
    // 如果已经是这一轮了，忽略重复消息
    if (currentRound.value === data.round && gameStatus.value === 'playing') {
      return
    }
    
    currentWord.value = data.word
    currentRound.value = data.round
    hasSubmitted.value = false
    myAnswer.value = ''
    roundResults.value = []
    roundEnded.value = false // 重置轮次结束标志
    gameStatus.value = 'playing'
    
    // 使用房主的开始时间同步倒计时，减少延迟
    if (data.round_start_time) {
      const elapsed = Date.now() - data.round_start_time
      const remainingMs = Math.max(0, data.time_limit * 1000 - elapsed)
      roundTimeRemaining.value = Math.ceil(remainingMs / 1000)
      roundStartTime.value = data.round_start_time
    } else {
      // 兼容旧版本消息
      roundTimeRemaining.value = data.time_limit
      roundStartTime.value = Date.now()
    }
    
    // 启动倒计时
    startRoundTimer()
  }

  function handleAnswerMessage(message: ChallengeMessage): void {
    if (!isHost.value) return

    const data = message.data as {
      answer: string
      time_taken: number
      round: number // 答案对应的轮次
    }

    // 验证轮次：忽略过期的答案（来自上一轮的延迟消息）
    if (data.round !== currentRound.value) {
      //console.log(`[handleAnswerMessage] 忽略过期答案: 收到轮次 ${data.round}, 当前轮次 ${currentRound.value}`)
      return
    }

    // 如果当前轮已经结束，忽略后续答案
    if (roundEnded.value) {
      //console.log(`[handleAnswerMessage] 当前轮已结束，忽略答案`)
      return
    }

    const result: ChallengeWordResult = {
      user_id: message.sender_id,
      answer: data.answer,
      is_correct: currentWord.value ? data.answer.toLowerCase() === currentWord.value.word.toLowerCase() : false,
      time_taken: data.time_taken,
      submitted_at: new Date().toISOString()
    }

    roundResults.value.push(result)

    // 计算有效参与者数量（在线且未退赛的）
    const activeParticipants = currentChallenge.value?.participants.filter(
      p => p.is_online && !p.has_left
    ).length || 0

    // 检查是否有人答对了 - 立即结束本轮
    if (result.is_correct) {
      endRound(message.sender_id)
    } else if (roundResults.value.length >= activeParticipants) {
      // 所有在线参与者都提交了（都是错的）- 立即结束本轮
      endRound(null)
    }
  }

  function handleRoundEndMessage(message: ChallengeMessage): void {
    const data = message.data as {
      winner_id: string | null
      correct_answer: string
      results: ChallengeWordResult[]
      scores: { user_id: string; score: number }[]
    }

    // 如果已经是 round_result 状态，忽略重复消息
    if (gameStatus.value === 'round_result') {
      return
    }

    stopRoundTimer()
    gameStatus.value = 'round_result'
    roundResults.value = data.results

    // 更新分数
    if (currentChallenge.value) {
      data.scores.forEach(s => {
        const participant = currentChallenge.value!.participants.find(p => p.user_id === s.user_id)
        if (participant) {
          participant.score = s.score
        }
      })
    }

    // 播放播音员音效：本轮获胜播放成功音效，否则播放失败音效
    const announcerStore = useAnnouncerStore()
    // 确保播音员已初始化
    announcerStore.init().then(() => {
      if (data.winner_id === authStore.user?.id) {
        announcerStore.playSuccess()
      } else {
        announcerStore.playFailure()
      }
    })

    // 3秒后进入下一轮
    setTimeout(async () => {
      if (isHost.value) {
        await nextRound()
      }
    }, 3000)
  }

  function handleGameEndMessage(message: ChallengeMessage): void {
    const data = message.data as {
      winner_id: string
      winner_name: string
      final_scores: { user_id: string; score: number }[]
      prize_pool?: number
      game_words?: ChallengeWord[]
    }

    stopRoundTimer()
    gameStatus.value = 'finished'

    if (currentChallenge.value) {
      currentChallenge.value.status = 'finished'
      currentChallenge.value.winner_id = data.winner_id
      currentChallenge.value.winner_name = data.winner_name
      currentChallenge.value.finished_at = new Date().toISOString()
      
      // 更新奖池
      if (data.prize_pool) {
        currentChallenge.value.prize_pool = data.prize_pool
      } else {
        // 如果没有传递奖池，自己计算
        currentChallenge.value.prize_pool = currentChallenge.value.entry_fee * currentChallenge.value.participants.length
      }

      // 更新比赛单词记录（从主机同步）
      if (data.game_words) {
        gameWords.value = data.game_words
        currentChallenge.value.game_words = data.game_words
      }

      // 更新最终分数
      data.final_scores.forEach(s => {
        const participant = currentChallenge.value!.participants.find(p => p.user_id === s.user_id)
        if (participant) {
          participant.score = s.score
        }
      })

      // 更新缓存列表中的挑战赛
      updateChallengeInList(currentChallenge.value)
    }

    // 不再标记刷新，因为 updateChallengeInList 已经更新了本地缓存

    // 播放播音员音效：比赛结束时，胜利播放成功音效，失败播放错误音效
    const announcerStore = useAnnouncerStore()
    announcerStore.init().then(() => {
      if (data.winner_id === authStore.user?.id) {
        announcerStore.playSuccess()
      } else {
        announcerStore.playFailure()
      }
    })
  }

  function handleSyncMessage(message: ChallengeMessage): void {
    const data = message.data as Challenge
    
    if (!currentChallenge.value || !authStore.user) {
      currentChallenge.value = data
      return
    }
    
    // 智能合并：保留当前用户刚刚更新的状态，避免被旧的同步消息覆盖
    // 检查同步消息的时间戳，如果消息太旧则忽略当前用户的状态更新
    const myCurrentParticipant = currentChallenge.value.participants.find(
      p => p.user_id === authStore.user!.id
    )
    const myIncomingParticipant = data.participants.find(
      p => p.user_id === authStore.user!.id
    )
    
    // 更新 currentChallenge，但保留当前用户的本地状态
    if (myCurrentParticipant && myIncomingParticipant) {
      // 保留当前用户的 is_ready 和 is_online 状态（因为本地状态更准确）
      const preservedIsReady = myCurrentParticipant.is_ready
      const preservedIsOnline = myCurrentParticipant.is_online
      
      currentChallenge.value = data
      
      // 恢复当前用户的状态
      const myParticipantInNew = currentChallenge.value.participants.find(
        p => p.user_id === authStore.user!.id
      )
      if (myParticipantInNew) {
        myParticipantInNew.is_ready = preservedIsReady
        myParticipantInNew.is_online = preservedIsOnline
      }
    } else {
      currentChallenge.value = data
    }
  }

  // 处理玩家中途退出消息
  function handleExitGameMessage(message: ChallengeMessage): void {
    if (!isHost.value || !currentChallenge.value) return

    const data = message.data as { user_id: string }
    handleExitGameAsHost(data.user_id)
  }
  
  // ==================== 心跳和状态同步消息处理 ====================
  
  // 处理心跳消息（主机接收选手心跳）
  function handleHeartbeatMessage(message: ChallengeMessage): void {
    if (!isHost.value || !currentChallenge.value) return
    
    const senderId = message.sender_id
    const now = Date.now()
    const messageTimestamp = message.timestamp || 0
    
    // 检查消息是否过期（超过心跳超时时间的消息视为无效）
    // 这可以防止延迟到达的旧心跳消息错误地恢复在线状态
    const messageAge = now - messageTimestamp
    if (messageAge > HEARTBEAT_CONFIG.HEARTBEAT_TIMEOUT) {
      console.log(`[Heartbeat] 忽略用户 ${senderId.slice(0,8)} 的过期心跳（消息年龄: ${messageAge}ms）`)
      return
    }
    
    // 更新心跳时间
    lastHeartbeatMap.set(senderId, now)
    
    // 如果选手之前被标记为离线，现在收到心跳说明恢复了
    const participant = currentChallenge.value.participants.find(p => p.user_id === senderId)
    if (participant && !participant.is_online) {
      console.log(`[Heartbeat] 收到用户 ${senderId.slice(0,8)} 新心跳，状态变更: 离线 -> 在线`)
      participant.is_online = true
      participant.offline_since = undefined
      participant.exit_countdown = undefined
      offlineStartTimeMap.delete(senderId)
      // 从心跳确认离线集合中移除
      heartbeatConfirmedOffline.delete(senderId)
      
      // 广播上线通知
      broadcast({
        type: 'player_online',
        data: { user_id: senderId },
        sender_id: authStore.user!.id,
        timestamp: now
      })
      
      // 广播状态更新
      broadcastStatusUpdate()
    }
  }
  
  // 处理主机状态广播（选手接收）
  // 注意：比赛进行中，分数只能由 round_end 消息更新，status_broadcast 不更新分数
  function handleStatusBroadcastMessage(message: ChallengeMessage): void {
    if (isHost.value || !currentChallenge.value) return
    
    // 记录收到主机广播的时间
    lastHostBroadcastTime = Date.now()
    // 重置主机离线检测计数
    hostOfflineCheckCount = 0
    
    // 收到主机广播，说明主机在线，重置离线确认标志
    hostConfirmedOffline = false
    
    // 主机在线，更新主机状态并清除离线记录
    const creatorId = currentChallenge.value.creator_id
    const hostParticipant = currentChallenge.value.participants.find(
      p => p.user_id === creatorId
    )
    if (hostParticipant) {
      if (!hostParticipant.is_online) {
        console.log(`[StatusBroadcast] 房主 ${creatorId.slice(0,8)} 恢复在线`)
      }
      hostParticipant.is_online = true
      hostParticipant.is_ready = true  // 房主在线时自动设为已准备
      hostParticipant.offline_since = undefined
      hostParticipant.exit_countdown = undefined
      // 清除房主的离线记录
      offlineStartTimeMap.delete(creatorId)
      heartbeatConfirmedOffline.delete(creatorId)
    }
    
    const data = message.data as {
      participants: Array<{
        user_id: string
        is_online: boolean
        is_ready: boolean
        score: number
        offline_duration?: number  // 离线持续时间（毫秒）
        offline_since?: number     // 离线开始时间戳
        exit_countdown?: number    // 退赛倒计时剩余秒数（由房主计算）
      }>
      game_status: string
      current_round: number
    }
    
    // 更新参与者状态（保留自己的本地状态）
    // 【重要】比赛进行中，分数只能由 round_end 消息更新，status_broadcast 不更新分数
    // 这样可以避免延迟的 status_broadcast 覆盖最新分数导致分数跳变
    const myUserId = authStore.user?.id
    const now = Date.now()
    const isGameInProgress = gameStatus.value === 'playing' || gameStatus.value === 'round_result'
    
    data.participants.forEach(p => {
      if (p.user_id === myUserId) return  // 不覆盖自己的状态
      
      const participant = currentChallenge.value?.participants.find(lp => lp.user_id === p.user_id)
      if (participant) {
        const wasOnline = participant.is_online
        if (wasOnline !== p.is_online) {
          console.log(`[StatusBroadcast] 用户 ${p.user_id.slice(0,8)} 状态变更: ${wasOnline ? '在线' : '离线'} -> ${p.is_online ? '在线' : '离线'}`)
        }
        participant.is_online = p.is_online
        participant.is_ready = p.is_ready
        // 【重要】比赛进行中不从 status_broadcast 更新分数
        // 分数只能由房主的 round_end 消息更新，避免分数跳变
        if (!isGameInProgress) {
          participant.score = p.score
        }
        
        // 更新离线时间戳和退赛倒计时
        if (!p.is_online) {
          if (p.offline_since) {
            participant.offline_since = p.offline_since
            // 同步到本地 offlineStartTimeMap，以便 checkLocalCountdowns 能正常工作
            if (!offlineStartTimeMap.has(p.user_id)) {
              offlineStartTimeMap.set(p.user_id, p.offline_since)
            }
          } else if (!offlineStartTimeMap.has(p.user_id)) {
            // 如果房主没有发送 offline_since，使用当前时间
            offlineStartTimeMap.set(p.user_id, now)
            participant.offline_since = now
          }
          // 使用房主广播的退赛倒计时（确保所有客户端显示一致）
          participant.exit_countdown = p.exit_countdown
        } else {
          participant.offline_since = undefined
          participant.exit_countdown = undefined
          // 清除本地离线记录
          offlineStartTimeMap.delete(p.user_id)
        }
        
        // 如果从在线变为离线，自动设置为未准备
        if (wasOnline && !p.is_online) {
          participant.is_ready = false
        }
      }
    })
  }
  
  // 处理选手离线通知（所有人接收）
  // 注意：这个消息由主机广播，主机已确认该用户离线
  function handlePlayerOfflineMessage(message: ChallengeMessage): void {
    if (!currentChallenge.value) return
    
    const data = message.data as { user_id: string }
    console.log(`[PlayerOffline] 收到用户 ${data.user_id.slice(0,8)} 离线通知`)
    const participant = currentChallenge.value.participants.find(p => p.user_id === data.user_id)
    if (participant) {
      participant.is_online = false
      participant.is_ready = false  // 离线时自动取消准备状态
      // 如果还没有设置离线时间，设置当前时间
      if (!participant.offline_since) {
        participant.offline_since = Date.now()
      }
      // 同步到本地离线记录，防止 Presence 事件覆盖
      if (!offlineStartTimeMap.has(data.user_id)) {
        offlineStartTimeMap.set(data.user_id, participant.offline_since)
      }
      heartbeatConfirmedOffline.add(data.user_id)
    }
  }
  
  // 处理选手上线通知（所有人接收）
  // 注意：这个消息由主机广播，只有主机确认收到心跳后才会发送
  // 所以这里可以信任并清除离线状态
  function handlePlayerOnlineMessage(message: ChallengeMessage): void {
    if (!currentChallenge.value) return
    
    const data = message.data as { user_id: string }
    const userId = data.user_id
    console.log(`[PlayerOnline] 收到用户 ${userId.slice(0,8)} 上线通知`)
    
    const participant = currentChallenge.value.participants.find(p => p.user_id === userId)
    if (participant) {
      participant.is_online = true
      participant.offline_since = undefined  // 清除离线时间
      participant.exit_countdown = undefined // 清除退赛倒计时
      // 清除离线记录
      offlineStartTimeMap.delete(userId)
      heartbeatConfirmedOffline.delete(userId)
      
      // 如果是房主上线，清除房主离线确认标志
      if (userId === currentChallenge.value.creator_id) {
        hostConfirmedOffline = false
        console.log(`[PlayerOnline] 房主上线，重置 hostConfirmedOffline`)
      }
    }
  }
  
  // 处理请求游戏状态消息（房主接收）
  function handleRequestGameStateMessage(message: ChallengeMessage): void {
    if (!isHost.value || !currentChallenge.value) return
    
    const requesterId = message.sender_id
    console.log(`[GameState] 收到用户 ${requesterId.slice(0,8)} 的游戏状态请求，当前轮次: ${currentRound.value}, 状态: ${gameStatus.value}`)
    
    // 如果房主自己的游戏状态还没恢复（刚重连），从数据库读取
    if (currentRound.value === 0 && currentChallenge.value.status === 'in_progress') {
      console.log(`[GameState] 房主游戏状态未恢复，暂不响应请求`)
      return
    }
    
    // 发送当前游戏状态给请求者
    broadcast({
      type: 'game_state',
      data: {
        game_words: gameWords.value,
        current_round: currentRound.value,
        current_word: currentWord.value,
        round_time_remaining: roundTimeRemaining.value,
        round_start_time: roundStartTime.value,
        game_status: gameStatus.value,
        challenge: currentChallenge.value
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })
  }
  
  // 处理游戏状态消息（非房主接收）
  function handleGameStateMessage(message: ChallengeMessage): void {
    if (isHost.value) return  // 房主不需要接收
    
    const data = message.data as {
      game_words: ChallengeWord[]
      current_round: number
      current_word: Word | null
      round_time_remaining: number
      round_start_time: number
      game_status: string
      challenge: Challenge
    }
    
    console.log(`[GameState] 收到游戏状态: 第 ${data.current_round} 轮, 状态 ${data.game_status}`)
    
    // 如果收到的状态不是有效的比赛状态，忽略
    if (data.game_status !== 'playing' && data.game_status !== 'round_result') {
      console.log(`[GameState] 忽略无效的游戏状态: ${data.game_status}`)
      return
    }
    
    // 如果没有有效的轮次信息，忽略
    if (!data.current_round || data.current_round <= 0) {
      console.log(`[GameState] 忽略无效的轮次: ${data.current_round}`)
      return
    }
    
    // 恢复游戏状态
    gameWords.value = data.game_words || []
    currentRound.value = data.current_round
    currentWord.value = data.current_word
    gameStatus.value = data.game_status as 'playing' | 'round_result'
    
    // 恢复时间状态
    if (data.round_start_time && data.round_time_remaining > 0) {
      const elapsed = Date.now() - data.round_start_time
      const remaining = Math.max(0, data.round_time_remaining * 1000 - elapsed)
      roundTimeRemaining.value = Math.ceil(remaining / 1000)
      roundStartTime.value = Date.now() - elapsed
      
      // 启动本地倒计时
      startRoundTimer()
    }
    
    // 更新挑战赛信息
    if (data.challenge) {
      // 保留当前用户的状态
      const myUserId = authStore.user?.id
      const myCurrentParticipant = currentChallenge.value?.participants.find(
        p => p.user_id === myUserId
      )
      
      currentChallenge.value = data.challenge
      
      // 恢复当前用户的在线状态
      if (myCurrentParticipant && myUserId) {
        const myParticipant = currentChallenge.value.participants.find(
          p => p.user_id === myUserId
        )
        if (myParticipant) {
          myParticipant.is_online = true
        }
      }
    }
  }
  
  // 请求游戏状态（重新加入比赛时调用）
  function requestGameState(): void {
    if (!currentChallenge.value || !authStore.user) return
    
    console.log('[GameState] 请求游戏状态...')
    broadcast({
      type: 'request_game_state',
      data: { user_id: authStore.user.id },
      sender_id: authStore.user.id,
      timestamp: Date.now()
    })
  }
  
  // ==================== 心跳发送和状态广播 ====================
  
  // 启动选手心跳（非主机调用）
  function startPlayerHeartbeat(): void {
    stopPlayerHeartbeat()
    
    if (isHost.value || !currentChannelName.value || !authStore.user) return
    
    // 初始化最后收到主机广播的时间
    lastHostBroadcastTime = Date.now()
    
    // 立即发送一次心跳
    sendHeartbeat()
    
    // 定期发送心跳
    playerHeartbeatTimer = setInterval(() => {
      sendHeartbeat()
    }, HEARTBEAT_CONFIG.PLAYER_HEARTBEAT_INTERVAL)
    
    // 启动主机离线检测
    startHostOfflineCheck()
  }
  
  // 停止选手心跳
  function stopPlayerHeartbeat(): void {
    if (playerHeartbeatTimer) {
      clearInterval(playerHeartbeatTimer)
      playerHeartbeatTimer = null
    }
    stopHostOfflineCheck()
  }
  
  // 发送心跳
  function sendHeartbeat(): void {
    if (!currentChannelName.value || !authStore.user) return
    
    broadcast({
      type: 'heartbeat',
      data: {
        user_id: authStore.user.id,
        timestamp: Date.now()
      },
      sender_id: authStore.user.id,
      timestamp: Date.now()
    })
  }
  
  // 启动主机状态广播
  function startHostBroadcast(): void {
    stopHostBroadcast()
    
    if (!isHost.value || !currentChannelName.value) return
    
    // 初始化所有选手的心跳时间
    const now = Date.now()
    currentChallenge.value?.participants.forEach(p => {
      lastHeartbeatMap.set(p.user_id, now)
    })
    
    // 使用动态广播间隔
    scheduleNextBroadcast()
  }
  
  // 调度下一次广播（动态间隔）
  function scheduleNextBroadcast(): void {
    if (!isHost.value || !currentChannelName.value) return
    
    // 检查是否有离线选手需要倒计时
    const hasOfflinePlayer = gameStatus.value === 'playing' && 
      currentChallenge.value?.participants.some(p => 
        p.user_id !== authStore.user?.id && !p.is_online && !p.has_left
      )
    
    // 有离线选手时使用快速广播间隔
    const interval = hasOfflinePlayer 
      ? HEARTBEAT_CONFIG.HOST_BROADCAST_INTERVAL_FAST 
      : HEARTBEAT_CONFIG.HOST_BROADCAST_INTERVAL
    
    hostBroadcastTimer = setTimeout(() => {
      checkHeartbeatsAndBroadcast()
      // 递归调度下一次
      scheduleNextBroadcast()
    }, interval)
  }
  
  // 停止主机状态广播
  function stopHostBroadcast(): void {
    if (hostBroadcastTimer) {
      clearTimeout(hostBroadcastTimer)
      hostBroadcastTimer = null
    }
  }
  
  // ==================== 非主机检测主机离线 ====================
  
  // 启动主机离线检测（非主机调用）
  function startHostOfflineCheck(): void {
    stopHostOfflineCheck()
    
    if (isHost.value) return
    
    // 定期检查是否收到主机广播
    hostOfflineCheckTimer = setInterval(() => {
      checkHostOnline()
    }, HEARTBEAT_CONFIG.HOST_BROADCAST_INTERVAL)
  }
  
  // 停止主机离线检测
  function stopHostOfflineCheck(): void {
    if (hostOfflineCheckTimer) {
      clearInterval(hostOfflineCheckTimer)
      hostOfflineCheckTimer = null
    }
    // 重置主机离线确认标志和计数器
    hostConfirmedOffline = false
    hostOfflineCheckCount = 0
  }
  
  // ==================== 本地倒计时检查（所有客户端都运行） ====================
  
  // 启动本地倒计时检查
  function startLocalCountdownCheck(): void {
    stopLocalCountdownCheck()
    
    localCountdownTimer = setInterval(() => {
      checkLocalCountdowns()
    }, HEARTBEAT_CONFIG.LOCAL_COUNTDOWN_CHECK_INTERVAL)
  }
  
  // 停止本地倒计时检查
  function stopLocalCountdownCheck(): void {
    if (localCountdownTimer) {
      clearInterval(localCountdownTimer)
      localCountdownTimer = null
    }
  }
  
  // 检查本地倒计时（所有客户端都运行）
  // 当任何选手离线倒计时到0时，本客户端可以结束比赛
  // 【重要】只有房主才能触发退赛，非房主只更新本地倒计时显示
  function checkLocalCountdowns(): void {
    if (!currentChallenge.value || gameStatus.value !== 'playing' || gameEndedByMe) return
    
    const now = Date.now()
    const myUserId = authStore.user?.id
    
    // 检查所有参与者的离线状态
    for (const p of currentChallenge.value.participants) {
      if (p.has_left) continue
      
      // 检查是否离线
      const isOffline = !p.is_online
      if (!isOffline) {
        // 在线，清除离线记录
        if (offlineStartTimeMap.has(p.user_id)) {
          offlineStartTimeMap.delete(p.user_id)
          p.exit_countdown = undefined
          p.offline_since = undefined
        }
        continue
      }
      
      // 离线状态，计算倒计时
      let offlineStartTime = offlineStartTimeMap.get(p.user_id)
      if (!offlineStartTime) {
        // 首次检测到离线，记录开始时间
        offlineStartTime = p.offline_since || now
        offlineStartTimeMap.set(p.user_id, offlineStartTime)
        p.offline_since = offlineStartTime
      }
      
      const offlineDuration = now - offlineStartTime
      const remaining = HEARTBEAT_CONFIG.OFFLINE_PROTECTION_TIME - offlineDuration
      const countdown = Math.max(0, Math.ceil(remaining / 1000))
      
      // 更新本地倒计时显示
      p.exit_countdown = countdown
      
      // 【重要】只有房主才能触发退赛逻辑
      // 非房主只更新本地倒计时显示，等待房主广播退赛消息
      // 这样可以避免多个客户端同时触发退赛导致的状态不一致
      if (isHost.value && remaining <= 0 && !p.has_left) {
        console.log(`[Challenge] Player ${p.user_id.slice(0,8)} countdown reached 0, host triggering exit`)
        p.has_left = true
        
        // 房主触发退赛处理
        handleExitGameAsHost(p.user_id)
        return  // 只处理一个离线超时
      }
    }
    
    // 特殊情况：房主离线超时，非房主需要结束比赛
    // 只有当房主确认离线且倒计时到0时才触发
    if (!isHost.value && hostConfirmedOffline) {
      const creatorId = currentChallenge.value.creator_id
      const hostOfflineStart = offlineStartTimeMap.get(creatorId)
      if (hostOfflineStart) {
        const hostOfflineDuration = now - hostOfflineStart
        const hostRemaining = HEARTBEAT_CONFIG.OFFLINE_PROTECTION_TIME - hostOfflineDuration
        
        if (hostRemaining <= 0) {
          const hostParticipant = currentChallenge.value.participants.find(
            p => p.user_id === creatorId
          )
          if (hostParticipant && !hostParticipant.has_left) {
            console.log(`[Challenge] Host offline timeout, non-host ending game`)
            hostParticipant.has_left = true
            handleGameEndDueToOffline(creatorId)
          }
        }
      }
    }
  }
  
  // 因离线超时结束比赛（任何客户端都可以调用）
  async function handleGameEndDueToOffline(offlineUserId: string): Promise<void> {
    if (!currentChallenge.value || gameEndedByMe) return
    
    gameEndedByMe = true  // 防止重复调用
    
    const challengeId = currentChallenge.value.id
    const myUserId = authStore.user?.id
    const creatorId = currentChallenge.value.creator_id
    
    console.log(`[Challenge] Handling game end due to offline: ${offlineUserId}, I am ${isHost.value ? 'host' : 'player'}`)
    
    // 标记离线用户为已退出
    const offlineParticipant = currentChallenge.value.participants.find(p => p.user_id === offlineUserId)
    if (offlineParticipant) {
      offlineParticipant.has_left = true
      offlineParticipant.is_online = false
    }
    
    // 找出剩余在线玩家
    const onlinePlayers = currentChallenge.value.participants.filter(p => !p.has_left && p.is_online)
    
    // 确定赢家
    let winnerId: string | null = null
    let winnerName: string | null = null
    
    if (onlinePlayers.length >= 1) {
      // 有在线玩家，按分数排序选出赢家
      const sortedPlayers = [...onlinePlayers].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        // 分数相同时，创建者优先
        if (a.user_id === creatorId) return -1
        if (b.user_id === creatorId) return 1
        return 0
      })
      winnerId = sortedPlayers[0].user_id
      winnerName = sortedPlayers[0].nickname
    }
    
    // 准备写入数据
    const totalPrize = currentChallenge.value.entry_fee * currentChallenge.value.participants.length
    const finishedAt = new Date().toISOString()
    const finalScores = currentChallenge.value.participants.map(p => ({
      user_id: p.user_id,
      score: p.score
    }))
    
    // 尝试写入数据库（带冲突检测）
    const writeSuccess = await tryWriteGameResult({
      challengeId,
      winnerId,
      winnerName,
      totalPrize,
      finishedAt,
      participants: currentChallenge.value.participants,
      gameWords: gameWords.value,
      writerId: myUserId!,
      isHost: isHost.value,
      offlineUserId
    })
    
    if (writeSuccess) {
      console.log('[Challenge] Game result written successfully')
    } else {
      console.log('[Challenge] Game result already written by another client')
    }
    
    // 更新本地状态
    stopRoundTimer()
    gameStatus.value = 'finished'
    currentChallenge.value.status = 'finished'
    currentChallenge.value.winner_id = winnerId || undefined
    currentChallenge.value.winner_name = winnerName || undefined
    currentChallenge.value.prize_pool = totalPrize
    currentChallenge.value.finished_at = finishedAt
    
    // 广播游戏结束（尽力发送，可能发不出去）
    try {
      broadcast({
        type: 'game_end',
        data: {
          winner_id: winnerId,
          winner_name: winnerName,
          final_scores: finalScores,
          prize_pool: totalPrize,
          game_words: gameWords.value,
          due_to_offline: true,
          offline_user_id: offlineUserId
        },
        sender_id: myUserId!,
        timestamp: Date.now()
      })
    } catch (e) {
      // 忽略广播失败
    }
    
    // 更新缓存列表
    updateChallengeInList(currentChallenge.value)
  }
  
  // 尝试写入比赛结果（带冲突检测）
  async function tryWriteGameResult(params: {
    challengeId: string
    winnerId: string | null
    winnerName: string | null
    totalPrize: number
    finishedAt: string
    participants: ChallengeParticipant[]
    gameWords: ChallengeWord[]
    writerId: string
    isHost: boolean
    offlineUserId: string
  }): Promise<boolean> {
    const { challengeId, winnerId, winnerName, totalPrize, finishedAt, participants, gameWords, writerId, isHost, offlineUserId } = params
    
    try {
      // 先检查数据库中的当前状态
      const { data: currentData, error: fetchError } = await supabase
        .from('challenges')
        .select('status, winner_id, finished_at')
        .eq('id', challengeId)
        .single()
      
      if (fetchError) {
        console.error('[Challenge] Failed to fetch current state:', fetchError)
        // 获取失败，仍然尝试写入
      } else if (currentData) {
        // 检查是否已经结束
        if (currentData.status === 'finished' || currentData.status === 'cancelled') {
          console.log('[Challenge] Game already ended in database')
          // 同步数据库中的结果到本地
          if (currentData.winner_id && currentChallenge.value) {
            currentChallenge.value.winner_id = currentData.winner_id
            currentChallenge.value.status = currentData.status
            currentChallenge.value.finished_at = currentData.finished_at
          }
          return false
        }
      }
      
      // 写入结果
      // 使用条件更新：只有状态还是 in_progress 时才更新
      const { error: updateError } = await supabase
        .from('challenges')
        .update({
          status: 'finished',
          winner_id: winnerId,
          winner_name: winnerName,
          prize_pool: totalPrize,
          finished_at: finishedAt,
          participants: participants,
          game_words: gameWords
        })
        .eq('id', challengeId)
        .eq('status', 'in_progress')  // 条件更新：只有进行中的比赛才更新
      
      if (updateError) {
        console.error('[Challenge] Failed to write game result:', updateError)
        return false
      }
      
      return true
    } catch (e) {
      console.error('[Challenge] Error in tryWriteGameResult:', e)
      return false
    }
  }
  
  // 检查主机是否在线（非主机调用）
  // 增加容错机制：连续多次未收到广播才确认离线，避免网络抖动导致的误判
  function checkHostOnline(): void {
    if (isHost.value || !currentChallenge.value) return
    
    const now = Date.now()
    const timeSinceLastBroadcast = now - lastHostBroadcastTime
    const creatorId = currentChallenge.value.creator_id
    
    // 如果超过心跳超时时间没有收到主机广播
    if (timeSinceLastBroadcast > HEARTBEAT_CONFIG.HEARTBEAT_TIMEOUT) {
      // 增加离线检测计数
      hostOfflineCheckCount++
      
      // 只有连续多次检测都超时才确认离线（容错机制）
      if (hostOfflineCheckCount >= HEARTBEAT_CONFIG.HOST_OFFLINE_CONFIRM_COUNT) {
        const hostParticipant = currentChallenge.value.participants.find(
          p => p.user_id === creatorId
        )
        
        if (hostParticipant && hostParticipant.is_online) {
          console.log(`[HostOfflineCheck] 房主离线确认（连续 ${hostOfflineCheckCount} 次未收到广播）`)
          hostParticipant.is_online = false
          hostParticipant.is_ready = false  // 房主离线时自动取消准备状态
          
          // 记录离线开始时间（用于本地倒计时）
          // 使用第一次检测到超时的时间，而不是当前时间
          const offlineTime = lastHostBroadcastTime + HEARTBEAT_CONFIG.HEARTBEAT_TIMEOUT
          if (!offlineStartTimeMap.has(creatorId)) {
            offlineStartTimeMap.set(creatorId, offlineTime)
          }
          hostParticipant.offline_since = offlineStartTimeMap.get(creatorId)
          
          // 标记主机已确认离线，防止 Presence sync 覆盖
          hostConfirmedOffline = true
        }
      }
    } else {
      // 收到主机广播，重置计数和离线状态
      hostOfflineCheckCount = 0
      
      if (hostConfirmedOffline) {
        // 房主恢复在线
        const hostParticipant = currentChallenge.value.participants.find(
          p => p.user_id === creatorId
        )
        if (hostParticipant) {
          console.log(`[HostOfflineCheck] 房主恢复在线`)
          hostParticipant.is_online = true
          hostParticipant.is_ready = true
          hostParticipant.offline_since = undefined
          hostParticipant.exit_countdown = undefined
          offlineStartTimeMap.delete(creatorId)
          hostConfirmedOffline = false
        }
      }
    }
  }
  
  // 检查心跳并广播状态（主机调用）
  function checkHeartbeatsAndBroadcast(): void {
    if (!isHost.value || !currentChallenge.value) return
    
    const now = Date.now()
    let hasStatusChange = false
    
    currentChallenge.value.participants.forEach(p => {
      // 跳过主机自己
      if (p.user_id === authStore.user?.id) return
      
      const lastHeartbeat = lastHeartbeatMap.get(p.user_id) || 0
      const timeSinceLastHeartbeat = now - lastHeartbeat
      
      if (timeSinceLastHeartbeat > HEARTBEAT_CONFIG.HEARTBEAT_TIMEOUT) {
        // 心跳超时，标记为离线
        if (p.is_online) {
          console.log(`[HeartbeatCheck] 用户 ${p.user_id.slice(0,8)} 心跳超时 (${timeSinceLastHeartbeat}ms)，状态变更: 在线 -> 离线`)
          p.is_online = false
          p.is_ready = false  // 离线时自动取消准备状态
          hasStatusChange = true
          
          // 标记为心跳确认离线，防止 Presence sync 覆盖状态
          heartbeatConfirmedOffline.add(p.user_id)
          
          // 记录离线开始时间
          const offlineTime = now
          if (!offlineStartTimeMap.has(p.user_id)) {
            offlineStartTimeMap.set(p.user_id, offlineTime)
          }
          // 同时更新到 participant 对象，供 UI 显示
          p.offline_since = offlineStartTimeMap.get(p.user_id)
          
          // 广播离线通知
          broadcast({
            type: 'player_offline',
            data: { user_id: p.user_id },
            sender_id: authStore.user!.id,
            timestamp: now
          })
        }
        
        // 检查是否超过保护期（仅在比赛进行中）
        if (gameStatus.value === 'playing' && !p.has_left) {
          const offlineStartTime = offlineStartTimeMap.get(p.user_id) || now
          const offlineDuration = now - offlineStartTime
          
          // 计算退赛倒计时剩余秒数
          const remaining = HEARTBEAT_CONFIG.OFFLINE_PROTECTION_TIME - offlineDuration
          p.exit_countdown = Math.max(0, Math.ceil(remaining / 1000))
          
          // 倒计时到0，立即触发退赛
          if (remaining <= 0) {
            console.log(`[Challenge] Player ${p.user_id} offline for ${offlineDuration}ms, treating as exit`)
            p.has_left = true
            p.exit_countdown = 0
            handleExitGameAsHost(p.user_id)
          }
        }
      }
      // 注意：恢复在线状态只在 handleHeartbeatMessage 中处理（收到新心跳时）
      // 不在这里根据 lastHeartbeatMap 恢复，因为那可能是旧的心跳时间
    })
    
    // 广播完整状态
    broadcastStatusUpdate()
    
    // 如果有状态变化，同步到数据库
    if (hasStatusChange) {
      syncParticipantsToDb()
    }
  }
  
  // 广播状态更新
  function broadcastStatusUpdate(): void {
    if (!isHost.value || !currentChallenge.value || !currentChannelName.value) return
    
    const now = Date.now()
    
    broadcast({
      type: 'status_broadcast',
      data: {
        participants: currentChallenge.value.participants.map(p => {
          // 计算退赛倒计时剩余秒数（仅在比赛进行中且离线时）
          let exitCountdown: number | undefined = undefined
          if (gameStatus.value === 'playing' && !p.is_online && !p.has_left) {
            const offlineStartTime = offlineStartTimeMap.get(p.user_id)
            if (offlineStartTime) {
              const elapsed = now - offlineStartTime
              const remaining = HEARTBEAT_CONFIG.OFFLINE_PROTECTION_TIME - elapsed
              exitCountdown = Math.max(0, Math.ceil(remaining / 1000))
            }
          }
          
          return {
            user_id: p.user_id,
            is_online: p.is_online,
            is_ready: p.is_ready,
            score: p.score,
            offline_duration: p.is_online ? 0 : (now - (offlineStartTimeMap.get(p.user_id) || now)),
            offline_since: p.offline_since,  // 传递离线开始时间戳
            exit_countdown: exitCountdown     // 传递退赛倒计时剩余秒数
          }
        }),
        game_status: gameStatus.value,
        current_round: currentRound.value
      },
      sender_id: authStore.user!.id,
      timestamp: now
    })
  }
  
  // ==================== 页面可见性和网络状态监听 ====================
  
  // 设置页面可见性和网络状态监听
  function setupVisibilityAndNetworkListeners(): void {
    cleanupVisibilityAndNetworkListeners()
    
    // 页面可见性变化处理
    const handleVisibilityChange = async (): Promise<void> => {
      if (!currentChannelName.value || !authStore.user) return
      
      if (document.visibilityState === 'hidden') {
        // 页面隐藏时，通知主机（如果不是主机）
        if (!isHost.value) {
          broadcast({
            type: 'player_offline',
            data: { user_id: authStore.user.id, reason: 'visibility_hidden' },
            sender_id: authStore.user.id,
            timestamp: Date.now()
          })
        }
      } else if (document.visibilityState === 'visible') {
        // 页面恢复可见时，检查连接状态并立即重连
        if (realtimeStatus.value !== 'connected') {
          try {
            await realtimeManager.forceReconnect()
          } catch (e) {
            console.warn('[Challenge] Force reconnect on visibility change failed:', e)
          }
        }
        
        // 立即发送心跳/通知上线
        if (!isHost.value) {
          sendHeartbeat()
          broadcast({
            type: 'player_online',
            data: { user_id: authStore.user.id },
            sender_id: authStore.user.id,
            timestamp: Date.now()
          })
          // 重置主机离线检测时间
          lastHostBroadcastTime = Date.now()
          hostConfirmedOffline = false
        } else {
          // 主机恢复后立即广播状态
          broadcastStatusUpdate()
        }
        
        // 更新自己的在线状态
        const myP = currentChallenge.value?.participants.find(p => p.user_id === authStore.user?.id)
        if (myP) {
          myP.is_online = true
          if (isHost.value) {
            myP.is_ready = true
          }
        }
      }
    }
    
    // 网络状态变化处理
    const handleOnline = async (): Promise<void> => {
      if (!currentChannelName.value || !authStore.user) return
      
      // 网络恢复，立即触发 RealtimeManager 重连
      // 这会比等待 RealtimeManager 自己检测更快
      try {
        await realtimeManager.forceReconnect()
      } catch (e) {
        console.warn('[Challenge] Force reconnect failed:', e)
      }
      
      // 重连后立即发送心跳/通知上线
      if (!isHost.value) {
        sendHeartbeat()
        broadcast({
          type: 'player_online',
          data: { user_id: authStore.user.id },
          sender_id: authStore.user.id,
          timestamp: Date.now()
        })
        // 重置主机离线检测时间，避免误判
        lastHostBroadcastTime = Date.now()
        hostConfirmedOffline = false
      } else {
        // 主机恢复后立即广播状态
        broadcastStatusUpdate()
      }
      
      // 更新自己的在线状态
      const myP = currentChallenge.value?.participants.find(p => p.user_id === authStore.user?.id)
      if (myP) {
        myP.is_online = true
        if (isHost.value) {
          myP.is_ready = true
        }
      }
    }
    
    const handleOffline = (): void => {
      if (!currentChannelName.value || !authStore.user) return
      
      // 网络断开，通知离线（尽力发送，可能发不出去）
      if (!isHost.value) {
        broadcast({
          type: 'player_offline',
          data: { user_id: authStore.user.id, reason: 'network_offline' },
          sender_id: authStore.user.id,
          timestamp: Date.now()
        })
      }
      
      // 更新自己的在线状态
      const myP = currentChallenge.value?.participants.find(p => p.user_id === authStore.user?.id)
      if (myP) {
        myP.is_online = false
      }
    }
    
    // 页面卸载前处理
    const handleBeforeUnload = (): void => {
      if (!currentChannelName.value || !authStore.user) return
      
      // 页面关闭前，发送离线通知
      broadcast({
        type: 'player_offline',
        data: { user_id: authStore.user.id, reason: 'page_unload' },
        sender_id: authStore.user.id,
        timestamp: Date.now()
      })
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    cleanupVisibilityListener = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }
  
  // 清理页面可见性和网络状态监听
  function cleanupVisibilityAndNetworkListeners(): void {
    if (cleanupVisibilityListener) {
      cleanupVisibilityListener()
      cleanupVisibilityListener = null
    }
  }

  // Broadcast sync (host only)
  function broadcastSync(): void {
    if (!isHost.value || !currentChallenge.value) return

    broadcast({
      type: 'sync',
      data: currentChallenge.value,
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })
  }

  // Game control functions
  function startRound(): void {
    if (!isHost.value || !currentChallenge.value) return

    const currentGameWord = gameWords.value[currentRound.value - 1]
    if (!currentGameWord) return

    currentWord.value = currentGameWord.word
    roundTimeRemaining.value = currentChallenge.value.time_limit
    roundStartTime.value = Date.now()
    hasSubmitted.value = false
    myAnswer.value = ''
    roundResults.value = []
    roundEnded.value = false // 重置轮次结束标志
    gameStatus.value = 'playing'

    // 广播当前单词（多次发送确保送达，减少延迟）
    const wordMessage: ChallengeMessage = {
      type: 'word',
      data: {
        word: currentGameWord.word,
        round: currentRound.value,
        time_limit: currentChallenge.value.time_limit,
        round_start_time: roundStartTime.value  // 传递开始时间，让选手同步倒计时
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    }
    
    // 立即发送，然后快速重发两次确保送达
    broadcast(wordMessage)
    setTimeout(() => broadcast(wordMessage), 50)
    setTimeout(() => broadcast(wordMessage), 100)

    // 启动倒计时
    startRoundTimer()
    
    // 保存当前轮次到数据库（用于房主断线重连恢复）
    saveGameStateToDb()
  }
  
  // 保存游戏状态到数据库（用于断线重连恢复）
  async function saveGameStateToDb(): Promise<void> {
    if (!currentChallenge.value) return
    
    try {
      // 更新 game_words 中当前轮次的状态为 active
      const updatedGameWords = gameWords.value.map((gw, index) => ({
        ...gw,
        status: index === currentRound.value - 1 ? 'active' : gw.status
      }))
      
      // 同步更新本地状态
      gameWords.value = updatedGameWords
      
      await supabase
        .from('challenges')
        .update({
          game_words: updatedGameWords
        })
        .eq('id', currentChallenge.value.id)
    } catch (e) {
      console.warn('[Challenge] Failed to save game state to db:', e)
    }
  }

  function startRoundTimer(): void {
    stopRoundTimer()
    
    roundTimer.value = setInterval(() => {
      roundTimeRemaining.value--
      
      if (roundTimeRemaining.value <= 0) {
        if (isHost.value) {
          endRound(null) // 超时，没有赢家
        }
      }
    }, 1000)
  }

  function stopRoundTimer(): void {
    if (roundTimer.value) {
      clearInterval(roundTimer.value)
      roundTimer.value = null
    }
  }

  // 订阅数据库变更（替代轮询机制）
  async function subscribeToDbChanges(): Promise<void> {
    if (!currentChallenge.value) return
    
    // 先清理旧的订阅
    unsubscribeFromDbChanges()
    
    const challengeId = currentChallenge.value.id
    const channelName = `db-changes:${challengeId}`
    
    // 创建数据库变更订阅 channel
    dbChannel.value = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'challenges',
          filter: `id=eq.${challengeId}`
        },
        (payload) => {
          handleDbChange(payload.new as Challenge)
        }
      )
      .subscribe()
  }
  
  // 处理数据库变更
  function handleDbChange(updatedChallenge: Challenge): void {
    if (!currentChallenge.value) return
    
    // 检查比赛状态变化
    if (updatedChallenge.status === 'finished' || updatedChallenge.status === 'cancelled') {
      // 比赛已结束，更新本地状态
      unsubscribeFromDbChanges()
      stopRoundTimer()
      
      gameStatus.value = 'finished'
      currentChallenge.value.status = updatedChallenge.status
      currentChallenge.value.winner_id = updatedChallenge.winner_id
      currentChallenge.value.winner_name = updatedChallenge.winner_name
      currentChallenge.value.prize_pool = updatedChallenge.prize_pool
      currentChallenge.value.finished_at = updatedChallenge.finished_at
      
      if (updatedChallenge.game_words) {
        gameWords.value = updatedChallenge.game_words
        currentChallenge.value.game_words = updatedChallenge.game_words
      }
      
      if (updatedChallenge.participants) {
        currentChallenge.value.participants = updatedChallenge.participants
      }

      // 更新缓存列表
      updateChallengeInList(currentChallenge.value)
      // 不再标记刷新，因为 updateChallengeInList 已经更新了本地缓存
    } else if (updatedChallenge.participants) {
      // 参与者状态变化（在线/离线/准备状态）
      // 只更新其他用户的状态，保留当前用户的本地状态
      const myUserId = authStore.user?.id
      updatedChallenge.participants.forEach(p => {
        if (p.user_id !== myUserId) {
          const localParticipant = currentChallenge.value?.participants.find(
            lp => lp.user_id === p.user_id
          )
          if (localParticipant) {
            // 如果是主机且心跳机制已确认该用户离线，不要从数据库覆盖在线状态
            // 这避免了心跳检测和数据库同步之间的状态冲突
            const isGameInProgress = gameStatus.value === 'playing' || gameStatus.value === 'round_result'
            
            if (isHost.value && heartbeatConfirmedOffline.has(p.user_id)) {
              // 只更新非在线状态相关的字段
              localParticipant.is_ready = p.is_ready
              // 【重要】比赛进行中不从数据库更新分数
              if (!isGameInProgress) {
                localParticipant.score = p.score
              }
              localParticipant.has_left = p.has_left
            } else {
              localParticipant.is_online = p.is_online
              localParticipant.is_ready = p.is_ready
              // 【重要】比赛进行中不从数据库更新分数
              if (!isGameInProgress) {
                localParticipant.score = p.score
              }
              localParticipant.has_left = p.has_left
            }
          }
        }
      })
    }
  }
  
  // 取消数据库变更订阅
  async function unsubscribeFromDbChanges(): Promise<void> {
    if (dbChannel.value) {
      try {
        await dbChannel.value.unsubscribe()
        await supabase.removeChannel(dbChannel.value as any)
      } catch (e) {
        console.error('[Challenge] Error unsubscribing from db changes:', e)
      }
      dbChannel.value = null
    }
  }

  function endRound(winnerId: string | null): void {
    if (!isHost.value || !currentChallenge.value || !currentWord.value) return

    // 防止同一轮多次结束（竞态条件保护）
    if (roundEnded.value) {
      //console.log(`[endRound] 当前轮已结束，忽略重复调用`)
      return
    }
    roundEnded.value = true

    stopRoundTimer()

    // 计算分数
    if (winnerId) {
      const winner = currentChallenge.value.participants.find(p => p.user_id === winnerId)
      if (winner) {
        winner.score += 1
      }
    }

    // 保存本轮结果到 gameWords
    const currentGameWord = gameWords.value[currentRound.value - 1]
    if (currentGameWord) {
      currentGameWord.results = [...roundResults.value]
      currentGameWord.winner_id = winnerId || undefined
      currentGameWord.status = 'finished'
    }
    
    // 保存游戏状态到数据库（用于断线重连恢复）
    saveGameStateToDb()

    const scores = currentChallenge.value.participants.map(p => ({
      user_id: p.user_id,
      score: p.score
    }))

    // 广播轮次结束（多次发送确保送达，减少延迟）
    const roundEndMessage: ChallengeMessage = {
      type: 'round_end',
      data: {
        winner_id: winnerId,
        correct_answer: currentWord.value.word,
        results: roundResults.value,
        scores
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    }
    
    // 立即发送，然后快速重发两次确保送达
    broadcast(roundEndMessage)
    setTimeout(() => broadcast(roundEndMessage), 50)
    setTimeout(() => broadcast(roundEndMessage), 100)

    // 本地也处理
    handleRoundEndMessage({
      type: 'round_end',
      data: {
        winner_id: winnerId,
        correct_answer: currentWord.value.word,
        results: roundResults.value,
        scores
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })
  }

  async function nextRound(): Promise<void> {
    if (!isHost.value || !currentChallenge.value) return

    currentRound.value++

    if (currentRound.value > gameWords.value.length) {
      // 游戏结束 - 等待完成
      await endGame()
    } else {
      startRound()
    }
  }

  async function endGame(): Promise<void> {
    if (!isHost.value || !currentChallenge.value) return

    stopRoundTimer()

    // 找出赢家 - 排除中途退出的用户
    const eligibleParticipants = currentChallenge.value.participants.filter(p => !p.has_left)
    const sortedByScore = [...eligibleParticipants].sort((a, b) => {
      // 先按分数排序
      if (b.score !== a.score) return b.score - a.score
      // 分数相同时，创建者优先
      if (a.user_id === currentChallenge.value!.creator_id) return -1
      if (b.user_id === currentChallenge.value!.creator_id) return 1
      return 0
    })
    const winner = sortedByScore[0]

    // 计算总奖池
    const totalPrize = currentChallenge.value.entry_fee * currentChallenge.value.participants.length

    const finalScores = currentChallenge.value.participants.map(p => ({
      user_id: p.user_id,
      score: p.score
    }))

    const gameEndData = {
      winner_id: winner.user_id,
      winner_name: winner.nickname,
      final_scores: finalScores,
      prize_pool: totalPrize,
      game_words: gameWords.value // 传递比赛单词记录
    }

    // 先广播游戏结束消息（多次发送确保送达）
    const gameEndMessage: ChallengeMessage = {
      type: 'game_end',
      data: gameEndData,
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    }
    
    // 发送3次，间隔100ms，确保消息送达
    broadcast(gameEndMessage)
    setTimeout(() => broadcast(gameEndMessage), 100)
    setTimeout(() => broadcast(gameEndMessage), 200)

    // 保存结果到数据库
    await saveChallengeResult(winner.user_id)

    // 本地也处理
    handleGameEndMessage(gameEndMessage)
  }

  // Submit answer
  function submitAnswer(answer: string): void {
    if (hasSubmitted.value || !currentChallenge.value) return

    hasSubmitted.value = true
    myAnswer.value = answer

    const timeTaken = Date.now() - roundStartTime.value
    const answerRound = currentRound.value // 记录提交时的轮次

    if (isHost.value) {
      // 如果当前轮已经结束，忽略
      if (roundEnded.value) return

      // 主机直接处理
      const result: ChallengeWordResult = {
        user_id: authStore.user!.id,
        answer,
        is_correct: currentWord.value ? answer.toLowerCase() === currentWord.value.word.toLowerCase() : false,
        time_taken: timeTaken,
        submitted_at: new Date().toISOString()
      }

      roundResults.value.push(result)

      // 计算有效参与者数量（在线且未退赛的）
      const activeParticipants = currentChallenge.value.participants.filter(
        p => p.is_online && !p.has_left
      ).length

      if (result.is_correct) {
        endRound(authStore.user!.id)
      } else if (roundResults.value.length >= activeParticipants) {
        // 所有在线参与者都提交了（都是错的）- 立即结束本轮
        endRound(null)
      }
    } else {
      // 非主机：通过 Supabase Realtime 广播答案，带上轮次信息
      broadcast({
        type: 'answer',
        data: {
          answer,
          time_taken: timeTaken,
          round: answerRound // 带上轮次，让主机验证
        },
        sender_id: authStore.user!.id,
        timestamp: Date.now()
      })
    }
  }

  // Toggle ready status
  function toggleReady(): void {
    if (!currentChallenge.value || !myParticipant.value) {
      return
    }

    const newStatus = !myParticipant.value.is_ready
    
    // 立即更新本地状态
    myParticipant.value.is_ready = newStatus

    // 使用 Supabase Realtime 广播准备状态
    broadcast({
      type: 'ready',
      data: { is_ready: newStatus },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })

    // 同时更新 Presence 状态
    updatePresence({ is_ready: newStatus })

    if (isHost.value) {
      // 主机检查是否所有人都准备好了
      if (allReady.value && currentChallenge.value.participants.length >= 2) {
        currentChallenge.value.status = 'ready'
      }
      broadcastSync()
      // 同步到数据库
      syncParticipantsToDb()
    }
  }

  // 同步参与者状态到数据库
  async function syncParticipantsToDb(): Promise<void> {
    if (!currentChallenge.value) return
    
    try {
      await supabase
        .from('challenges')
        .update({
          participants: currentChallenge.value.participants,
          status: currentChallenge.value.status
        })
        .eq('id', currentChallenge.value.id)
    } catch (error) {
      console.error('Error syncing participants:', error)
    }
  }

  // Start game (host only)
  async function startGame(): Promise<void> {
    if (!isHost.value || !currentChallenge.value || !canStart.value) return

    await wordsStore.init()

    // 获取出题模式
    const wordMode = currentChallenge.value.word_mode || 'simulate'
    
    // 准备学习记录、比赛记录和挑战赛记录（用于 new 和 wrong 模式）
    let learningRecords: { word: string; is_correct: boolean }[] = []
    let competitionRecords: { incorrect_words: string[] }[] = []
    let challengeRecordsData: { word: string; is_correct: boolean }[] = []
    
    if (wordMode === 'new' || wordMode === 'wrong') {
      // 获取学习记录
      const learningStore = useLearningStore()
      learningRecords = learningStore.learningRecords.map(r => ({
        word: r.word,
        is_correct: r.is_correct
      }))
      
      // 获取比赛记录
      const competitionStore = useCompetitionStore()
      competitionRecords = competitionStore.records.map(r => ({
        incorrect_words: r.incorrect_words || []
      }))
      
      // 获取挑战赛记录（从当前用户参与的历史挑战赛中提取）
      const userId = authStore.user?.id
      if (userId) {
        // 从本地缓存的挑战赛中提取错误记录
        challenges.value.forEach(c => {
          if (c.status === 'finished' && c.game_words) {
            c.game_words.forEach((gw: ChallengeWord) => {
              const myResult = gw.results?.find(r => r.user_id === userId)
              if (myResult) {
                challengeRecordsData.push({
                  word: gw.word.word,
                  is_correct: myResult.is_correct
                })
              }
            })
          }
        })
      }
    }

    // 生成比赛单词（根据出题模式）
    const words = wordsStore.getWordsForChallenge(
      currentChallenge.value.word_count,
      currentChallenge.value.difficulty,
      wordMode,
      learningRecords,
      competitionRecords,
      challengeRecordsData
    )

    if (words.length === 0) {
      throw new Error('没有足够的单词')
    }

    // 初始化游戏
    gameWords.value = words.map((word, index) => ({
      word,
      round: index + 1,
      status: index === 0 ? 'active' : 'pending',
      results: []
    }))

    currentRound.value = 1
    currentChallenge.value.status = 'in_progress'
    currentChallenge.value.started_at = new Date().toISOString()

    // 广播开始
    broadcast({
      type: 'start',
      data: { words },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })

    // 更新数据库 - 保存 game_words 以便房主断线重连时恢复
    await supabase
      .from('challenges')
      .update({
        status: 'in_progress',
        started_at: currentChallenge.value.started_at,
        game_words: gameWords.value
      })
      .eq('id', currentChallenge.value.id)

    // 开始第一轮
    startRound()
  }

  // CRUD operations
  async function loadChallenges(force = false): Promise<void> {
    // 如果没有数据，先尝试从 localStorage 加载缓存（立即显示）
    if (challenges.value.length === 0) {
      const hasCache = loadFromCache()
      if (hasCache) {
        // 有缓存数据，不显示 loading，后台静默更新
        // 检查缓存是否在有效期内
        if (!force && Date.now() - lastLoadTime.value < CACHE_DURATION) {
          return // 缓存有效，直接返回
        }
        // 缓存过期，后台静默更新（不设置 loading）
        fetchInBackground()
        return
      }
    }
    
    // 如果不是强制刷新，且内存缓存有效，直接返回
    if (!force && challenges.value.length > 0 && Date.now() - lastLoadTime.value < CACHE_DURATION) {
      return
    }
    
    // 如果有数据但需要刷新，后台静默更新
    if (challenges.value.length > 0 && !force) {
      fetchInBackground()
      return
    }
    
    // 防止并发请求，但添加超时保护
    if (loading.value) {
      if (!force) {
        return
      }
      // 强制刷新时，直接重置 loading 状态
      loading.value = false
    }
    
    // 没有缓存数据，需要显示 loading
    loading.value = true
    
    try {
      // 强制刷新时，直接使用 fetch API 绕过缓存获取最新数据
      if (force) {
        await fetchFreshChallenges()
      } else {
        // 非强制刷新，使用 supabase 客户端（可能有缓存）
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        })
        
        const queryPromise = supabase
          .from('challenges')
          .select('*')
          .in('status', ['waiting', 'ready', 'in_progress', 'finished'])
          .order('created_at', { ascending: false })
          .limit(50)
        
        const { data, error } = await Promise.race([queryPromise, timeoutPromise])

        if (error) throw error
        
        challenges.value = (data || []).map(c => ({
          ...c,
          participants: c.participants || []
        }))
        lastLoadTime.value = Date.now()
        saveToCache() // 保存到 localStorage
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
      // 如果 supabase 客户端失败，尝试用 fetch 直接请求
      if (!force) {
        try {
          await fetchFreshChallenges()
        } catch (e) {
          console.error('Fallback fetch also failed:', e)
        }
      }
    } finally {
      loading.value = false
    }
  }
  
  // 后台静默获取数据（不显示 loading）
  async function fetchInBackground(): Promise<void> {
    try {
      const supabaseUrl = 'https://ctsxrhgjvkeyokaejwqb.supabase.co'
      const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3hyaGdqdmtleW9rYWVqd3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MjU2MTUsImV4cCI6MjA4MDUwMTYxNX0.L2Xt2kkBw-2LRfHEF-uZQhYU8b5gDnZZNjpBEpZMkSc'
      
      const url = `${supabaseUrl}/rest/v1/challenges?select=*&status=in.(waiting,ready,in_progress,finished)&order=created_at.desc&limit=50`
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        const data = await response.json()
        challenges.value = (data || []).map((c: Challenge) => ({
          ...c,
          participants: c.participants || []
        }))
        lastLoadTime.value = Date.now()
        saveToCache()
      }
    } catch (e) {
      // 后台更新失败，静默忽略
      console.error('[Challenge] Background fetch failed:', e)
    }
  }
  
  // 绕过缓存获取最新数据（使用 fetch API 直接请求）
  async function fetchFreshChallenges(): Promise<void> {
    // 使用 fetch API 直接请求，添加 Cache-Control 头绕过 SW 缓存
    const supabaseUrl = 'https://ctsxrhgjvkeyokaejwqb.supabase.co'
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3hyaGdqdmtleW9rYWVqd3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MjU2MTUsImV4cCI6MjA4MDUwMTYxNX0.L2Xt2kkBw-2LRfHEF-uZQhYU8b5gDnZZNjpBEpZMkSc'
    
    const url = `${supabaseUrl}/rest/v1/challenges?select=*&status=in.(waiting,ready,in_progress,finished)&order=created_at.desc&limit=50`
    
    // 创建 AbortController 用于超时控制
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000) // 8秒超时
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        cache: 'no-store', // 强制绕过缓存
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      
      // 更新数据
      challenges.value = (data || []).map((c: Challenge) => ({
        ...c,
        participants: c.participants || []
      }))
      lastLoadTime.value = Date.now()
      saveToCache() // 保存到 localStorage
    } catch (error: any) {
      clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        console.error('[fetchFreshChallenges] 请求超时')
      } else {
        console.error('[fetchFreshChallenges] 获取最新数据失败:', error)
      }
      throw error
    }
  }

  async function createChallenge(data: {
    name: string
    description?: string
    image_url?: string
    max_participants: number
    entry_fee: number
    word_count: number
    time_limit: number
    difficulty: number | null
    word_mode?: string
    challenge_number?: number
    show_chinese?: boolean
    show_english?: boolean
    assisted_input?: boolean
  }): Promise<Challenge> {
    if (!authStore.user) {
      throw new Error('请先登录')
    }

    // 设置连接信息（不再需要 PeerJS）
    connectionId.value = authStore.user.id
    peerId.value = authStore.user.id

    const challenge: Omit<Challenge, 'id' | 'created_at'> = {
      ...data,
      show_chinese: data.show_chinese ?? true,
      show_english: data.show_english ?? true,
      assisted_input: data.assisted_input ?? true,
      creator_id: authStore.user.id,
      creator_name: authStore.profile?.nickname || authStore.user.email?.split('@')[0],
      creator_avatar: authStore.profile?.avatar_url,
      status: 'waiting',
      participants: [{
        user_id: authStore.user.id,
        nickname: authStore.profile?.nickname || authStore.user.email?.split('@')[0] || '',
        avatar_url: authStore.profile?.avatar_url,
        is_online: true,
        is_ready: true,
        score: 0,
        peer_id: peerId.value,
        joined_at: new Date().toISOString()
      }],
      prize_pool: data.entry_fee * data.max_participants
    }

    const { data: created, error } = await supabase
      .from('challenges')
      .insert({
        ...challenge,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    const newChallenge = {
      ...created,
      participants: challenge.participants
    } as Challenge

    challenges.value.unshift(newChallenge)
    currentChallenge.value = newChallenge
    isHost.value = true
    gameStatus.value = 'waiting'

    // 创建挑战赛后初始化 Realtime Channel
    await initRealtimeChannel(newChallenge.id)
    
    // 启动心跳机制
    startHeartbeatMechanism()
    
    // 确保房主的准备状态正确同步到 Presence
    updatePresence({ is_ready: true })
    
    return newChallenge
  }

  async function joinChallenge(challengeId: string): Promise<void> {
    if (!authStore.user) throw new Error('请先登录')

    // 使用 supabase 客户端获取挑战赛信息
    const { data: challenge, error } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single()

    if (error) {
      throw error
    }
    if (!challenge) throw new Error('挑战赛不存在')

    // 检查比赛状态，已结束或已取消的比赛不能加入，只能查看
    if (challenge.status === 'finished' || challenge.status === 'cancelled') {
      viewFinishedChallenge(challenge as Challenge)
      return
    }

    let participants = challenge.participants || []

    // 初始化 Supabase Realtime Channel（带超时保护）
    try {
      await Promise.race([
        initRealtimeChannel(challengeId),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('连接超时，请重试')), 15000)
        })
      ])
    } catch (e) {
      // 如果连接失败，清理状态
      realtimeStatus.value = 'disconnected'
      throw e
    }

    // 检查是否是房主
    if (challenge.creator_id === authStore.user.id) {
      // 房主重新进入房间，自动设置为在线和已准备
      const creatorIndex = participants.findIndex((p: ChallengeParticipant) => p.user_id === authStore.user!.id)
      if (creatorIndex >= 0) {
        participants[creatorIndex].is_online = true
        participants[creatorIndex].is_ready = true // 房主自动准备
      }

      // 更新数据库（非阻塞，不等待结果）
      supabase
        .from('challenges')
        .update({ participants })
        .eq('id', challengeId)
        .then(({ error }) => {
          if (error) console.warn('[Challenge] joinChallenge: Failed to update participants:', error)
        })

      currentChallenge.value = {
        ...challenge,
        participants
      } as Challenge

      isHost.value = true
      
      // 启动心跳机制
      startHeartbeatMechanism()
      
      // 更新 Presence 状态（房主自动准备）
      updatePresence({ is_ready: true })
      
      // 根据比赛状态设置游戏状态
      console.log(`[JoinChallenge] 房主进入房间，比赛状态: ${challenge.status}, game_words: ${challenge.game_words?.length || 0} 个`)
      if (challenge.status === 'in_progress') {
        // 比赛正在进行中，但房主刷新了页面
        // 从数据库恢复游戏状态
        gameStatus.value = 'playing'
        
        // 恢复游戏状态
        if (challenge.game_words && challenge.game_words.length > 0) {
          gameWords.value = challenge.game_words
          console.log(`[JoinChallenge] 房主恢复游戏单词: ${gameWords.value.length} 个`)
          
          // 恢复当前轮次 - 从 game_words 的 status 推断
          // 找到第一个 status 是 'active' 或 'pending' 的轮次
          const activeIndex = gameWords.value.findIndex(gw => gw.status === 'active')
          if (activeIndex >= 0) {
            currentRound.value = activeIndex + 1
            currentWord.value = gameWords.value[activeIndex].word
            console.log(`[JoinChallenge] 房主从 active 状态恢复轮次: ${currentRound.value}`)
          } else {
            // 没有 active 状态，找第一个非 finished 的
            const pendingIndex = gameWords.value.findIndex(gw => gw.status !== 'finished')
            if (pendingIndex >= 0) {
              currentRound.value = pendingIndex + 1
              currentWord.value = gameWords.value[pendingIndex].word
              console.log(`[JoinChallenge] 房主从 pending 状态恢复轮次: ${currentRound.value}`)
            } else {
              // 所有轮次都已完成
              currentRound.value = gameWords.value.length
              currentWord.value = gameWords.value[currentRound.value - 1].word
              console.log(`[JoinChallenge] 所有轮次已完成，设置为最后一轮: ${currentRound.value}`)
            }
          }
        } else {
          console.warn(`[JoinChallenge] 房主重连但没有 game_words 数据，无法恢复游戏状态`)
          // 没有 game_words，无法继续比赛，结束比赛
          gameStatus.value = 'finished'
          currentChallenge.value.status = 'finished'
          return
        }
        
        // 订阅数据库变更（替代轮询）
        subscribeToDbChanges()
        
        // 房主恢复后，广播自己上线并发送游戏状态
        setTimeout(() => {
          // 广播房主上线通知
          broadcast({
            type: 'player_online',
            data: { user_id: authStore.user!.id },
            sender_id: authStore.user!.id,
            timestamp: Date.now()
          })
          
          if (currentRound.value > 0 && currentWord.value) {
            // 广播当前单词，让其他选手同步
            broadcast({
              type: 'word',
              data: {
                word: currentWord.value,
                round: currentRound.value,
                time_limit: currentChallenge.value?.time_limit || 30
              },
              sender_id: authStore.user!.id,
              timestamp: Date.now()
            })
            // 重新开始倒计时
            roundTimeRemaining.value = currentChallenge.value?.time_limit || 30
            roundStartTime.value = Date.now()
            startRoundTimer()
          }
          broadcastSync()
        }, 500)
      } else {
        gameStatus.value = 'waiting'
        // 房主进入后广播同步消息，让其他用户同步状态
        setTimeout(() => broadcastSync(), 500)
      }
      return
    }

    // 检查是否已经加入
    const existingParticipant = participants.find((p: ChallengeParticipant) => p.user_id === authStore.user!.id)
    if (existingParticipant) {
      // 已经加入，更新在线状态
      existingParticipant.is_online = true
      // 如果比赛还没开始，重置准备状态，需要用户重新确认
      if (challenge.status !== 'in_progress') {
        existingParticipant.is_ready = false
      }
      
      // 更新数据库（非阻塞，不等待结果）
      supabase
        .from('challenges')
        .update({ participants })
        .eq('id', challengeId)
        .then(({ error }) => {
          if (error) console.warn('[Challenge] joinChallenge: Failed to update participants:', error)
        })

      currentChallenge.value = {
        ...challenge,
        participants
      } as Challenge
      
      isHost.value = false
      
      // 启动心跳机制
      startHeartbeatMechanism()
      
      // 如果比赛正在进行中，设置为 playing 状态并恢复游戏
      console.log(`[JoinChallenge] 选手进入房间，比赛状态: ${challenge.status}, game_words: ${challenge.game_words?.length || 0} 个`)
      if (challenge.status === 'in_progress') {
        gameStatus.value = 'playing'
        
        // 先从数据库恢复基本状态（不完全依赖房主响应）
        if (challenge.game_words && challenge.game_words.length > 0) {
          gameWords.value = challenge.game_words
          console.log(`[JoinChallenge] 选手恢复游戏单词: ${gameWords.value.length} 个`)
          
          // 从 game_words 推断当前轮次
          const activeIndex = gameWords.value.findIndex(gw => gw.status === 'active')
          if (activeIndex >= 0) {
            currentRound.value = activeIndex + 1
            currentWord.value = gameWords.value[activeIndex].word
            console.log(`[JoinChallenge] 选手从 active 状态恢复轮次: ${currentRound.value}`)
          } else {
            const pendingIndex = gameWords.value.findIndex(gw => gw.status !== 'finished')
            if (pendingIndex >= 0) {
              currentRound.value = pendingIndex + 1
              currentWord.value = gameWords.value[pendingIndex].word
              console.log(`[JoinChallenge] 选手从 pending 状态恢复轮次: ${currentRound.value}`)
            }
          }
          
          // 设置默认倒计时（房主会发送准确的时间）
          roundTimeRemaining.value = currentChallenge.value?.time_limit || 30
          roundStartTime.value = Date.now()
          startRoundTimer()
        }
        
        // 订阅数据库变更（替代轮询）
        subscribeToDbChanges()
        // 请求游戏状态（从房主获取精确的倒计时等信息）
        setTimeout(() => requestGameState(), 500)
      } else {
        gameStatus.value = 'waiting'
      }
      
      // 广播 join 消息，让主机同步状态给所有人
      setTimeout(() => {
        broadcast({
          type: 'join',
          data: { user_id: authStore.user!.id },
          sender_id: authStore.user!.id,
          timestamp: Date.now()
        })
      }, 500)
      return
    }

    // 检查人数
    if (participants.length >= challenge.max_participants) {
      throw new Error('挑战赛人数已满')
    }

    // 添加新参与者
    const newParticipant: ChallengeParticipant = {
      user_id: authStore.user.id,
      nickname: authStore.profile?.nickname || authStore.user.email?.split('@')[0] || '',
      avatar_url: authStore.profile?.avatar_url,
      is_online: true,
      is_ready: false,
      score: 0,
      joined_at: new Date().toISOString()
    }

    const updatedParticipants = [...participants, newParticipant]
    const newStatus = updatedParticipants.length >= challenge.max_participants ? 'ready' : 'waiting'

    // 更新数据库
    const { error: updateError } = await supabase
      .from('challenges')
      .update({
        participants: updatedParticipants,
        status: newStatus
      })
      .eq('id', challengeId)

    if (updateError) throw updateError

    currentChallenge.value = {
      ...challenge,
      participants: updatedParticipants
    } as Challenge

    isHost.value = false
    gameStatus.value = 'waiting'
    
    // 启动心跳机制
    startHeartbeatMechanism()
    
    // 广播加入消息
    broadcast({
      type: 'join',
      data: {
        user_id: authStore.user.id,
        nickname: newParticipant.nickname,
        avatar_url: newParticipant.avatar_url
      },
      sender_id: authStore.user.id,
      timestamp: Date.now()
    })
  }

  async function leaveChallenge(): Promise<void> {
    if (!currentChallenge.value || !authStore.user) return

    // 如果比赛已结束，直接清理不需要其他操作
    if (currentChallenge.value.status === 'finished' || currentChallenge.value.status === 'cancelled') {
      await cleanup()
      return
    }

    // 发送离开消息（通过 Supabase Realtime，非阻塞）
    try {
      broadcast({
        type: 'leave',
        data: {},
        sender_id: authStore.user.id,
        timestamp: Date.now()
      })
    } catch {}

    // 不管是创建者还是参与者，退出时更新在线状态和准备状态
    // 离开时重置 is_ready 为 false，因为用户需要重新确认准备状态
    // 只有明确点击"取消挑战赛"按钮才会取消比赛
    const updatedParticipants = currentChallenge.value.participants.map(p => {
      if (p.user_id === authStore.user!.id) {
        return { ...p, is_online: false, is_ready: false }
      }
      return p
    })

    // 使用 fetch API 直接更新，绕过可能断开的 supabase 客户端
    const supabaseUrl = 'https://ctsxrhgjvkeyokaejwqb.supabase.co'
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3hyaGdqdmtleW9rYWVqd3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MjU2MTUsImV4cCI6MjA4MDUwMTYxNX0.L2Xt2kkBw-2LRfHEF-uZQhYU8b5gDnZZNjpBEpZMkSc'
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000) // 3秒超时
    
    try {
      await fetch(`${supabaseUrl}/rest/v1/challenges?id=eq.${currentChallenge.value.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ participants: updatedParticipants }),
        signal: controller.signal
      })
    } catch {
      // 忽略错误，继续清理
    } finally {
      clearTimeout(timeoutId)
    }

    // 清理连接
    await cleanup()
  }

  async function cancelChallenge(): Promise<void> {
    if (!currentChallenge.value || !isCreator.value) return

    const challengeId = currentChallenge.value.id

    await supabase
      .from('challenges')
      .update({ status: 'cancelled' })
      .eq('id', challengeId)

    // 更新本地状态
    currentChallenge.value.status = 'cancelled'

    // 广播取消
    broadcast({
      type: 'game_end',
      data: {
        winner_id: null,
        winner_name: null,
        final_scores: []
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })

    // 更新缓存列表中的挑战赛
    updateChallengeInList(currentChallenge.value)
    // 不再标记刷新，因为 updateChallengeInList 已经更新了本地缓存

    await cleanup()
  }

  // 比赛中途退出
  async function exitGame(): Promise<void> {
    if (!currentChallenge.value || !authStore.user) return

    const userId = authStore.user.id

    // 标记该用户为已离开
    const participant = currentChallenge.value.participants.find(p => p.user_id === userId)
    if (participant) {
      participant.is_online = false
      participant.has_left = true // 添加离开标记
    }

    // 发送离开消息（通过 Supabase Realtime）
    broadcast({
      type: 'exit_game',
      data: { user_id: userId },
      sender_id: userId,
      timestamp: Date.now()
    })
    
    // 如果是主机退出，处理退出逻辑
    if (isHost.value) {
      await handleExitGameAsHost(userId)
    }

    // 更新数据库
    await supabase
      .from('challenges')
      .update({ participants: currentChallenge.value.participants })
      .eq('id', currentChallenge.value.id)

    // 清理连接并返回列表
    await cleanup()
  }

  // 主机处理玩家退出
  async function handleExitGameAsHost(userId: string): Promise<void> {
    if (!currentChallenge.value) return

    // 标记用户为已离开
    const participant = currentChallenge.value.participants.find(p => p.user_id === userId)
    if (participant) {
      participant.is_online = false
      participant.has_left = true
    }

    // 检查剩余在线玩家数量
    const onlinePlayers = currentChallenge.value.participants.filter(p => p.is_online && !p.has_left)
    
    if (onlinePlayers.length < 2) {
      // 少于2人，自动结束比赛
      // 找出剩余的唯一玩家作为赢家（如果有的话）
      const winner = onlinePlayers[0]
      
      if (winner) {
        await endGameWithWinner(winner.user_id, true)
      } else {
        // 没有玩家了，取消比赛
        await supabase
          .from('challenges')
          .update({ status: 'cancelled' })
          .eq('id', currentChallenge.value.id)

        // 更新本地状态
        currentChallenge.value.status = 'cancelled'
        
        // 更新缓存列表
        updateChallengeInList(currentChallenge.value)
        // 不再标记刷新，因为 updateChallengeInList 已经更新了本地缓存

        broadcast({
          type: 'game_end',
          data: {
            winner_id: null,
            winner_name: null,
            final_scores: []
          },
          sender_id: authStore.user!.id,
          timestamp: Date.now()
        })
      }
    } else {
      // 广播同步消息
      broadcastSync()
    }
  }

  // 结束比赛并指定赢家
  async function endGameWithWinner(winnerId: string, dueToExit = false): Promise<void> {
    if (!currentChallenge.value) return

    stopRoundTimer()

    const winner = currentChallenge.value.participants.find(p => p.user_id === winnerId)
    const totalPrize = currentChallenge.value.entry_fee * currentChallenge.value.participants.length

    const finalScores = currentChallenge.value.participants.map(p => ({
      user_id: p.user_id,
      score: p.score
    }))

    // 保存结果到数据库
    await saveChallengeResult(winnerId)

    // 广播游戏结束
    broadcast({
      type: 'game_end',
      data: {
        winner_id: winnerId,
        winner_name: winner?.nickname,
        final_scores: finalScores,
        prize_pool: totalPrize,
        game_words: gameWords.value,
        due_to_exit: dueToExit
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })

    // 本地处理
    handleGameEndMessage({
      type: 'game_end',
      data: {
        winner_id: winnerId,
        winner_name: winner?.nickname,
        final_scores: finalScores,
        prize_pool: totalPrize,
        game_words: gameWords.value
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })
  }

  // 删除挑战赛
  async function deleteChallenge(challengeId: string): Promise<void> {
    if (!authStore.user) throw new Error('请先登录')

    const challenge = challenges.value.find(c => c.id === challengeId)
    if (!challenge) throw new Error('挑战赛不存在')
    
    // 只有创建者可以删除
    if (challenge.creator_id !== authStore.user.id) {
      throw new Error('只有创建者可以删除挑战赛')
    }

    const { error } = await supabase
      .from('challenges')
      .delete()
      .eq('id', challengeId)

    if (error) throw error

    // 从列表中移除
    challenges.value = challenges.value.filter(c => c.id !== challengeId)
  }

  // 查看已结束的挑战赛（不需要 PeerJS 连接）
  function viewFinishedChallenge(challenge: Challenge): void {
    currentChallenge.value = challenge
    gameStatus.value = 'finished'
    isHost.value = false
    
    // 如果有保存的比赛单词，加载它们
    if (challenge.game_words) {
      gameWords.value = challenge.game_words
    }
  }

  async function saveChallengeResult(winnerId: string): Promise<void> {
    if (!currentChallenge.value) return

    const winner = currentChallenge.value.participants.find(p => p.user_id === winnerId)
    
    // 计算总奖池（所有参赛者的报名积分）
    const totalPrize = currentChallenge.value.entry_fee * currentChallenge.value.participants.length
    const finishedAt = new Date().toISOString()

    // 先更新数据库，确保状态持久化
    const { error } = await supabase
      .from('challenges')
      .update({
        status: 'finished',
        winner_id: winnerId,
        winner_name: winner?.nickname,
        prize_pool: totalPrize,
        finished_at: finishedAt,
        participants: currentChallenge.value.participants,
        game_words: gameWords.value // 保存比赛单词记录
      })
      .eq('id', currentChallenge.value.id)

    if (error) {
      console.error('Error saving challenge result:', error)
      throw error
    }

    // 数据库更新成功后，更新本地状态
    currentChallenge.value.status = 'finished'
    currentChallenge.value.winner_id = winnerId
    currentChallenge.value.winner_name = winner?.nickname
    currentChallenge.value.prize_pool = totalPrize
    currentChallenge.value.finished_at = finishedAt
    currentChallenge.value.game_words = gameWords.value

    //console.log('Challenge result saved successfully, status:', currentChallenge.value.status)

    // 更新缓存列表中的挑战赛
    updateChallengeInList(currentChallenge.value)
    // 不再标记刷新，因为 updateChallengeInList 已经更新了本地缓存

    // TODO: 更新赢家积分到用户账户
  }

  // 更新缓存列表中的挑战赛
  function updateChallengeInList(challenge: Challenge): void {
    const index = challenges.value.findIndex(c => c.id === challenge.id)
    if (index !== -1) {
      challenges.value[index] = { ...challenge }
      saveToCache() // 同步更新 localStorage 缓存
    }
  }

  // 加载用户参与的挑战记录
  async function loadMyChallengeRecords(): Promise<void> {
    if (!authStore.user) return

    try {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('status', 'finished')
        .order('finished_at', { ascending: false })
        .limit(100)

      if (error) throw error

      // 筛选出用户参与的挑战赛
      myChallengeRecords.value = (data || []).filter(c => 
        c.participants?.some((p: ChallengeParticipant) => p.user_id === authStore.user!.id)
      )
    } catch (error) {
      console.error('Error loading my challenge records:', error)
    }
  }

  // 计算挑战赛统计数据
  const challengeStats = computed(() => {
    if (!authStore.user || myChallengeRecords.value.length === 0) {
      return {
        totalGames: 0,
        wins: 0,
        winRate: 0,
        totalEarned: 0,
        totalSpent: 0,
        netPoints: 0
      }
    }

    const userId = authStore.user.id
    let wins = 0
    let totalEarned = 0
    let totalSpent = 0

    myChallengeRecords.value.forEach(c => {
      // 计算花费（报名费）
      totalSpent += c.entry_fee || 0

      // 计算获胜
      if (c.winner_id === userId) {
        wins++
        totalEarned += c.prize_pool || (c.entry_fee * c.participants?.length) || 0
      }
    })

    return {
      totalGames: myChallengeRecords.value.length,
      wins,
      winRate: myChallengeRecords.value.length > 0 ? Math.round((wins / myChallengeRecords.value.length) * 100) : 0,
      totalEarned,
      totalSpent,
      netPoints: totalEarned - totalSpent
    }
  })

  async function cleanup(): Promise<void> {
    stopRoundTimer()
    unsubscribeFromDbChanges() // 清理数据库订阅
    cleanupRealtimeStatusListener() // 清理 RealtimeManager 状态监听
    
    // 清理心跳和状态广播定时器
    stopPlayerHeartbeat()
    stopHostBroadcast()
    stopLocalCountdownCheck()  // 清理本地倒计时检查
    cleanupVisibilityAndNetworkListeners()
    
    // 清理心跳相关的 Map
    lastHeartbeatMap.clear()
    offlineStartTimeMap.clear()
    heartbeatConfirmedOffline.clear()
    lastHostBroadcastTime = 0
    gameEndedByMe = false  // 重置游戏结束标志
    
    // 清理 Presence 同步节流定时器
    if (presenceSyncTimer) {
      clearTimeout(presenceSyncTimer)
      presenceSyncTimer = null
    }
    
    // 清理离线计数器
    offlineCountMap.clear()
    
    // 清理 Supabase Realtime Channel（通过 RealtimeManager）
    if (currentChannelName.value) {
      try {
        await realtimeManager.untrackPresence(currentChannelName.value)
        await realtimeManager.unsubscribe(currentChannelName.value)
      } catch {}
      currentChannelName.value = ''
    }
    
    // 清理旧的 PeerJS 相关（兼容）
    connections.value.clear()
    peer.value = null
    peerId.value = ''
    connectionId.value = ''

    // 然后重置本地状态
    currentChallenge.value = null
    isHost.value = false
    realtimeStatus.value = 'disconnected'
    gameWords.value = []
    currentRound.value = 0
    currentWord.value = null
    roundResults.value = []
    gameStatus.value = 'waiting'
    hasSubmitted.value = false
    myAnswer.value = ''
    roundEnded.value = false
  }

  // 清除缓存，强制下次加载时重新获取数据
  function clearCache(): void {
    lastLoadTime.value = 0
    try {
      localStorage.removeItem(CACHE_KEY)
      localStorage.removeItem(CACHE_TIME_KEY)
    } catch (e) {
      // 忽略 localStorage 错误
    }
  }
  
  // 标记列表需要刷新（供外部调用，如收到通知时）
  function markNeedsRefresh(): void {
    needsRefresh.value = true
  }
  
  // 检查并执行刷新（进入列表页时调用）
  async function checkAndRefresh(): Promise<void> {
    if (needsRefresh.value) {
      needsRefresh.value = false
      clearCache()
      await loadChallenges(true)
    }
  }

  return {
    // State
    challenges,
    currentChallenge,
    loading,
    syncing,
    myChallengeRecords,
    peerId,
    isHost,
    connectionStatus,
    isNetworkOnline, // 浏览器网络状态
    realtimeStatus, // Supabase Realtime 连接状态
    gameWords,
    currentRound,
    currentWord,
    roundTimeRemaining,
    gameStatus,
    roundResults,
    myAnswer,
    hasSubmitted,
    // Computed
    isCreator,
    myParticipant,
    allOnline,
    allReady,
    canStart,
    sortedParticipants,
    challengeStats,
    // Constants
    OFFLINE_PROTECTION_TIME: HEARTBEAT_CONFIG.OFFLINE_PROTECTION_TIME,
    // Actions
    initPeer,
    loadChallenges,
    loadMyChallengeRecords,
    createChallenge,
    joinChallenge,
    leaveChallenge,
    cancelChallenge,
    deleteChallenge,
    viewFinishedChallenge,
    toggleReady,
    startGame,
    submitAnswer,
    exitGame,
    cleanup,
    clearCache,
    markNeedsRefresh,
    checkAndRefresh,
    needsRefresh
  }
})
