import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
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

  // Supabase Realtime state (替代 PeerJS)
  const channel = ref<RealtimeChannel | null>(null)
  const connectionId = ref<string>('')
  const isHost = ref(false)
  const connectionStatus = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
  
  // 保留 PeerJS 相关变量以兼容旧代码（但不再使用）
  const peer = ref<any>(null)
  const peerId = ref<string>('')
  const connections = ref<Map<string, any>>(new Map())

  // Game state
  const gameWords = ref<ChallengeWord[]>([])
  const currentRound = ref(0)
  const currentWord = ref<Word | null>(null)
  const roundStartTime = ref(0)
  const roundTimeRemaining = ref(0)
  const roundTimer = ref<ReturnType<typeof setInterval> | null>(null)
  const statusCheckTimer = ref<ReturnType<typeof setInterval> | null>(null) // 状态检查定时器
  const gameStatus = ref<'waiting' | 'ready' | 'playing' | 'round_result' | 'finished'>('waiting')
  const roundResults = ref<ChallengeWordResult[]>([])
  const myAnswer = ref('')
  const hasSubmitted = ref(false)

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

  // 初始化 Supabase Realtime Channel（替代 PeerJS）
  async function initRealtimeChannel(challengeId: string): Promise<string> {
    if (!authStore.user) throw new Error('请先登录')
    
    // 如果已有 channel，先清理（不等待，避免卡住）
    if (channel.value) {
      const oldChannel = channel.value
      channel.value = null
      connectionStatus.value = 'disconnected'
      // 使用 Promise.race 添加超时，避免 unsubscribe 卡住
      Promise.race([
        oldChannel.unsubscribe(),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]).catch(() => {})
    }
    
    // 先尝试移除可能存在的同名 channel（防止重复订阅）
    const channelName = `challenge:${challengeId}`
    try {
      await supabase.removeChannel(supabase.channel(channelName))
    } catch {}
    
    connectionStatus.value = 'connecting'
    connectionId.value = authStore.user.id
    
    channel.value = supabase.channel(channelName, {
      config: {
        broadcast: { self: false }, // 不接收自己发送的消息
        presence: { key: authStore.user.id }
      }
    })
    
    // 监听广播消息
    channel.value.on('broadcast', { event: 'message' }, (payload) => {
      const message = payload.payload as ChallengeMessage
      if (message.sender_id !== authStore.user?.id) {
        handleMessage(message, message.sender_id)
      }
    })
    
    // 监听定向消息（发给特定用户）
    channel.value.on('broadcast', { event: `message:${authStore.user.id}` }, (payload) => {
      const message = payload.payload as ChallengeMessage
      handleMessage(message, message.sender_id)
    })
    
    // 监听 Presence 状态变化
    channel.value.on('presence', { event: 'sync' }, () => {
      handlePresenceSync()
    })
    
    channel.value.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      if (key !== authStore.user?.id && newPresences.length > 0) {
        handlePresenceJoin(key, newPresences[0] as any)
      }
    })
    
    channel.value.on('presence', { event: 'leave' }, ({ key }) => {
      if (key !== authStore.user?.id) {
        handlePresenceLeave(key)
      }
    })
    
    // 订阅频道
    return new Promise((resolve, reject) => {
      channel.value!.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          connectionStatus.value = 'connected'
          
          // 发送 Presence 状态
          await channel.value?.track({
            user_id: authStore.user!.id,
            nickname: authStore.profile?.nickname || authStore.user!.email?.split('@')[0],
            avatar_url: authStore.profile?.avatar_url,
            is_ready: false,
            score: 0,
            online_at: new Date().toISOString()
          })
          
          resolve(connectionId.value)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          connectionStatus.value = 'disconnected'
          reject(new Error('Channel subscription failed'))
        }
      })
      
      // 超时处理
      setTimeout(() => {
        if (connectionStatus.value === 'connecting') {
          reject(new Error('Connection timeout'))
        }
      }, 15000)
    })
  }
  
  // 处理 Presence 同步
  function handlePresenceSync(): void {
    if (!currentChallenge.value || !channel.value) return
    
    const state = channel.value.presenceState()
    
    // 更新所有参与者的在线状态
    Object.entries(state).forEach(([userId, presences]) => {
      if (presences.length > 0) {
        const presence = presences[0] as any
        const participant = currentChallenge.value!.participants.find(p => p.user_id === userId)
        if (participant) {
          participant.is_online = true
          participant.is_ready = presence.is_ready || false
          if (presence.score !== undefined) {
            participant.score = presence.score
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
      participant.is_ready = presence.is_ready || false
    } else {
      // 添加新参与者（这种情况一般不会发生，因为参与者应该先在数据库中注册）
      //console.log('[Realtime] New participant joined via presence:', presence.nickname)
    }
    
    // 如果是主机，广播同步消息
    if (isHost.value) {
      broadcastSync()
    }
  }
  
  // 处理参与者离开
  function handlePresenceLeave(userId: string): void {
    if (!currentChallenge.value) return
    
    const participant = currentChallenge.value.participants.find(p => p.user_id === userId)
    if (participant) {
      participant.is_online = false
    }
    
    // 如果是主机，处理玩家离开逻辑
    if (isHost.value && gameStatus.value === 'playing') {
      handleExitGameAsHost(userId)
    }
  }
  
  // 更新 Presence 状态
  async function updatePresence(data: Partial<{ is_ready: boolean; score: number }>): Promise<void> {
    if (!channel.value || !authStore.user) return
    
    const currentState = channel.value.presenceState()[authStore.user.id]?.[0] || {}
    
    await channel.value.track({
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
    // 如果当前挑战赛存在，使用其 ID 初始化 channel
    if (currentChallenge.value) {
      return await initRealtimeChannel(currentChallenge.value.id)
    }
    // 否则只返回用户 ID 作为连接标识
    if (authStore.user) {
      connectionId.value = authStore.user.id
      peerId.value = authStore.user.id
      connectionStatus.value = 'connected'
      return authStore.user.id
    }
    throw new Error('请先登录')
  }

  // 兼容旧代码：handleIncomingConnection 不再需要，但保留空实现
  function handleIncomingConnection(conn: any) {
    // Supabase Realtime 模式下不需要此函数
    //console.log('[Deprecated] handleIncomingConnection called in Supabase mode')
  }

  // 兼容旧代码：connectToHost 在 Supabase 模式下不需要，直接返回成功
  async function connectToHost(hostPeerId: string): Promise<void> {
    // Supabase Realtime 模式下，所有用户通过 channel 通信，不需要点对点连接
    //console.log('[Supabase Mode] connectToHost called, using channel instead')
    return Promise.resolve()
  }

  // Send message - 使用 Supabase Realtime broadcast
  function sendMessage(conn: any, message: ChallengeMessage): void {
    // 在 Supabase 模式下，使用 channel broadcast
    if (channel.value) {
      channel.value.send({
        type: 'broadcast',
        event: 'message',
        payload: message
      })
    }
  }

  // Broadcast message to all connections - 使用 Supabase Realtime broadcast
  function broadcast(message: ChallengeMessage): void {
    if (channel.value) {
      channel.value.send({
        type: 'broadcast',
        event: 'message',
        payload: message
      })
    }
  }
  
  // 发送消息给指定用户
  function sendToUser(userId: string, message: ChallengeMessage): void {
    if (channel.value) {
      channel.value.send({
        type: 'broadcast',
        event: `message:${userId}`,
        payload: message
      })
    }
  }

  // Handle incoming message
  function handleMessage(message: ChallengeMessage, fromUserId: string): void {
    switch (message.type) {
      case 'join':
        handleJoinMessage(message, fromUserId)
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
  function handleJoinMessage(message: ChallengeMessage, fromPeerId: string): void {
    if (!isHost.value || !currentChallenge.value) return

    const data = message.data as {
      user_id: string
      nickname: string
      avatar_url?: string
      peer_id: string
    }

    ////console.log('handleJoinMessage: user', data.nickname, 'peer_id', data.peer_id)

    // 查找参与者
    let participant = currentChallenge.value.participants.find(p => p.user_id === data.user_id)
    
    if (participant) {
      // 更新已存在的参与者状态
      participant.is_online = true
      participant.peer_id = data.peer_id
      ////console.log('handleJoinMessage: updated existing participant online status')
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
      ////console.log('handleJoinMessage: added new participant', data.nickname)
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
    }

    if (isHost.value) {
      broadcastSync()
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
    
    // 非主机用户启动状态检查定时器
    if (!isHost.value) {
      startStatusCheckTimer()
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
    gameStatus.value = 'playing'
    
    // 启动倒计时
    startRoundTimer()
  }

  function handleAnswerMessage(message: ChallengeMessage): void {
    if (!isHost.value) return

    const data = message.data as {
      answer: string
      time_taken: number
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
    
    // 保留当前用户的本地状态（如 is_ready），但更新其他信息
    if (currentChallenge.value && authStore.user) {
      currentChallenge.value = data
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

  // Handle participant disconnect
  function handleParticipantDisconnect(peerId: string): void {
    if (!currentChallenge.value) return

    const participant = currentChallenge.value.participants.find(p => p.peer_id === peerId)
    if (participant) {
      participant.is_online = false
      
      if (isHost.value) {
        broadcastSync()
      }
    }
  }

  // Handle host disconnect
  function handleHostDisconnect(): void {
    // 如果比赛已经正常结束，不要改变状态
    if (currentChallenge.value?.status === 'finished' || gameStatus.value === 'finished') {
      return
    }
    
    // 主机异常断开，游戏取消
    gameStatus.value = 'finished'
    if (currentChallenge.value) {
      currentChallenge.value.status = 'cancelled'
    }
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

  // 启动状态检查定时器（非主机用户使用）
  function startStatusCheckTimer(): void {
    stopStatusCheckTimer()
    
    // 每3秒检查一次数据库状态
    statusCheckTimer.value = setInterval(async () => {
      if (!currentChallenge.value || isHost.value || gameStatus.value === 'finished') {
        stopStatusCheckTimer()
        return
      }

      try {
        const { data: latestChallenge } = await supabase
          .from('challenges')
          .select('status, winner_id, winner_name, prize_pool, finished_at, game_words, participants')
          .eq('id', currentChallenge.value.id)
          .single()

        if (latestChallenge && (latestChallenge.status === 'finished' || latestChallenge.status === 'cancelled')) {
          // 比赛已结束，更新本地状态
          stopStatusCheckTimer()
          stopRoundTimer()
          
          gameStatus.value = 'finished'
          currentChallenge.value.status = latestChallenge.status
          currentChallenge.value.winner_id = latestChallenge.winner_id
          currentChallenge.value.winner_name = latestChallenge.winner_name
          currentChallenge.value.prize_pool = latestChallenge.prize_pool
          currentChallenge.value.finished_at = latestChallenge.finished_at
          
          if (latestChallenge.game_words) {
            gameWords.value = latestChallenge.game_words
            currentChallenge.value.game_words = latestChallenge.game_words
          }
          
          if (latestChallenge.participants) {
            currentChallenge.value.participants = latestChallenge.participants
          }

          // 更新缓存列表
          updateChallengeInList(currentChallenge.value)
        }
      } catch (e) {
        console.error('Error checking challenge status:', e)
      }
    }, 3000)
  }

  function stopStatusCheckTimer(): void {
    if (statusCheckTimer.value) {
      clearInterval(statusCheckTimer.value)
      statusCheckTimer.value = null
    }
  }

  function endRound(winnerId: string | null): void {
    if (!isHost.value || !currentChallenge.value || !currentWord.value) return

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

    if (isHost.value) {
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
      // 非主机：通过 Supabase Realtime 广播答案
      broadcast({
        type: 'answer',
        data: {
          answer,
          time_taken: timeTaken
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
    // 如果不是强制刷新，且缓存有效，直接返回
    if (!force && challenges.value.length > 0 && Date.now() - lastLoadTime.value < CACHE_DURATION) {
      //console.log('[loadChallenges] 使用缓存，跳过刷新')
      return
    }
    
    // 防止并发请求，但添加超时保护
    if (loading.value) {
      if (!force) {
        //console.log('[loadChallenges] 正在加载中，跳过')
        return
      }
      // 强制刷新时，直接重置 loading 状态
      loading.value = false
    }
    
    //console.log('[loadChallenges] 开始从数据库加载, force:', force)
    loading.value = true
    
    try {
      // 强制刷新时，直接使用 fetch API 绕过缓存获取最新数据
      if (force) {
        await fetchFreshChallenges()
      } else {
        // 非强制刷新，使用 supabase 客户端（可能有缓存）
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 10000)
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
  
  // 绕过缓存获取最新数据（使用 fetch API 直接请求）
  async function fetchFreshChallenges(): Promise<void> {
    //console.log('[fetchFreshChallenges] 绕过缓存获取最新数据')
    
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
      //console.log('[fetchFreshChallenges] 最新数据数量:', data?.length)
      
      // 更新数据
      challenges.value = (data || []).map((c: Challenge) => ({
        ...c,
        participants: c.participants || []
      }))
      lastLoadTime.value = Date.now()
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
  }): Promise<Challenge> {
    if (!authStore.user) throw new Error('请先登录')

    // 初始化 PeerJS
    await initPeer()

    const challenge: Omit<Challenge, 'id' | 'created_at'> = {
      ...data,
      show_chinese: data.show_chinese ?? true,
      show_english: data.show_english ?? true,
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

    if (error) throw error

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

    return newChallenge
  }

  async function joinChallenge(challengeId: string): Promise<void> {
    if (!authStore.user) throw new Error('请先登录')

    // 使用 fetch API 直接获取挑战赛信息，绕过可能断开的 supabase 客户端
    const supabaseUrl = 'https://ctsxrhgjvkeyokaejwqb.supabase.co'
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3hyaGdqdmtleW9rYWVqd3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MjU2MTUsImV4cCI6MjA4MDUwMTYxNX0.L2Xt2kkBw-2LRfHEF-uZQhYU8b5gDnZZNjpBEpZMkSc'
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    
    let challenge: any
    let error: any
    
    try {
      const url = `${supabaseUrl}/rest/v1/challenges?id=eq.${challengeId}&select=*`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        cache: 'no-store',
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      challenge = data?.[0]
    } catch (e: any) {
      clearTimeout(timeoutId)
      if (e.name === 'AbortError') {
        throw new Error('获取挑战赛信息超时，请检查网络后重试')
      }
      error = e
    }

    if (error) throw error
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
      connectionStatus.value = 'disconnected'
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

      // 更新数据库
      await supabase
        .from('challenges')
        .update({ participants })
        .eq('id', challengeId)

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
        // 启动状态检查定时器
        startStatusCheckTimer()
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
      
      // 更新数据库
      await supabase
        .from('challenges')
        .update({ participants })
        .eq('id', challengeId)

      currentChallenge.value = {
        ...challenge,
        participants
      } as Challenge
      
      isHost.value = false
      
      // 如果比赛正在进行中，设置为 playing 状态
      if (challenge.status === 'in_progress') {
        gameStatus.value = 'playing'
        startStatusCheckTimer()
      } else {
        gameStatus.value = 'waiting'
      }
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

    // 更新数据库
    const { error: updateError } = await supabase
      .from('challenges')
      .update({
        participants: updatedParticipants,
        status: updatedParticipants.length >= challenge.max_participants ? 'ready' : 'waiting'
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

  async function leaveChallenge(skipConfirm = false): Promise<void> {
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

    // 不管是创建者还是参与者，退出时只更新在线状态，不取消比赛
    // 只有明确点击"取消挑战赛"按钮才会取消
    const updatedParticipants = currentChallenge.value.participants.map(p => {
      if (p.user_id === authStore.user!.id) {
        return { ...p, is_online: false }
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

    ////console.log('Challenge result saved successfully, status:', currentChallenge.value.status)

    // 更新缓存列表中的挑战赛
    updateChallengeInList(currentChallenge.value)

    // TODO: 更新赢家积分到用户账户
  }

  // 更新缓存列表中的挑战赛
  function updateChallengeInList(challenge: Challenge): void {
    const index = challenges.value.findIndex(c => c.id === challenge.id)
    if (index !== -1) {
      challenges.value[index] = { ...challenge }
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
    stopStatusCheckTimer()
    
    // 清理 Supabase Realtime Channel（添加超时保护，避免卡住）
    if (channel.value) {
      const oldChannel = channel.value
      channel.value = null
      
      // 使用 Promise.race 添加超时，避免 untrack/unsubscribe 卡住
      try {
        await Promise.race([
          (async () => {
            try { await oldChannel.untrack() } catch {}
            try { await oldChannel.unsubscribe() } catch {}
          })(),
          new Promise(resolve => setTimeout(resolve, 3000)) // 3秒超时
        ])
      } catch {}
    }
    
    // 清理旧的 PeerJS 相关（兼容）
    connections.value.clear()
    peer.value = null
    peerId.value = ''
    connectionId.value = ''

    // 然后重置本地状态
    currentChallenge.value = null
    isHost.value = false
    connectionStatus.value = 'disconnected'
    gameWords.value = []
    currentRound.value = 0
    currentWord.value = null
    roundResults.value = []
    gameStatus.value = 'waiting'
    hasSubmitted.value = false
    myAnswer.value = ''
  }

  // 清除缓存，强制下次加载时重新获取数据
  function clearCache(): void {
    lastLoadTime.value = 0
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
    clearCache
  }
})
