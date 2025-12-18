import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import type { Dictionary, Word, DictionaryLevel, DictionaryType } from '@/types'

// IndexedDB 配置
const DB_NAME = 'spellingbee_dictionaries'
const DB_VERSION = 1
const DICT_STORE = 'dictionaries'
const WORDS_STORE = 'dictionary_words'

// localStorage 键
const CURRENT_DICT_KEY = 'spellingbee_current_dictionary'
const DICT_CACHE_KEY = 'spellingbee_dictionaries_cache'

interface DictionaryWithWords extends Dictionary {
  words?: Word[]
}

export const useDictionaryStore = defineStore('dictionary', () => {
  const authStore = useAuthStore()
  
  // State
  const dictionaries = ref<Dictionary[]>([])
  const currentDictionary = ref<DictionaryWithWords | null>(null)
  const currentWords = ref<Word[]>([])
  const loading = ref(false)
  const syncing = ref(false)
  
  // 词典版本号 - 每次切换词典时递增，用于触发其他 store 的响应式更新
  const dictionaryVersion = ref(0)
  
  // 初始化标志 - 防止重复初始化覆盖用户选择
  let initialized = false
  
  // IndexedDB 实例
  let db: IDBDatabase | null = null

  // Computed
  const wordCount = computed(() => currentWords.value.length)
  const hasDictionary = computed(() => currentDictionary.value !== null)
  const myDictionaries = computed(() => 
    dictionaries.value.filter(d => d.creator_id === authStore.user?.id)
  )
  const publicDictionaries = computed(() => 
    dictionaries.value.filter(d => d.is_public && d.creator_id !== authStore.user?.id)
  )

  // 初始化 IndexedDB
  async function initDB(): Promise<IDBDatabase> {
    if (db) return db
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      
      request.onerror = () => reject(request.error)
      
      request.onsuccess = () => {
        db = request.result
        resolve(db)
      }
      
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result
        
        // 词典存储
        if (!database.objectStoreNames.contains(DICT_STORE)) {
          const dictStore = database.createObjectStore(DICT_STORE, { keyPath: 'id' })
          dictStore.createIndex('creator_id', 'creator_id', { unique: false })
          dictStore.createIndex('is_public', 'is_public', { unique: false })
        }
        
        // 单词存储
        if (!database.objectStoreNames.contains(WORDS_STORE)) {
          const wordsStore = database.createObjectStore(WORDS_STORE, { keyPath: 'id' })
          wordsStore.createIndex('dictionary_id', 'dictionary_id', { unique: false })
          wordsStore.createIndex('word', 'word', { unique: false })
        }
      }
    })
  }

  // 保存词典到 IndexedDB
  async function saveDictionaryToCache(dictionary: Dictionary, words?: Word[]): Promise<void> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([DICT_STORE, WORDS_STORE], 'readwrite')
      
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      
      // 保存词典
      const dictStore = transaction.objectStore(DICT_STORE)
      dictStore.put(dictionary)
      
      // 保存单词
      if (words && words.length > 0) {
        const wordsStore = transaction.objectStore(WORDS_STORE)
        words.forEach(word => {
          wordsStore.put({ ...word, dictionary_id: dictionary.id })
        })
      }
    })
  }

  // 从 IndexedDB 加载词典
  async function loadDictionaryFromCache(dictionaryId: string): Promise<DictionaryWithWords | null> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([DICT_STORE, WORDS_STORE], 'readonly')
      
      transaction.onerror = () => reject(transaction.error)
      
      // 获取词典
      const dictStore = transaction.objectStore(DICT_STORE)
      const dictRequest = dictStore.get(dictionaryId)
      
      dictRequest.onsuccess = () => {
        const dictionary = dictRequest.result as Dictionary | undefined
        if (!dictionary) {
          resolve(null)
          return
        }
        
        // 获取单词
        const wordsStore = transaction.objectStore(WORDS_STORE)
        const wordsIndex = wordsStore.index('dictionary_id')
        const wordsRequest = wordsIndex.getAll(dictionaryId)
        
        wordsRequest.onsuccess = () => {
          resolve({
            ...dictionary,
            words: wordsRequest.result as Word[]
          })
        }
      }
    })
  }

  // 从 IndexedDB 加载所有词典（不含单词）
  async function loadAllDictionariesFromCache(): Promise<Dictionary[]> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([DICT_STORE], 'readonly')
      const store = transaction.objectStore(DICT_STORE)
      const request = store.getAll()
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result as Dictionary[])
    })
  }

  // 删除词典缓存
  async function deleteDictionaryFromCache(dictionaryId: string): Promise<void> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([DICT_STORE, WORDS_STORE], 'readwrite')
      
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      
      // 删除词典
      const dictStore = transaction.objectStore(DICT_STORE)
      dictStore.delete(dictionaryId)
      
      // 删除关联单词
      const wordsStore = transaction.objectStore(WORDS_STORE)
      const wordsIndex = wordsStore.index('dictionary_id')
      const cursorRequest = wordsIndex.openCursor(IDBKeyRange.only(dictionaryId))
      
      cursorRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
    })
  }

  // 初始化
  async function init(): Promise<void> {
    // 如果已经初始化过，直接返回（防止重复初始化覆盖用户选择）
    if (initialized) return
    if (loading.value) return
    
    loading.value = true
    try {
      // 先从缓存加载
      const cachedDicts = await loadAllDictionariesFromCache()
      if (cachedDicts.length > 0) {
        dictionaries.value = cachedDicts
      }
      
      // 恢复当前选择的词典
      const savedDictId = localStorage.getItem(CURRENT_DICT_KEY)
      if (savedDictId) {
        const cached = await loadDictionaryFromCache(savedDictId)
        if (cached) {
          currentDictionary.value = cached
          currentWords.value = cached.words || []
        }
      }
      
      // 如果已登录，从服务器同步
      if (authStore.user) {
        await syncFromServer()
      }
      
      // 标记为已初始化
      initialized = true
    } catch (error) {
      console.error('Failed to initialize dictionary store:', error)
    } finally {
      loading.value = false
    }
  }

  // 从服务器同步词典列表
  async function syncFromServer(): Promise<void> {
    if (!authStore.user) return
    
    syncing.value = true
    try {
      // 获取用户的词典和公开词典
      const { data, error } = await supabase
        .from('dictionaries')
        .select('*')
        .or(`creator_id.eq.${authStore.user.id},is_public.eq.true`)
        .order('updated_at', { ascending: false })
      
      if (error) throw error
      
      if (data) {
        dictionaries.value = data as Dictionary[]
        
        // 缓存到 IndexedDB
        for (const dict of data) {
          await saveDictionaryToCache(dict as Dictionary)
        }
      }
      
      // 同步用户选择的词典
      await syncUserSelection()
    } catch (error) {
      console.error('Failed to sync dictionaries:', error)
    } finally {
      syncing.value = false
    }
  }

  // 同步用户词典选择
  async function syncUserSelection(): Promise<void> {
    if (!authStore.user) return
    
    try {
      const { data, error } = await supabase
        .from('user_dictionary_selections')
        .select('dictionary_id')
        .eq('user_id', authStore.user.id)
        .maybeSingle()
      
      // 忽略 406 错误（schema cache 未更新）和 PGRST116（无数据）
      if (error && error.code !== 'PGRST116' && !error.message?.includes('406')) {
        console.warn('Failed to sync user selection:', error)
        return
      }
      
      if (data?.dictionary_id) {
        await selectDictionary(data.dictionary_id, false) // 不再次同步到服务器
      }
    } catch (error) {
      console.warn('Failed to sync user selection:', error)
    }
  }

  // 创建词典
  async function createDictionary(data: {
    name: string
    description?: string
    author?: string
    cover_image?: string
    level?: DictionaryLevel
    type?: DictionaryType
    is_public?: boolean
  }): Promise<Dictionary> {
    const newDict: Dictionary = {
      id: crypto.randomUUID(),
      name: data.name,
      description: data.description || '',
      author: data.author || authStore.user?.email?.split('@')[0] || 'Anonymous',
      cover_image: data.cover_image || '',
      level: data.level || 'junior',
      type: data.type || 'custom',
      word_count: 0,
      is_public: data.is_public || false,
      creator_id: authStore.user?.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    if (authStore.user) {
      const { data: insertedData, error } = await supabase
        .from('dictionaries')
        .insert(newDict)
        .select()
        .single()
      
      if (error) throw error
      
      const dict = insertedData as Dictionary
      dictionaries.value.unshift(dict)
      await saveDictionaryToCache(dict)
      return dict
    } else {
      // 离线模式
      dictionaries.value.unshift(newDict)
      await saveDictionaryToCache(newDict)
      return newDict
    }
  }

  // 更新词典
  async function updateDictionary(id: string, updates: Partial<Dictionary>): Promise<void> {
    const index = dictionaries.value.findIndex(d => d.id === id)
    if (index === -1) return
    
    const updatedDict = {
      ...dictionaries.value[index],
      ...updates,
      updated_at: new Date().toISOString()
    }
    
    if (authStore.user) {
      const { error } = await supabase
        .from('dictionaries')
        .update(updates)
        .eq('id', id)
      
      if (error) throw error
    }
    
    dictionaries.value[index] = updatedDict
    await saveDictionaryToCache(updatedDict)
    
    if (currentDictionary.value?.id === id) {
      currentDictionary.value = { ...currentDictionary.value, ...updates }
    }
  }

  // 删除词典
  async function deleteDictionary(id: string): Promise<void> {
    if (authStore.user) {
      const { error } = await supabase
        .from('dictionaries')
        .delete()
        .eq('id', id)
      
      if (error) throw error
    }
    
    dictionaries.value = dictionaries.value.filter(d => d.id !== id)
    await deleteDictionaryFromCache(id)
    
    if (currentDictionary.value?.id === id) {
      currentDictionary.value = null
      currentWords.value = []
      localStorage.removeItem(CURRENT_DICT_KEY)
      // 递增版本号，触发依赖此词典的其他 store 更新
      dictionaryVersion.value++
    }
  }

  // 选择词典
  async function selectDictionary(dictionaryId: string, syncToServer = true): Promise<void> {
    loading.value = true
    try {
      // 先尝试从缓存加载
      let dictWithWords = await loadDictionaryFromCache(dictionaryId)
      
      // 如果缓存没有或需要更新，从服务器加载
      if (!dictWithWords || (authStore.user && syncToServer)) {
        const { data: dictData, error: dictError } = await supabase
          .from('dictionaries')
          .select('*')
          .eq('id', dictionaryId)
          .single()
        
        if (dictError) throw dictError
        
        const { data: wordsData, error: wordsError } = await supabase
          .from('dictionary_words')
          .select('*')
          .eq('dictionary_id', dictionaryId)
          .order('sort_order', { ascending: true })
        
        if (wordsError) throw wordsError
        
        dictWithWords = {
          ...(dictData as Dictionary),
          words: wordsData as Word[]
        }
        
        // 缓存
        await saveDictionaryToCache(dictData as Dictionary, wordsData as Word[])
      }
      
      currentDictionary.value = dictWithWords
      currentWords.value = dictWithWords.words || []
      localStorage.setItem(CURRENT_DICT_KEY, dictionaryId)
      
      // 递增版本号，触发依赖此词典的其他 store 更新
      dictionaryVersion.value++
      
      // 同步选择到服务器
      if (authStore.user && syncToServer) {
        await supabase
          .from('user_dictionary_selections')
          .upsert({
            user_id: authStore.user.id,
            dictionary_id: dictionaryId,
            selected_at: new Date().toISOString()
          })
      }
    } catch (error) {
      console.error('Failed to select dictionary:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  // 添加单词到词典
  async function addWord(dictionaryId: string, wordData: Omit<Word, 'id' | 'created_at' | 'dictionary_id'>): Promise<Word> {
    // 获取当前最大的 sort_order
    const existingCount = currentDictionary.value?.id === dictionaryId 
      ? currentWords.value.length 
      : 0
    
    const newWord: Word = {
      id: crypto.randomUUID(),
      ...wordData,
      dictionary_id: dictionaryId,
      sort_order: existingCount,
      created_at: new Date().toISOString()
    }
    
    if (authStore.user) {
      const { data, error } = await supabase
        .from('dictionary_words')
        .insert(newWord)
        .select()
        .single()
      
      if (error) throw error
      
      const word = data as Word
      if (currentDictionary.value?.id === dictionaryId) {
        currentWords.value.push(word)
      }
      return word
    } else {
      if (currentDictionary.value?.id === dictionaryId) {
        currentWords.value.push(newWord)
      }
      // 更新缓存
      const dict = await loadDictionaryFromCache(dictionaryId)
      if (dict) {
        const words = [...(dict.words || []), newWord]
        await saveDictionaryToCache({ ...dict, word_count: words.length }, words)
      }
      return newWord
    }
  }

  // 批量添加单词
  async function addWords(dictionaryId: string, wordsData: Omit<Word, 'id' | 'created_at' | 'dictionary_id'>[]): Promise<Word[]> {
    // 获取当前最大的 sort_order
    let existingCount = 0
    
    if (currentDictionary.value?.id === dictionaryId) {
      existingCount = currentWords.value.length
    } else if (authStore.user) {
      // 如果不是当前词典，从数据库查询现有单词数量
      const { count, error } = await supabase
        .from('dictionary_words')
        .select('*', { count: 'exact', head: true })
        .eq('dictionary_id', dictionaryId)
      
      if (!error && count !== null) {
        existingCount = count
      }
    }
    
    const newWords: Word[] = wordsData.map((w, index) => ({
      id: crypto.randomUUID(),
      ...w,
      dictionary_id: dictionaryId,
      sort_order: existingCount + index,
      created_at: new Date().toISOString()
    }))
    
    if (authStore.user) {
      const { error } = await supabase
        .from('dictionary_words')
        .upsert(newWords, { onConflict: 'dictionary_id,word' })
      
      if (error) throw error
    }
    
    // 用于返回实际添加的单词（去重后）
    let addedWords: Word[] = []
    
    if (currentDictionary.value?.id === dictionaryId) {
      // 合并单词，避免重复
      const existingWords = new Set(currentWords.value.map(w => w.word.toLowerCase()))
      const uniqueNewWords = newWords.filter(w => !existingWords.has(w.word.toLowerCase()))
      currentWords.value = [...currentWords.value, ...uniqueNewWords]
      addedWords = uniqueNewWords
      
      // 更新缓存
      const dict = dictionaries.value.find(d => d.id === dictionaryId)
      if (dict) {
        const updatedDict = { ...dict, word_count: currentWords.value.length }
        await saveDictionaryToCache(updatedDict, currentWords.value)
        
        // 更新列表中的词典
        const index = dictionaries.value.findIndex(d => d.id === dictionaryId)
        if (index !== -1) {
          dictionaries.value[index] = updatedDict
        }
      }
      
      // 递增版本号，触发依赖此词典的其他组件更新
      dictionaryVersion.value++
    } else {
      // 非当前词典，返回所有新单词
      addedWords = newWords
    }
    
    return addedWords
  }

  // 更新单词
  async function updateWord(wordId: string, updates: Partial<Word>): Promise<void> {
    if (authStore.user) {
      const { error } = await supabase
        .from('dictionary_words')
        .update(updates)
        .eq('id', wordId)
      
      if (error) throw error
    }
    
    const index = currentWords.value.findIndex(w => w.id === wordId)
    if (index !== -1) {
      currentWords.value[index] = { ...currentWords.value[index], ...updates }
    }
    
    // 更新缓存
    if (currentDictionary.value) {
      await saveDictionaryToCache(currentDictionary.value, currentWords.value)
    }
  }

  // 删除单词
  async function deleteWord(wordId: string): Promise<void> {
    if (authStore.user) {
      const { error } = await supabase
        .from('dictionary_words')
        .delete()
        .eq('id', wordId)
      
      if (error) throw error
    }
    
    currentWords.value = currentWords.value.filter(w => w.id !== wordId)
    
    // 更新缓存
    if (currentDictionary.value) {
      const updatedDict = { ...currentDictionary.value, word_count: currentWords.value.length }
      await saveDictionaryToCache(updatedDict, currentWords.value)
    }
  }

  // 导出词典为 JSON
  function exportDictionary(): string {
    if (!currentDictionary.value) return '[]'
    
    return JSON.stringify({
      dictionary: {
        name: currentDictionary.value.name,
        description: currentDictionary.value.description,
        author: currentDictionary.value.author,
        level: currentDictionary.value.level,
        type: currentDictionary.value.type
      },
      words: currentWords.value.map(w => ({
        word: w.word,
        pronunciation: w.pronunciation,
        definition: w.definition,
        definition_cn: w.definition_cn,
        part_of_speech: w.part_of_speech,
        example_sentence: w.example_sentence,
        difficulty: w.difficulty,
        category: w.category
      }))
    }, null, 2)
  }

  // 导入 JSON 词典
  async function importFromJSON(jsonString: string, dictionaryId?: string): Promise<Word[]> {
    const data = JSON.parse(jsonString)
    const words = Array.isArray(data) ? data : (data.words || [data])
    
    const targetDictId = dictionaryId || currentDictionary.value?.id
    if (!targetDictId) throw new Error('No dictionary selected')
    
    return await addWords(targetDictId, words)
  }

  // 导入 CSV
  async function importFromCSV(csvString: string, dictionaryId?: string): Promise<Word[]> {
    const lines = csvString.trim().split('\n')
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    
    const words: Omit<Word, 'id' | 'created_at' | 'dictionary_id'>[] = []
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      const word: Record<string, unknown> = {}
      
      headers.forEach((header, index) => {
        if (values[index]) {
          word[header] = values[index]
        }
      })
      
      if (word.word) {
        words.push({
          word: String(word.word),
          pronunciation: String(word.pronunciation || ''),
          definition: String(word.definition || ''),
          definition_cn: String(word.definition_cn || ''),
          part_of_speech: String(word.part_of_speech || ''),
          example_sentence: String(word.example_sentence || ''),
          difficulty: Number(word.difficulty) || 3,
          category: String(word.category || '')
        })
      }
    }
    
    const targetDictId = dictionaryId || currentDictionary.value?.id
    if (!targetDictId) throw new Error('No dictionary selected')
    
    return await addWords(targetDictId, words)
  }

  // 解析 CSV 行（处理引号内的逗号）
  function parseCSVLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    
    result.push(current.trim())
    return result
  }

  // 从单词列表导入（逗号分隔）
  async function importFromWordList(wordList: string, dictionaryId?: string): Promise<string[]> {
    const words = wordList
      .split(/[,\n]/)
      .map(w => w.trim())
      .filter(w => w.length > 0)
    
    return words
  }

  // 获取随机单词
  function getRandomWords(count = 10, difficulty: number | null = null): Word[] {
    let filtered = [...currentWords.value]
    
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

  // 搜索单词
  function searchWords(query: string): Word[] {
    const q = query.toLowerCase()
    return currentWords.value.filter(w =>
      w.word.toLowerCase().includes(q) ||
      w.definition.toLowerCase().includes(q) ||
      (w.definition_cn && w.definition_cn.includes(q))
    )
  }

  return {
    // State
    dictionaries,
    currentDictionary,
    currentWords,
    loading,
    syncing,
    dictionaryVersion,
    
    // Computed
    wordCount,
    hasDictionary,
    myDictionaries,
    publicDictionaries,
    
    // Actions
    init,
    syncFromServer,
    createDictionary,
    updateDictionary,
    deleteDictionary,
    selectDictionary,
    addWord,
    addWords,
    updateWord,
    deleteWord,
    exportDictionary,
    importFromJSON,
    importFromCSV,
    importFromWordList,
    getRandomWords,
    searchWords
  }
})
