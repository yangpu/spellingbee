import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import Peer, { DataConnection } from 'peerjs'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { useWordsStore } from './words'
import type { Challenge, ChallengeParticipant, ChallengeWord, ChallengeMessage, ChallengeWordResult, Word } from '@/types'

export const useChallengeStore = defineStore('challenge', () => {
  const authStore = useAuthStore()
  const wordsStore = useWordsStore()

  // State
  const challenges = ref<Challenge[]>([])
  const currentChallenge = ref<Challenge | null>(null)
  const loading = ref(false)
  const syncing = ref(false)
  const myChallengeRecords = ref<Challenge[]>([]) // 用户参与的挑战记录

  // PeerJS state
  const peer = ref<Peer | null>(null)
  const peerId = ref<string>('')
  const connections = ref<Map<string, DataConnection>>(new Map())
  const isHost = ref(false)
  const connectionStatus = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')

  // Game state
  const gameWords = ref<ChallengeWord[]>([])
  const currentRound = ref(0)
  const currentWord = ref<Word | null>(null)
  const roundStartTime = ref(0)
  const roundTimeRemaining = ref(0)
  const roundTimer = ref<ReturnType<typeof setInterval> | null>(null)
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
    return currentChallenge.value.participants.every(p => p.is_online)
  })

  const allReady = computed(() => {
    if (!currentChallenge.value) return false
    return currentChallenge.value.participants.every(p => p.is_ready)
  })

  const canStart = computed(() => {
    if (!currentChallenge.value) return false
    const hasEnoughPlayers = currentChallenge.value.participants.length >= 2
    const allPlayersReady = currentChallenge.value.participants.every(p => p.is_ready)
    const allPlayersOnline = currentChallenge.value.participants.every(p => p.is_online)
    return isCreator.value && hasEnoughPlayers && allPlayersReady && allPlayersOnline
  })

  const sortedParticipants = computed(() => {
    if (!currentChallenge.value) return []
    return [...currentChallenge.value.participants].sort((a, b) => b.score - a.score)
  })

  // Initialize PeerJS
  async function initPeer(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (peer.value) {
        resolve(peerId.value)
        return
      }

      connectionStatus.value = 'connecting'
      
      // 使用公共 PeerJS 服务器
      const newPeer = new Peer({
        debug: 2,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      })

      newPeer.on('open', (id) => {
        peer.value = newPeer
        peerId.value = id
        connectionStatus.value = 'connected'
        //console.log('PeerJS connected with ID:', id)
        resolve(id)
      })

      newPeer.on('connection', (conn) => {
        handleIncomingConnection(conn)
      })

      newPeer.on('error', (err) => {
        console.error('PeerJS error:', err)
        connectionStatus.value = 'disconnected'
        reject(err)
      })

      newPeer.on('disconnected', () => {
        connectionStatus.value = 'disconnected'
        // 尝试重连
        setTimeout(() => {
          if (peer.value && !peer.value.destroyed) {
            peer.value.reconnect()
          }
        }, 3000)
      })
    })
  }

  // Handle incoming connection (for host)
  function handleIncomingConnection(conn: DataConnection) {
    //console.log('Incoming connection from:', conn.peer)
    
    conn.on('open', () => {
      connections.value.set(conn.peer, conn)
      //console.log('Connection established with:', conn.peer)
    })

    conn.on('data', (data) => {
      handleMessage(data as ChallengeMessage, conn.peer)
    })

    conn.on('close', () => {
      connections.value.delete(conn.peer)
      handleParticipantDisconnect(conn.peer)
    })

    conn.on('error', (err) => {
      console.error('Connection error:', err)
      connections.value.delete(conn.peer)
    })
  }

  // Connect to host (for participants)
  async function connectToHost(hostPeerId: string): Promise<void> {
    if (!peer.value) {
      await initPeer()
    }

    return new Promise((resolve, reject) => {
      const conn = peer.value!.connect(hostPeerId, {
        reliable: true
      })

      conn.on('open', () => {
        connections.value.set(hostPeerId, conn)
        //console.log('Connected to host:', hostPeerId)
        
        // 发送加入消息
        sendMessage(conn, {
          type: 'join',
          data: {
            user_id: authStore.user!.id,
            nickname: authStore.profile?.nickname || authStore.user!.email?.split('@')[0],
            avatar_url: authStore.profile?.avatar_url,
            peer_id: peerId.value
          },
          sender_id: authStore.user!.id,
          timestamp: Date.now()
        })
        
        resolve()
      })

      conn.on('data', (data) => {
        handleMessage(data as ChallengeMessage, hostPeerId)
      })

      conn.on('close', () => {
        connections.value.delete(hostPeerId)
        handleHostDisconnect()
      })

      conn.on('error', (err) => {
        console.error('Connection to host error:', err)
        reject(err)
      })

      // 超时处理
      setTimeout(() => {
        if (!conn.open) {
          reject(new Error('Connection timeout'))
        }
      }, 10000)
    })
  }

  // Send message
  function sendMessage(conn: DataConnection | any, message: ChallengeMessage): void {
    if (conn?.open) {
      conn.send(message)
    }
  }

  // Broadcast message to all connections (for host)
  function broadcast(message: ChallengeMessage): void {
    connections.value.forEach((conn) => {
      sendMessage(conn, message)
    })
  }

  // Handle incoming message
  function handleMessage(message: ChallengeMessage, fromPeerId: string): void {
    //console.log('Received message:', message.type, message)

    switch (message.type) {
      case 'join':
        handleJoinMessage(message, fromPeerId)
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
    }

    if (isHost.value) {
      broadcastSync()
    }
  }

  function handleReadyMessage(message: ChallengeMessage): void {
    if (!currentChallenge.value) return

    const data = message.data as { is_ready: boolean }
    //console.log('handleReadyMessage: from', message.sender_id, 'ready:', data.is_ready)
    
    const participant = currentChallenge.value.participants.find(p => p.user_id === message.sender_id)
    if (participant) {
      participant.is_ready = data.is_ready
      //console.log('handleReadyMessage: updated participant', participant.nickname, 'to', data.is_ready)
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
    }
  }

  function handleSyncMessage(message: ChallengeMessage): void {
    const data = message.data as Challenge
    //console.log('handleSyncMessage: received sync, participants:', data.participants?.length, 'status:', data.status)
    
    // 保留当前用户的本地状态（如 is_ready），但更新其他信息
    if (currentChallenge.value && authStore.user) {
      const myCurrentState = currentChallenge.value.participants.find(p => p.user_id === authStore.user!.id)
      currentChallenge.value = data
      
      // 如果我们有本地状态，确保它被保留（除非服务器状态更新）
      if (myCurrentState) {
        const myNewState = currentChallenge.value.participants.find(p => p.user_id === authStore.user!.id)
        if (myNewState) {
          // 服务器的状态优先
          //console.log('handleSyncMessage: my ready status from server:', myNewState.is_ready)
        }
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
    const sortedByScore = [...eligibleParticipants].sort((a, b) => b.score - a.score)
    const winner = sortedByScore[0]

    // 计算总奖池
    const totalPrize = currentChallenge.value.entry_fee * currentChallenge.value.participants.length

    const finalScores = currentChallenge.value.participants.map(p => ({
      user_id: p.user_id,
      score: p.score
    }))

    // 先保存结果到数据库，确保状态持久化
    await saveChallengeResult(winner.user_id)

    // 然后广播游戏结束
    broadcast({
      type: 'game_end',
      data: {
        winner_id: winner.user_id,
        winner_name: winner.nickname,
        final_scores: finalScores,
        prize_pool: totalPrize,
        game_words: gameWords.value // 传递比赛单词记录
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })

    // 本地也处理
    handleGameEndMessage({
      type: 'game_end',
      data: {
        winner_id: winner.user_id,
        winner_name: winner.nickname,
        final_scores: finalScores,
        prize_pool: totalPrize,
        game_words: gameWords.value
      },
      sender_id: authStore.user!.id,
      timestamp: Date.now()
    })
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
      // 发送给主机
      const hostConn = connections.value.values().next().value
      if (hostConn) {
        sendMessage(hostConn, {
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
  }

  // Toggle ready status
  function toggleReady(): void {
    if (!currentChallenge.value || !myParticipant.value) {
      //console.log('toggleReady: no challenge or participant')
      return
    }

    const newStatus = !myParticipant.value.is_ready
    //console.log('toggleReady: setting status to', newStatus)
    
    // 立即更新本地状态
    myParticipant.value.is_ready = newStatus

    if (isHost.value) {
      // 主机直接更新并广播
      if (allReady.value && currentChallenge.value.participants.length >= 2) {
        currentChallenge.value.status = 'ready'
      }
      broadcastSync()
      // 同步到数据库
      syncParticipantsToDb()
    } else {
      // 客户端发送给主机
      const hostConn = connections.value.values().next().value
      //console.log('toggleReady: hostConn', hostConn, 'open:', hostConn?.open)
      if (hostConn && hostConn.open) {
        sendMessage(hostConn, {
          type: 'ready',
          data: { is_ready: newStatus },
          sender_id: authStore.user!.id,
          timestamp: Date.now()
        })
        //console.log('toggleReady: message sent')
      } else {
        //console.log('toggleReady: no connection to host')
      }
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
  async function loadChallenges(): Promise<void> {
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .in('status', ['waiting', 'ready', 'in_progress', 'finished'])
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      
      challenges.value = (data || []).map(c => ({
        ...c,
        participants: c.participants || []
      }))
    } catch (error) {
      console.error('Error loading challenges:', error)
    } finally {
      loading.value = false
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

    return newChallenge
  }

  async function joinChallenge(challengeId: string): Promise<void> {
    if (!authStore.user) throw new Error('请先登录')

    // 获取挑战赛信息
    const { data: challenge, error } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single()

    if (error) throw error
    if (!challenge) throw new Error('挑战赛不存在')

    // 检查比赛状态，已结束或已取消的比赛不能加入，只能查看
    if (challenge.status === 'finished' || challenge.status === 'cancelled') {
      // 直接查看历史记录，不创建 PeerJS 连接
      viewFinishedChallenge(challenge as Challenge)
      return
    }

    let participants = challenge.participants || []

    // 初始化 PeerJS
    await initPeer()

    // 检查是否是房主
    if (challenge.creator_id === authStore.user.id) {
      // 房主重新进入房间，更新 peer_id
      const creatorIndex = participants.findIndex((p: ChallengeParticipant) => p.user_id === authStore.user!.id)
      if (creatorIndex >= 0) {
        participants[creatorIndex].peer_id = peerId.value
        participants[creatorIndex].is_online = true
      }

      // 更新数据库中的 peer_id
      await supabase
        .from('challenges')
        .update({ participants })
        .eq('id', challengeId)

      currentChallenge.value = {
        ...challenge,
        participants
      } as Challenge

      isHost.value = true
      gameStatus.value = 'waiting'
      //console.log('Joined as host with peer_id:', peerId.value)
      return
    }

    // 检查是否已经加入
    const existingParticipant = participants.find((p: ChallengeParticipant) => p.user_id === authStore.user!.id)
    if (existingParticipant) {
      // 已经加入，更新自己的 peer_id 并连接到主机
      existingParticipant.peer_id = peerId.value
      
      // 更新数据库
      await supabase
        .from('challenges')
        .update({ participants })
        .eq('id', challengeId)

      currentChallenge.value = {
        ...challenge,
        participants
      } as Challenge
      
      // 连接到主机
      const creator = participants.find((p: ChallengeParticipant) => p.user_id === challenge.creator_id)
      if (creator?.peer_id) {
        //console.log('Connecting to host:', creator.peer_id)
        await connectToHost(creator.peer_id)
        isHost.value = false
        gameStatus.value = 'waiting'
      } else {
        throw new Error('房主不在线，请稍后再试')
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
      is_online: false, // 连接后更新
      is_ready: false,
      score: 0,
      peer_id: peerId.value,
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

    // 连接到主机
    const creator = participants.find((p: ChallengeParticipant) => p.user_id === challenge.creator_id)
    if (creator?.peer_id) {
      //console.log('Connecting to host:', creator.peer_id)
      await connectToHost(creator.peer_id)
    } else {
      throw new Error('房主不在线，请稍后再试')
    }

    isHost.value = false
    gameStatus.value = 'waiting'
  }

  async function leaveChallenge(skipConfirm = false): Promise<void> {
    if (!currentChallenge.value || !authStore.user) return

    // 如果比赛已结束，直接清理不需要其他操作
    if (currentChallenge.value.status === 'finished' || currentChallenge.value.status === 'cancelled') {
      await cleanup()
      return
    }

    // 发送离开消息
    if (!isHost.value) {
      const hostConn = connections.value.values().next().value
      if (hostConn) {
        sendMessage(hostConn, {
          type: 'leave',
          data: {},
          sender_id: authStore.user.id,
          timestamp: Date.now()
        })
      }
    }

    // 不管是创建者还是参与者，退出时只更新在线状态，不取消比赛
    // 只有明确点击"取消挑战赛"按钮才会取消
    const updatedParticipants = currentChallenge.value.participants.map(p => {
      if (p.user_id === authStore.user!.id) {
        return { ...p, is_online: false }
      }
      return p
    })

    await supabase
      .from('challenges')
      .update({ participants: updatedParticipants })
      .eq('id', currentChallenge.value.id)

    // 清理连接
    await cleanup()
  }

  async function cancelChallenge(): Promise<void> {
    if (!currentChallenge.value || !isCreator.value) return

    await supabase
      .from('challenges')
      .update({ status: 'cancelled' })
      .eq('id', currentChallenge.value.id)

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

    // 发送离开消息给主机
    if (!isHost.value) {
      const hostConn = connections.value.values().next().value
      if (hostConn) {
        sendMessage(hostConn, {
          type: 'exit_game',
          data: { user_id: userId },
          sender_id: userId,
          timestamp: Date.now()
        })
      }
    } else {
      // 如果是主机退出，处理退出逻辑
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

    //console.log('Challenge result saved successfully, status:', currentChallenge.value.status)

    // TODO: 更新赢家积分到用户账户
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

  async function cleanup(refreshList = true): Promise<void> {
    stopRoundTimer()
    
    // 关闭所有连接
    connections.value.forEach(conn => conn.close())
    connections.value.clear()

    // 销毁 peer
    if (peer.value && !peer.value.destroyed) {
      peer.value.destroy()
    }
    peer.value = null
    peerId.value = ''

    // 先刷新列表以获取最新状态（在清理本地状态之前）
    if (refreshList) {
      await loadChallenges()
    }

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
    cleanup
  }
})
