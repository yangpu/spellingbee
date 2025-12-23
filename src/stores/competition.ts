import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { useWordsStore } from './words'
import { updateUserStats } from '@/services/stats-service'
import type { Word, CompetitionRecord, IncorrectWord, CompetitionSession } from '@/types'

const SESSION_KEY = 'spellingbee_competition_session'

export const useCompetitionStore = defineStore('competition', () => {
  // State
  const isActive = ref(false)
  const currentWordIndex = ref(0)
  const words = ref<Word[]>([])
  const score = ref(0)
  const correctWords = ref<Word[]>([])
  const incorrectWords = ref<IncorrectWord[]>([])
  const timeRemaining = ref(60)
  const totalTime = ref(60)
  const startTime = ref<number | null>(null)
  const records = ref<CompetitionRecord[]>([])
  const streak = ref(0) // 连击计数

  const authStore = useAuthStore()

  // Computed
  const currentWord = computed(() => words.value[currentWordIndex.value] || null)
  const progress = computed(() => ({
    current: currentWordIndex.value + 1,
    total: words.value.length,
    percentage: words.value.length > 0 ? ((currentWordIndex.value + 1) / words.value.length) * 100 : 0
  }))
  const isFinished = computed(() => currentWordIndex.value >= words.value.length)
  const accuracy = computed(() => {
    const total = correctWords.value.length + incorrectWords.value.length
    return total > 0 ? Math.round((correctWords.value.length / total) * 100) : 0
  })
  
  // 是否有未完成的比赛（使用响应式变量追踪）
  const _hasSession = ref(!!localStorage.getItem(SESSION_KEY))
  const hasUnfinishedSession = computed(() => _hasSession.value)

  // 保存当前比赛状态
  function saveSession(userInput?: string): void {
    if (!isActive.value || words.value.length === 0) {
      return
    }
    
    // 获取当前词典信息
    const wordsStore = useWordsStore()
    const dictInfo = wordsStore.currentDictionaryInfo
    
    const session: CompetitionSession = {
      words: words.value,
      currentWordIndex: currentWordIndex.value,
      score: score.value,
      correctWords: correctWords.value,
      incorrectWords: incorrectWords.value,
      timeRemaining: timeRemaining.value,
      totalTime: totalTime.value,
      startTime: startTime.value,
      streak: streak.value,
      savedAt: Date.now(),
      userInput: userInput || '',
      dictionaryId: dictInfo?.id || '',
      dictionaryName: dictInfo?.name || ''
    }
    
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    _hasSession.value = true
  }

  // 获取保存的会话数据（不恢复状态）
  function getSavedSession(): CompetitionSession | null {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (!saved) return null
      
      const session = JSON.parse(saved) as CompetitionSession
      
      // 检查会话是否过期（超过24小时）
      if (Date.now() - session.savedAt > 24 * 60 * 60 * 1000) {
        clearSession()
        return null
      }
      
      return session
    } catch (e) {
      console.error('Error getting saved session:', e)
      return null
    }
  }

  // 恢复未完成的比赛
  function restoreSession(): CompetitionSession | null {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (!saved) return null
      
      const session = JSON.parse(saved) as CompetitionSession
      
      // 检查会话是否过期（超过24小时）
      if (Date.now() - session.savedAt > 24 * 60 * 60 * 1000) {
        clearSession()
        return null
      }
      
      // 恢复状态
      words.value = session.words
      currentWordIndex.value = session.currentWordIndex
      score.value = session.score
      correctWords.value = session.correctWords || []
      incorrectWords.value = session.incorrectWords || []
      timeRemaining.value = session.timeRemaining
      totalTime.value = session.totalTime
      startTime.value = Date.now()
      streak.value = session.streak || 0
      isActive.value = true
      
      return session
    } catch (e) {
      console.error('Error restoring competition session:', e)
      clearSession()
      return null
    }
  }

  // 清除保存的会话
  function clearSession(): void {
    localStorage.removeItem(SESSION_KEY)
    _hasSession.value = false
  }

  // 获取会话词典名称
  function getSessionDictionaryName(): string {
    const session = getSavedSession()
    return session?.dictionaryName || ''
  }

  // Start competition
  function startCompetition(wordList: Word[], timeLimit = 60): void {
    words.value = wordList
    currentWordIndex.value = 0
    score.value = 0
    correctWords.value = []
    incorrectWords.value = []
    timeRemaining.value = timeLimit
    totalTime.value = timeLimit
    startTime.value = Date.now()
    streak.value = 0
    isActive.value = true
    
    // 保存会话
    saveSession()
  }

  // Check answer - 新计分规则
  // 基础分：10分
  // 难度加成：难度1-5分别 +0/+2/+4/+6/+8 分
  // 速度奖励：剩余时间每10秒 +1 分
  // 连击奖励：连续答对每次 +1 分（2连+1，3连+2...）
  // 全对奖励：在 endCompetition 中计算，+20% 总分
  function checkAnswer(userInput: string): boolean | null {
    if (!currentWord.value) return null

    const isCorrect = userInput.toLowerCase().trim() === currentWord.value.word.toLowerCase()
    
    if (isCorrect) {
      correctWords.value.push(currentWord.value)
      streak.value++
      
      // 基础分 10 分
      let wordScore = 10
      
      // 难度加成：难度1-5分别 +0/+2/+4/+6/+8 分
      const difficulty = currentWord.value.difficulty || 1
      const difficultyBonus = (difficulty - 1) * 2
      wordScore += difficultyBonus
      
      // 速度奖励：剩余时间每10秒 +1 分
      const timeBonus = Math.floor(timeRemaining.value / 10)
      wordScore += timeBonus
      
      // 连击奖励：连续答对每次 +1 分（2连+1，3连+2...）
      if (streak.value >= 2) {
        const streakBonus = streak.value - 1
        wordScore += streakBonus
      }
      
      score.value += wordScore
    } else {
      incorrectWords.value.push({
        ...currentWord.value,
        userAnswer: userInput
      })
      streak.value = 0 // 答错重置连击
    }
    
    // 保存会话
    saveSession()

    return isCorrect
  }

  // Next word
  function nextWord(): boolean {
    if (currentWordIndex.value < words.value.length - 1) {
      currentWordIndex.value++
      timeRemaining.value = totalTime.value
      // 保存会话
      saveSession()
      return true
    }
    return false
  }

  // Skip word (counts as incorrect)
  function skipWord(): boolean {
    if (currentWord.value) {
      incorrectWords.value.push({
        ...currentWord.value,
        userAnswer: '[跳过]'
      })
      streak.value = 0 // 跳过重置连击
    }
    const result = nextWord()
    // 保存会话
    saveSession()
    return result
  }

  // Update timer
  function updateTimer(): boolean {
    if (timeRemaining.value > 0) {
      timeRemaining.value--
      return true
    }
    return false
  }

  // Time out - word is incorrect
  function timeOut(): void {
    if (currentWord.value) {
      incorrectWords.value.push({
        ...currentWord.value,
        userAnswer: '[超时]'
      })
      streak.value = 0 // 超时重置连击
    }
  }

  // End competition
  async function endCompetition(): Promise<CompetitionRecord> {
    isActive.value = false
    // 清除保存的会话
    clearSession()
    
    const duration = Math.floor((Date.now() - (startTime.value || Date.now())) / 1000)
    
    // 全对奖励：+20% 总分
    let finalScore = score.value
    const isPerfect = incorrectWords.value.length === 0 && correctWords.value.length === words.value.length
    if (isPerfect && correctWords.value.length > 0) {
      const perfectBonus = Math.round(score.value * 0.2)
      finalScore += perfectBonus
    }

    const record: CompetitionRecord = {
      id: crypto.randomUUID(),
      score: finalScore,
      total_words: words.value.length,
      correct_words: correctWords.value.length,
      correct_words_list: correctWords.value.map(w => w.word),
      incorrect_words: incorrectWords.value.map(w => w.word),
      incorrect_words_detail: incorrectWords.value.map(w => ({
        word: w.word,
        userAnswer: w.userAnswer || ''
      })),
      accuracy: accuracy.value,
      duration,
      created_at: new Date().toISOString(),
      dictionary_name: useWordsStore().currentDictionaryInfo?.name
    }

    // Save to Supabase if logged in
    if (authStore.user) {
      try {
        const { error } = await supabase.from('competition_records').insert({
          ...record,
          user_id: authStore.user.id
        })
        if (error) {
          console.error('Supabase insert error:', error.message, error.details, error.hint)
        }
        
        // 更新用户统计
        updateUserStats('competition', {
          score: finalScore,
          total_words: words.value.length,
          correct_words: correctWords.value.length,
          accuracy: accuracy.value
        })
      } catch (error) {
        console.error('Error saving record:', error)
      }
    }

    // Save to local records
    records.value.unshift(record)
    saveRecordsToLocalStorage()

    return record
  }

  // Pause competition (exit without clearing session)
  function pauseCompetition(userInput?: string): void {
    // 先保存当前进度（带用户输入）
    saveSession(userInput)
    // 只设置 isActive 为 false，保留其他状态和会话数据
    isActive.value = false
  }

  // Reset competition
  function resetCompetition(): void {
    isActive.value = false
    currentWordIndex.value = 0
    words.value = []
    score.value = 0
    correctWords.value = []
    incorrectWords.value = []
    timeRemaining.value = 60
    startTime.value = null
    streak.value = 0
    // 清除保存的会话
    clearSession()
  }

  // Load records
  async function loadRecords(): Promise<void> {
    // Load from local storage first
    loadRecordsFromLocalStorage()

    // Load from Supabase if logged in
    if (authStore.user) {
      try {
        const { data, error } = await supabase
          .from('competition_records')
          .select('*')
          .eq('user_id', authStore.user.id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (!error && data) {
          // Merge with local records
          const localIds = new Set(records.value.map(r => r.id))
          const newRecords = (data as CompetitionRecord[]).filter(r => !localIds.has(r.id))
          records.value = [...newRecords, ...records.value]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 50)
          // Save merged records to local storage
          saveRecordsToLocalStorage()
        }
      } catch (error) {
        console.error('Error loading records:', error)
      }
    }
  }

  // Local storage
  function loadRecordsFromLocalStorage(): void {
    const stored = localStorage.getItem('spellingbee_records')
    if (stored) {
      try {
        records.value = JSON.parse(stored)
      } catch (e) {
        console.error('Error parsing stored records:', e)
      }
    }
  }

  function saveRecordsToLocalStorage(): void {
    localStorage.setItem('spellingbee_records', JSON.stringify(records.value.slice(0, 50)))
  }

  // Statistics
  const stats = computed(() => {
    if (records.value.length === 0) {
      return {
        totalGames: 0,
        totalWords: 0,
        totalCorrect: 0,
        averageScore: 0,
        averageAccuracy: 0,
        bestScore: 0,
        bestAccuracy: 0
      }
    }

    const totalGames = records.value.length
    const totalWords = records.value.reduce((sum, r) => sum + r.total_words, 0)
    const totalCorrect = records.value.reduce((sum, r) => sum + r.correct_words, 0)
    const averageScore = Math.round(records.value.reduce((sum, r) => sum + r.score, 0) / totalGames)
    const averageAccuracy = Math.round(records.value.reduce((sum, r) => sum + r.accuracy, 0) / totalGames)
    const bestScore = Math.max(...records.value.map(r => r.score))
    const bestAccuracy = Math.max(...records.value.map(r => r.accuracy))

    return {
      totalGames,
      totalWords,
      totalCorrect,
      averageScore,
      averageAccuracy,
      bestScore,
      bestAccuracy
    }
  })

  // Clear all competition records
  async function clearAllRecords(): Promise<void> {
    // Clear local records
    records.value = []
    localStorage.removeItem('spellingbee_records')

    // Clear cloud records if logged in
    if (authStore.user) {
      try {
        await supabase.from('competition_records').delete().eq('user_id', authStore.user.id)
      } catch (error) {
        console.error('Error clearing cloud competition records:', error)
      }
    }
  }

  return {
    // State
    isActive,
    currentWordIndex,
    words,
    score,
    correctWords,
    incorrectWords,
    timeRemaining,
    totalTime,
    records,
    streak,
    // Computed
    currentWord,
    progress,
    isFinished,
    accuracy,
    stats,
    hasUnfinishedSession,
    // Actions
    startCompetition,
    checkAnswer,
    nextWord,
    skipWord,
    updateTimer,
    timeOut,
    endCompetition,
    pauseCompetition,
    resetCompetition,
    loadRecords,
    saveSession,
    getSavedSession,
    restoreSession,
    clearSession,
    getSessionDictionaryName,
    clearAllRecords
  }
})
