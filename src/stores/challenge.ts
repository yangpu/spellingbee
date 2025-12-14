import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { realtimeManager, type ChannelConfig, type RealtimeStatus } from '@/lib/realtime-manager'
import { useAuthStore } from './auth'
import { useWordsStore } from './words'
import { useAnnouncerStore } from './announcer'
import type { Challenge, ChallengeParticipant, ChallengeWord, ChallengeMessage, ChallengeWordResult, Word } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

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
      return connectionId.value
    } catch (error) {
      realtimeStatus.value = 'disconnected'
      throw error
    }
  }
  
  // Presence 同步节流（减少频繁调用）
  let presenceSyncTimer: ReturnType<typeof setTimeout> | null = null
  const PRESENCE_SYNC_THROTTLE = 100  // 100ms 节流
  
  // 用于追踪用户连续离线的次数（防止 track 更新时的瞬时离线）
  const offlineCountMap = new Map<string, number>()
  const OFFLINE_CONFIRM_COUNT = 3  // 连续 3 次 sync 都不在线才确认离线
  
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
  function handlePresenceSync(): void {
    if (!currentChallenge.value || !currentChannelName.value) return
    
    const state = realtimeManager.getPresenceState(currentChannelName.value)
    const creatorId = currentChallenge.value.creator_id
    const myUserId = authStore.user?.id
    
    // 更新所有参与者的在线状态 - 基于 Presence 状态快照
    currentChallenge.value.participants.forEach(participant => {
      const userId = participant.user_id
      const presences = state[userId] as any[]
      const isCreator = userId === creatorId
      
      // 不要修改自己的状态（自己的状态由本地控制）
      if (userId === myUserId) {
        return
      }
      
      if (presences && presences.length > 0) {
        const presence = presences[0]
        // 用户在 Presence 中存在，说明在线
        participant.is_online = true
        if (isCreator) {
          participant.is_ready = true
        } else {
          participant.is_ready = presence.is_ready || false
        }
        if (presence.score !== undefined) {
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
          participant.is_online = false
          participant.is_ready = false
          offlineCountMap.delete(userId)
          
          // 如果是主机，处理玩家离线逻辑
          if (isHost.value && gameStatus.value === 'playing') {
            handleExitGameAsHost(userId)
          }
        }
      }
    })
  }
  
  // 处理参与者加入
  function handlePresenceJoin(userId: string, presence: any): void {
    if (!currentChallenge.value) return
    
    let participant = currentChallenge.value.participants.find(p => p.user_id === userId)
    
    if (participant) {
      // 更新已存在的参与者状态
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
        // 心跳响应
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
    const data = message.data as { word: Word; round: number; time_limit: number }
    
    currentWord.value = data.word
    currentRound.value = data.round
    roundTimeRemaining.value = data.time_limit
    roundStartTime.value = Date.now()
    hasSubmitted.value = false
    myAnswer.value = ''
    roundResults.value = []
    roundEnded.value = false // 重置轮次结束标志
    gameStatus.value = 'playing'
    
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

    // 检查是否有人答对了
    if (result.is_correct) {
      endRound(message.sender_id)
    } else if (roundResults.value.length >= (currentChallenge.value?.participants.length || 0)) {
      // 所有人都提交了
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

    // 广播当前单词
    broadcast({
      type: 'word',
      data: {
        word: currentGameWord.word,
        round: currentRound.value,
        time_limit: currentChallenge.value.time_limit
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })

    // 启动倒计时
    startRoundTimer()
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
            localParticipant.is_online = p.is_online
            localParticipant.is_ready = p.is_ready
            localParticipant.score = p.score
            localParticipant.has_left = p.has_left
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

    const scores = currentChallenge.value.participants.map(p => ({
      user_id: p.user_id,
      score: p.score
    }))

    // 广播轮次结束
    broadcast({
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

      if (result.is_correct) {
        endRound(authStore.user!.id)
      } else if (roundResults.value.length >= currentChallenge.value.participants.length) {
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

    // 生成比赛单词
    const words = wordsStore.getRandomWords(
      currentChallenge.value.word_count,
      currentChallenge.value.difficulty
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

    // 更新数据库
    await supabase
      .from('challenges')
      .update({
        status: 'in_progress',
        started_at: currentChallenge.value.started_at
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
      
      // 更新 Presence 状态（房主自动准备）
      updatePresence({ is_ready: true })
      
      // 根据比赛状态设置游戏状态
      if (challenge.status === 'in_progress') {
        // 比赛正在进行中，但房主刷新了页面
        // Supabase 模式下可以尝试恢复状态
        gameStatus.value = 'playing'
        // 订阅数据库变更（替代轮询）
        subscribeToDbChanges()
        // 房主进入后广播同步消息，让其他用户同步状态
        setTimeout(() => broadcastSync(), 500)
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
      
      // 如果比赛正在进行中，设置为 playing 状态
      if (challenge.status === 'in_progress') {
        gameStatus.value = 'playing'
        // 订阅数据库变更（替代轮询）
        subscribeToDbChanges()
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
