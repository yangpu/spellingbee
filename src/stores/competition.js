import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'

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

    return isCorrect
  }

  // Next word
  function nextWord() {
    if (currentWordIndex.value < words.value.length - 1) {
      currentWordIndex.value++
      timeRemaining.value = totalTime.value
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
    return nextWord()
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
    const duration = Math.floor((Date.now() - startTime.value) / 1000)

    const record = {
      id: crypto.randomUUID(),
      score: score.value,
      total_words: words.value.length,
      correct_words: correctWords.value.length,
      incorrect_words: incorrectWords.value.map(w => w.word),
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
    // Actions
    startCompetition,
    checkAnswer,
    nextWord,
    skipWord,
    updateTimer,
    timeOut,
    endCompetition,
    resetCompetition,
    loadRecords
  }
})

