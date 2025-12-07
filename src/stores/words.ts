import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import type { Word } from '@/types'

// Default word list for offline/demo mode
const defaultWords: Word[] = [
  { id: '1', word: 'abandon', pronunciation: '/əˈbændən/', definition: 'to leave someone or something completely', definition_cn: '放弃；抛弃', part_of_speech: 'verb', example_sentence: 'The ship was abandoned by its crew.', difficulty: 2, category: 'basic' },
  { id: '2', word: 'brilliant', pronunciation: '/ˈbrɪliənt/', definition: 'very bright, intelligent, or successful', definition_cn: '聪明的；杰出的；明亮的', part_of_speech: 'adjective', example_sentence: 'She had a brilliant idea.', difficulty: 2, category: 'basic' },
  { id: '3', word: 'calculate', pronunciation: '/ˈkælkjuleɪt/', definition: 'to find an answer using numbers', definition_cn: '计算；估计', part_of_speech: 'verb', example_sentence: 'Can you calculate the total cost?', difficulty: 2, category: 'basic' },
  { id: '4', word: 'democracy', pronunciation: '/dɪˈmɒkrəsi/', definition: 'a system of government by the whole population', definition_cn: '民主；民主制度', part_of_speech: 'noun', example_sentence: 'Democracy allows citizens to vote.', difficulty: 3, category: 'social' },
  { id: '5', word: 'enthusiasm', pronunciation: '/ɪnˈθjuːziæzəm/', definition: 'intense enjoyment or interest', definition_cn: '热情；热忱', part_of_speech: 'noun', example_sentence: 'He showed great enthusiasm for the project.', difficulty: 3, category: 'emotion' },
  { id: '6', word: 'fascinating', pronunciation: '/ˈfæsɪneɪtɪŋ/', definition: 'extremely interesting', definition_cn: '迷人的；极有吸引力的', part_of_speech: 'adjective', example_sentence: 'The documentary was fascinating.', difficulty: 3, category: 'emotion' },
  { id: '7', word: 'guarantee', pronunciation: '/ˌɡærənˈtiː/', definition: 'a formal promise or assurance', definition_cn: '保证；担保', part_of_speech: 'noun', example_sentence: 'The product comes with a guarantee.', difficulty: 3, category: 'business' },
  { id: '8', word: 'hypothesis', pronunciation: '/haɪˈpɒθəsɪs/', definition: 'a proposed explanation for a phenomenon', definition_cn: '假设；假说', part_of_speech: 'noun', example_sentence: 'Scientists test their hypothesis through experiments.', difficulty: 4, category: 'science' },
  { id: '9', word: 'immediately', pronunciation: '/ɪˈmiːdiətli/', definition: 'at once; instantly', definition_cn: '立即；马上', part_of_speech: 'adverb', example_sentence: 'Please respond immediately.', difficulty: 3, category: 'basic' },
  { id: '10', word: 'jurisdiction', pronunciation: '/ˌdʒʊərɪsˈdɪkʃn/', definition: 'the official power to make legal decisions', definition_cn: '司法权；管辖权', part_of_speech: 'noun', example_sentence: 'This matter falls outside our jurisdiction.', difficulty: 4, category: 'legal' },
  { id: '11', word: 'knowledge', pronunciation: '/ˈnɒlɪdʒ/', definition: 'facts, information, and skills acquired', definition_cn: '知识；学问', part_of_speech: 'noun', example_sentence: 'Knowledge is power.', difficulty: 2, category: 'basic' },
  { id: '12', word: 'laboratory', pronunciation: '/ləˈbɒrətri/', definition: 'a room for scientific experiments', definition_cn: '实验室', part_of_speech: 'noun', example_sentence: 'The scientists worked in the laboratory.', difficulty: 3, category: 'science' },
  { id: '13', word: 'magnificent', pronunciation: '/mæɡˈnɪfɪsnt/', definition: 'extremely beautiful or impressive', definition_cn: '壮丽的；宏伟的', part_of_speech: 'adjective', example_sentence: 'The view from the mountain was magnificent.', difficulty: 3, category: 'emotion' },
  { id: '14', word: 'necessary', pronunciation: '/ˈnesəsəri/', definition: 'required to be done; essential', definition_cn: '必要的；必需的', part_of_speech: 'adjective', example_sentence: 'It is necessary to complete the form.', difficulty: 3, category: 'basic' },
  { id: '15', word: 'occurrence', pronunciation: '/əˈkʌrəns/', definition: 'an incident or event', definition_cn: '发生；事件', part_of_speech: 'noun', example_sentence: 'Such occurrences are rare.', difficulty: 4, category: 'basic' },
  { id: '16', word: 'phenomenon', pronunciation: '/fɪˈnɒmɪnən/', definition: 'a fact or situation that is observed', definition_cn: '现象；奇迹', part_of_speech: 'noun', example_sentence: 'The northern lights are a beautiful phenomenon.', difficulty: 4, category: 'science' },
  { id: '17', word: 'questionnaire', pronunciation: '/ˌkwestʃəˈneə/', definition: 'a set of written questions', definition_cn: '问卷；调查表', part_of_speech: 'noun', example_sentence: 'Please complete this questionnaire.', difficulty: 4, category: 'basic' },
  { id: '18', word: 'recommend', pronunciation: '/ˌrekəˈmend/', definition: 'to suggest something is good or suitable', definition_cn: '推荐；建议', part_of_speech: 'verb', example_sentence: 'I recommend this restaurant.', difficulty: 3, category: 'basic' },
  { id: '19', word: 'sophisticated', pronunciation: '/səˈfɪstɪkeɪtɪd/', definition: 'complex and refined', definition_cn: '复杂的；精致的；老练的', part_of_speech: 'adjective', example_sentence: 'She has a sophisticated taste in art.', difficulty: 4, category: 'emotion' },
  { id: '20', word: 'temperature', pronunciation: '/ˈtemprətʃə/', definition: 'the degree of heat or cold', definition_cn: '温度；体温', part_of_speech: 'noun', example_sentence: 'The temperature dropped below zero.', difficulty: 3, category: 'science' },
  { id: '21', word: 'unanimous', pronunciation: '/juːˈnænɪməs/', definition: 'fully in agreement', definition_cn: '一致同意的；全体一致的', part_of_speech: 'adjective', example_sentence: 'The decision was unanimous.', difficulty: 4, category: 'basic' },
  { id: '22', word: 'vocabulary', pronunciation: '/vəˈkæbjələri/', definition: 'the body of words used in a language', definition_cn: '词汇；词汇量', part_of_speech: 'noun', example_sentence: 'Reading helps expand your vocabulary.', difficulty: 3, category: 'basic' },
  { id: '23', word: 'weather', pronunciation: '/ˈweðə/', definition: 'the state of the atmosphere', definition_cn: '天气；气候', part_of_speech: 'noun', example_sentence: 'The weather is nice today.', difficulty: 2, category: 'basic' },
  { id: '24', word: 'xylophone', pronunciation: '/ˈzaɪləfəʊn/', definition: 'a musical instrument', definition_cn: '木琴', part_of_speech: 'noun', example_sentence: 'She plays the xylophone.', difficulty: 4, category: 'music' },
  { id: '25', word: 'yesterday', pronunciation: '/ˈjestədeɪ/', definition: 'the day before today', definition_cn: '昨天', part_of_speech: 'noun', example_sentence: 'I saw him yesterday.', difficulty: 1, category: 'basic' },
  { id: '26', word: 'zealous', pronunciation: '/ˈzeləs/', definition: 'having great energy or enthusiasm', definition_cn: '热情的；狂热的', part_of_speech: 'adjective', example_sentence: 'She was a zealous supporter.', difficulty: 4, category: 'emotion' },
  { id: '27', word: 'acquaintance', pronunciation: '/əˈkweɪntəns/', definition: 'a person one knows slightly', definition_cn: '熟人；相识的人', part_of_speech: 'noun', example_sentence: 'He is an acquaintance from work.', difficulty: 4, category: 'social' },
  { id: '28', word: 'bureaucracy', pronunciation: '/bjʊəˈrɒkrəsi/', definition: 'a system of government with many rules', definition_cn: '官僚主义；官僚机构', part_of_speech: 'noun', example_sentence: 'The bureaucracy slowed down the process.', difficulty: 5, category: 'social' },
  { id: '29', word: 'conscience', pronunciation: '/ˈkɒnʃəns/', definition: 'a moral sense of right and wrong', definition_cn: '良心；良知', part_of_speech: 'noun', example_sentence: 'His conscience troubled him.', difficulty: 4, category: 'emotion' },
  { id: '30', word: 'descendant', pronunciation: '/dɪˈsendənt/', definition: 'a person descended from an ancestor', definition_cn: '后代；子孙', part_of_speech: 'noun', example_sentence: 'She is a descendant of royalty.', difficulty: 4, category: 'social' }
]

