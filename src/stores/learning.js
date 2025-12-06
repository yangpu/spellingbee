import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'

export const useLearningStore = defineStore('learning', () => {
  const authStore = useAuthStore()
  
  // State
  const learningRecords = ref([])
  const wordProgress = ref({}) // { word: { correct_count, incorrect_count, mastery_level, ... } }
  const loading = ref(false)
  const syncing = ref(false)

  // Computed
  // 已掌握的单词：mastery_level >= 2（至少连续正确2次）
  const masteredWords = computed(() => {
    return Object.entries(wordProgress.value)
      .filter(([_, progress]) => progress.mastery_level >= 2)
      .map(([word]) => word)
  })

  // 待复习的单词：mastery_level < 2 或者复习时间已到
  const wordsToReview = computed(() => {
    const now = new Date()
    return Object.entries(wordProgress.value)
      .filter(([_, progress]) => {
        // 还未掌握的单词（mastery_level < 2）需要复习
        if (progress.mastery_level < 2) return true
        // 复习时间已到的单词也需要复习
        if (progress.next_review_at && new Date(progress.next_review_at) <= now) return true
        return false
      })
      .map(([word]) => word)
  })

  const totalLearned = computed(() => Object.keys(wordProgress.value).length)
  
  // 学习中的单词（已学但未掌握）
  const learningWords = computed(() => {
    return Object.entries(wordProgress.value)
      .filter(([_, progress]) => progress.mastery_level < 2)
      .map(([word]) => word)
  })

  const stats = computed(() => {
    const records = learningRecords.value
    if (records.length === 0) {
      return {
        totalPracticed: 0,
        totalCorrect: 0,
        totalIncorrect: 0,
        accuracy: 0,
        todayPracticed: 0,
        todayCorrect: 0
      }
    }

    const today = new Date().toDateString()
    const todayRecords = records.filter(r => new Date(r.created_at).toDateString() === today)

    return {
      totalPracticed: records.length,
      totalCorrect: records.filter(r => r.is_correct).length,
      totalIncorrect: records.filter(r => !r.is_correct).length,
      accuracy: Math.round((records.filter(r => r.is_correct).length / records.length) * 100),
      todayPracticed: todayRecords.length,
      todayCorrect: todayRecords.filter(r => r.is_correct).length
    }
  })

  // Initialize
  async function init() {
    loadFromLocalStorage()
    if (authStore.user) {
      await syncFromCloud()
    }
  }

  // Record a learning attempt
  async function recordLearning(word, isCorrect, userAnswer = '', studyMode = 'learn') {
    const record = {
      id: crypto.randomUUID(),
      word,
      is_correct: isCorrect,
      user_answer: userAnswer,
      study_mode: studyMode,
      created_at: new Date().toISOString()
    }

    // Add to local records
    learningRecords.value.unshift(record)
    
    // Update word progress
    updateWordProgress(word, isCorrect)

    // Save to local storage
    saveToLocalStorage()

    // Sync to cloud if logged in
    if (authStore.user) {
      try {
        await supabase.from('learning_records').insert({
          ...record,
          user_id: authStore.user.id
        })
      } catch (error) {
        console.error('Error saving learning record:', error)
      }
    }

    return record
  }

  // Update word progress with spaced repetition logic
  function updateWordProgress(word, isCorrect) {
    const existing = wordProgress.value[word] || {
      correct_count: 0,
      incorrect_count: 0,
      mastery_level: 0,
      last_practiced_at: null,
      next_review_at: null
    }

    const now = new Date()
    
    if (isCorrect) {
      existing.correct_count++
      // Increase mastery level (max 5)
      existing.mastery_level = Math.min(5, existing.mastery_level + 1)
    } else {
      existing.incorrect_count++
      // Decrease mastery level (min 0)
      existing.mastery_level = Math.max(0, existing.mastery_level - 1)
    }

    existing.last_practiced_at = now.toISOString()
    
    // Calculate next review time based on mastery level (spaced repetition)
    const intervals = [1, 2, 4, 7, 14, 30] // days
    const intervalDays = intervals[existing.mastery_level] || 30
    const nextReview = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000)
    existing.next_review_at = nextReview.toISOString()

    wordProgress.value[word] = existing

    // Sync to cloud if logged in
    if (authStore.user) {
      syncWordProgressToCloud(word, existing)
    }
  }

  // Sync word progress to cloud
  async function syncWordProgressToCloud(word, progress) {
    try {
      await supabase.from('user_word_progress').upsert({
        user_id: authStore.user.id,
        word,
        correct_count: progress.correct_count,
        incorrect_count: progress.incorrect_count,
        mastery_level: progress.mastery_level,
        last_practiced_at: progress.last_practiced_at,
        next_review_at: progress.next_review_at,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,word'
      })
    } catch (error) {
      console.error('Error syncing word progress:', error)
    }
  }

  // Sync from cloud
  async function syncFromCloud() {
    if (!authStore.user) return
    
    syncing.value = true
    try {
      // Fetch learning records
      const { data: records, error: recordsError } = await supabase
        .from('learning_records')
        .select('*')
        .eq('user_id', authStore.user.id)
        .order('created_at', { ascending: false })
        .limit(500)

      if (!recordsError && records) {
        // Merge with local records
        const localIds = new Set(learningRecords.value.map(r => r.id))
        const newRecords = records.filter(r => !localIds.has(r.id))
        learningRecords.value = [...newRecords, ...learningRecords.value]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 500)
      }

      // Fetch word progress
      const { data: progress, error: progressError } = await supabase
        .from('user_word_progress')
        .select('*')
        .eq('user_id', authStore.user.id)

      if (!progressError && progress) {
        // Merge with local progress (cloud takes precedence)
        progress.forEach(p => {
          const local = wordProgress.value[p.word]
          if (!local || new Date(p.updated_at) > new Date(local.updated_at || 0)) {
            wordProgress.value[p.word] = {
              correct_count: p.correct_count,
              incorrect_count: p.incorrect_count,
              mastery_level: p.mastery_level,
              last_practiced_at: p.last_practiced_at,
              next_review_at: p.next_review_at,
              updated_at: p.updated_at
            }
          }
        })
      }

      saveToLocalStorage()
    } catch (error) {
      console.error('Error syncing from cloud:', error)
    } finally {
      syncing.value = false
    }
  }

  // Get word progress
  function getWordProgress(word) {
    return wordProgress.value[word] || null
  }

  // Get words that need review
  function getWordsForReview(count = 10) {
    const now = new Date()
    const reviewWords = Object.entries(wordProgress.value)
      .filter(([_, progress]) => {
        if (!progress.next_review_at) return true
        return new Date(progress.next_review_at) <= now
      })
      .sort((a, b) => {
        // Prioritize words with lower mastery and older review dates
        const aScore = a[1].mastery_level * 100 + (a[1].next_review_at ? new Date(a[1].next_review_at).getTime() : 0)
        const bScore = b[1].mastery_level * 100 + (b[1].next_review_at ? new Date(b[1].next_review_at).getTime() : 0)
        return aScore - bScore
      })
      .slice(0, count)
      .map(([word]) => word)

    return reviewWords
  }

  // Local storage
  function loadFromLocalStorage() {
    try {
      const storedRecords = localStorage.getItem('spellingbee_learning_records')
      if (storedRecords) {
        learningRecords.value = JSON.parse(storedRecords)
      }

      const storedProgress = localStorage.getItem('spellingbee_word_progress')
      if (storedProgress) {
        wordProgress.value = JSON.parse(storedProgress)
      }
    } catch (e) {
      console.error('Error loading from local storage:', e)
    }
  }

  function saveToLocalStorage() {
    localStorage.setItem('spellingbee_learning_records', JSON.stringify(learningRecords.value.slice(0, 500)))
    localStorage.setItem('spellingbee_word_progress', JSON.stringify(wordProgress.value))
  }

  // Clear all data
  async function clearAllData() {
    learningRecords.value = []
    wordProgress.value = {}
    saveToLocalStorage()

    if (authStore.user) {
      try {
        await supabase.from('learning_records').delete().eq('user_id', authStore.user.id)
        await supabase.from('user_word_progress').delete().eq('user_id', authStore.user.id)
      } catch (error) {
        console.error('Error clearing cloud data:', error)
      }
    }
  }

  return {
    // State
    learningRecords,
    wordProgress,
    loading,
    syncing,
    // Computed
    masteredWords,
    wordsToReview,
    learningWords,
    totalLearned,
    stats,
    // Actions
    init,
    recordLearning,
    getWordProgress,
    getWordsForReview,
    syncFromCloud,
    clearAllData
  }
})
