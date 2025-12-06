import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'

const SESSION_KEY = 'spellingbee_competition_session'

export const useCompetitionStore = defineStore('competition', () => {
  // State
  const isActive = ref(false)
  const currentWordIndex = ref(0)
  const words = ref([])
  const score = ref(0)
  const correctWords = ref([])
  const incorrectWords = ref([])
  const timeRemaining = ref(60)
  const totalTime = ref(60)
  const startTime = ref(null)
  const records = ref([])

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
  
  // 是否有未完成的比赛
  const hasUnfinishedSession = computed(() => {
    const saved = localStorage.getItem(SESSION_KEY)
    return !!saved
  })

  // 保存当前比赛状态
  function saveSession() {
    if (!isActive.value || words.value.length === 0) return
    
    const session = {
      words: words.value,
      currentWordIndex: currentWordIndex.value,
      score: score.value,
      correctWords: correctWords.value,
      incorrectWords: incorrectWords.value,
      timeRemaining: timeRemaining.value,
      totalTime: totalTime.value,
      startTime: startTime.value,
      savedAt: Date.now()
    }
    
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }

  // 恢复未完成的比赛
  function restoreSession() {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (!saved) return null
      
      const session = JSON.parse(saved)
      
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
      timeRemaining.value = session.totalTime // 重置时间，给用户完整时间
      totalTime.value = session.totalTime
      startTime.value = Date.now()
      isActive.value = true
      
      return session
    } catch (e) {
      console.error('Error restoring competition session:', e)
      clearSession()
      return null
    }
  }

  // 清除保存的会话
  function clearSession() {
    localStorage.removeItem(SESSION_KEY)
  }

  // Start competition
  function startCompetition(wordList, timeLimit = 60) {
    words.value = wordList
    currentWordIndex.value = 0
    score.value = 0
    correctWords.value = []
    incorrectWords.value = []
    timeRemaining.value = timeLimit
    totalTime.value = timeLimit
    startTime.value = Date.now()
    isActive.value = true
    
    // 保存会话
    saveSession()
  }

  // Check answer
  function checkAnswer(userInput) {
    if (!currentWord.value) return null

    const isCorrect = userInput.toLowerCase().trim() === currentWord.value.word.toLowerCase()
    
    if (isCorrect) {
      correctWords.value.push(currentWord.value)
      // Score based on difficulty and time remaining
      const timeBonus = Math.floor(timeRemaining.value / 10)
      const difficultyBonus = currentWord.value.difficulty * 10
      score.value += 10 + timeBonus + difficultyBonus
    } else {
      incorrectWords.value.push({
        ...currentWord.value,
        userAnswer: userInput
      })
    }
    
    // 保存会话
    saveSession()

    return isCorrect
  }

  // Next word
  function nextWord() {
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
  function skipWord() {
    if (currentWord.value) {
      incorrectWords.value.push({
        ...currentWord.value,
        userAnswer: '[跳过]'
      })
    }
    const result = nextWord()
    // 保存会话
    saveSession()
    return result
  }

  // Update timer
  function updateTimer() {
    if (timeRemaining.value > 0) {
      timeRemaining.value--
      return true
    }
    return false
  }

  // Time out - word is incorrect
  function timeOut() {
    if (currentWord.value) {
      incorrectWords.value.push({
        ...currentWord.value,
        userAnswer: '[超时]'
      })
    }
  }

  // End competition
  async function endCompetition() {
    isActive.value = false
    // 清除保存的会话
    clearSession()
    
    const duration = Math.floor((Date.now() - startTime.value) / 1000)

    const record = {
      id: crypto.randomUUID(),
      score: score.value,
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
      created_at: new Date().toISOString()
    }

    // Save to Supabase if logged in
    if (authStore.user) {
      try {
        await supabase.from('competition_records').insert({
          ...record,
          user_id: authStore.user.id
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

  // Reset competition
  function resetCompetition() {
    isActive.value = false
    currentWordIndex.value = 0
    words.value = []
    score.value = 0
    correctWords.value = []
    incorrectWords.value = []
    timeRemaining.value = 60
    startTime.value = null
    // 清除保存的会话
    clearSession()
  }

  // Load records
  async function loadRecords() {
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
          const newRecords = data.filter(r => !localIds.has(r.id))
          records.value = [...newRecords, ...records.value]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 50)
        }
      } catch (error) {
        console.error('Error loading records:', error)
      }
    }
  }

  // Local storage
  function loadRecordsFromLocalStorage() {
    const stored = localStorage.getItem('spellingbee_records')
    if (stored) {
      try {
        records.value = JSON.parse(stored)
      } catch (e) {
        console.error('Error parsing stored records:', e)
      }
    }
  }

  function saveRecordsToLocalStorage() {
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
    resetCompetition,
    loadRecords,
    saveSession,
    restoreSession,
    clearSession
  }
})