interface WordList {
  name: string
  label: string
  category: string
}

export const useWordsStore = defineStore('words', () => {
  const words = ref<Word[]>([])
  const userWords = ref<Word[]>([])
  const loading = ref(false)
  const useLocalStorage = ref(true)

  const authStore = useAuthStore()

  // Computed
  const wordCount = computed(() => words.value.length)

  const wordsByDifficulty = computed(() => {
    const grouped: Record<number, Word[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] }
    words.value.forEach(word => {
      if (grouped[word.difficulty]) {
        grouped[word.difficulty].push(word)
      }
    })
    return grouped
  })

  const wordsByCategory = computed(() => {
    const grouped: Record<string, Word[]> = {}
    words.value.forEach(word => {
      const category = word.category || 'uncategorized'
      if (!grouped[category]) {
        grouped[category] = []
      }
      grouped[category].push(word)
    })
    return grouped
  })

  // Initialize words
  async function init(): Promise<void> {
    loading.value = true
    try {
      // Try to load from Supabase first
      if (authStore.user) {
        await fetchWordsFromSupabase()
      }

      // If no words loaded, use local storage or default
      if (words.value.length === 0) {
        loadFromLocalStorage()
      }

      // If still no words, load grade3 word list as default
      if (words.value.length === 0) {
        try {
          await replaceWithWordList('grade3-400')
        } catch (e) {
          // Fallback to default words if grade3 list fails to load
          console.error('Failed to load grade3 word list, using defaults:', e)
          words.value = [...defaultWords]
          saveToLocalStorage()
        }
      }
    } catch (error) {
      console.error('Error initializing words:', error)
      // Fallback to local storage
      loadFromLocalStorage()
      if (words.value.length === 0) {
        words.value = [...defaultWords]
      }
    } finally {
      loading.value = false
    }
  }

  // Fetch from Supabase
  async function fetchWordsFromSupabase(): Promise<void> {
    const { data, error } = await supabase
      .from('words')
      .select('*')
      .order('word')

    if (error) throw error
    if (data && data.length > 0) {
      words.value = data as Word[]
      useLocalStorage.value = false
    }
  }

  // Local storage operations
  function loadFromLocalStorage(): void {
    const stored = localStorage.getItem('spellingbee_words')
    if (stored) {
      try {
        words.value = JSON.parse(stored)
      } catch (e) {
        console.error('Error parsing stored words:', e)
      }
    }
  }

  function saveToLocalStorage(): void {
    localStorage.setItem('spellingbee_words', JSON.stringify(words.value))
  }

  // CRUD operations
  async function addWord(wordData: Omit<Word, 'id' | 'created_at'>): Promise<Word> {
    const newWord: Word = {
      id: crypto.randomUUID(),
      ...wordData,
      created_at: new Date().toISOString()
    }

    if (!useLocalStorage.value && authStore.user) {
      const { data, error } = await supabase
        .from('words')
        .insert(newWord)
        .select()
        .single()

      if (error) throw error
      words.value.push(data as Word)
      return data as Word
    } else {
      words.value.push(newWord)
      saveToLocalStorage()
      return newWord
    }
  }

  async function updateWord(id: string, updates: Partial<Word>): Promise<void> {
    if (!useLocalStorage.value && authStore.user) {
      const { data, error } = await supabase
        .from('words')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      const index = words.value.findIndex(w => w.id === id)
      if (index !== -1) {
        words.value[index] = data as Word
      }
    } else {
      const index = words.value.findIndex(w => w.id === id)
      if (index !== -1) {
        words.value[index] = { ...words.value[index], ...updates }
        saveToLocalStorage()
      }
    }
  }

  async function deleteWord(id: string): Promise<void> {
    if (!useLocalStorage.value && authStore.user) {
      const { error } = await supabase
        .from('words')
        .delete()
        .eq('id', id)

      if (error) throw error
    }

    words.value = words.value.filter(w => w.id !== id)
    saveToLocalStorage()
  }

  // Import words from JSON
  async function importWords(wordsData: Partial<Word>[]): Promise<number> {
    const newWords: Word[] = wordsData.map(w => ({
      id: w.id || crypto.randomUUID(),
      word: w.word || '',
      pronunciation: w.pronunciation || '',
      definition: w.definition || '',
      definition_cn: w.definition_cn || '',
      part_of_speech: w.part_of_speech || '',
      example_sentence: w.example_sentence || '',
      difficulty: w.difficulty || 3,
      category: w.category || 'imported',
      created_at: new Date().toISOString()
    }))

    if (!useLocalStorage.value && authStore.user) {
      const { error } = await supabase
        .from('words')
        .upsert(newWords)
        .select()

      if (error) throw error
      // Refresh words list
      await fetchWordsFromSupabase()
    } else {
      // Merge with existing words, avoid duplicates
      const existingWords = new Set(words.value.map(w => w.word.toLowerCase()))
      const uniqueNewWords = newWords.filter(w => !existingWords.has(w.word.toLowerCase()))
      words.value = [...words.value, ...uniqueNewWords]
      saveToLocalStorage()
    }

    return newWords.length
  }

  // Export words to JSON
  function exportWords(): string {
    return JSON.stringify(words.value, null, 2)
  }

  // Get random words for practice/competition
  function getRandomWords(count = 10, difficulty: number | null = null): Word[] {
    let filtered = [...words.value]

    if (difficulty !== null) {
      filtered = filtered.filter(w => w.difficulty === difficulty)
    }

    // Fisher-Yates shuffle
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[filtered[i], filtered[j]] = [filtered[j], filtered[i]]
    }

    return filtered.slice(0, count)
  }

  // Get word by ID
  function getWordById(id: string): Word | undefined {
    return words.value.find(w => w.id === id)
  }

  // Search words
  function searchWords(query: string): Word[] {
    const q = query.toLowerCase()
    return words.value.filter(w =>
      w.word.toLowerCase().includes(q) ||
      w.definition.toLowerCase().includes(q)
    )
  }

  // Load word list from JSON file
  async function loadWordList(listName: string): Promise<number> {
    loading.value = true
    try {
      const baseUrl = import.meta.env.BASE_URL
      const response = await fetch(`${baseUrl}words/${listName}.json`)
      if (!response.ok) {
        throw new Error(`Failed to load word list: ${listName}`)
      }
      const wordsData = await response.json() as Word[]

      // Merge with existing words, avoid duplicates
      const existingWords = new Set(words.value.map(w => w.word.toLowerCase()))
      const uniqueNewWords = wordsData.filter(w => !existingWords.has(w.word.toLowerCase()))
      words.value = [...words.value, ...uniqueNewWords]
      saveToLocalStorage()

      return uniqueNewWords.length
    } catch (error) {
      console.error('Error loading word list:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  // Replace all words with a word list
  async function replaceWithWordList(listName: string): Promise<number> {
    loading.value = true
    try {
      const baseUrl = import.meta.env.BASE_URL
      const response = await fetch(`${baseUrl}words/${listName}.json`)
      if (!response.ok) {
        throw new Error(`Failed to load word list: ${listName}`)
      }
      const wordsData = await response.json() as Word[]
      words.value = wordsData
      saveToLocalStorage()

      return wordsData.length
    } catch (error) {
      console.error('Error loading word list:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  // Get available word lists
  const availableWordLists: WordList[] = [
    { name: 'grade3-400', label: '三年级词汇 (397词)', category: 'grade3' }
  ]

  return {
    words,
    userWords,
    loading,
    wordCount,
    wordsByDifficulty,
    wordsByCategory,
    availableWordLists,
    init,
    addWord,
    updateWord,
    deleteWord,
    importWords,
    exportWords,
    getRandomWords,
    getWordById,
    searchWords,
    loadWordList,
    replaceWithWordList
  }
})
