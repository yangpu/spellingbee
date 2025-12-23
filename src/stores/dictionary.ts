import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
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

interface DictionaryWithWords extends Dictionary {
  words?: Word[]
}

export const useDictionaryStore = defineStore('dictionary', () => {
  const authStore = useAuthStore()
  
  // State
  const dictionaries = ref<Dictionary[]>([])
  
  // 当前"选用"的词典（用于学习）
  const currentDictionary = ref<DictionaryWithWords | null>(null)
  const currentWords = ref<Word[]>([])
  
  // 当前"查看"的词典（Words.vue 页面使用，可能与 currentDictionary 不同）
  const viewingDictionary = ref<Dictionary | null>(null)
  const viewingWords = ref<Word[]>([])
  const viewingDictId = ref<string | null>(null)
  
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
  const viewingWordCount = computed(() => viewingWords.value.length)
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

  // 保存词典到 IndexedDB（完全替换该词典的所有单词）
  async function saveDictionaryToCache(dictionary: Dictionary, words?: Word[]): Promise<void> {
    const database = await initDB()
    const dictionaryId = dictionary.id
    
    // 如果需要更新单词，先删除旧单词
    if (words !== undefined) {
      // 第一步：删除旧单词
      await new Promise<void>((resolve, reject) => {
        const deleteTransaction = database.transaction([WORDS_STORE], 'readwrite')
        deleteTransaction.onerror = () => reject(deleteTransaction.error)
        
        const wordsStore = deleteTransaction.objectStore(WORDS_STORE)
        const wordsIndex = wordsStore.index('dictionary_id')
        const cursorRequest = wordsIndex.openCursor(IDBKeyRange.only(dictionaryId))
        
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
          if (cursor) {
            cursor.delete()
            cursor.continue()
          }
        }
        
        deleteTransaction.oncomplete = () => resolve()
      })
      
      // 第二步：添加新单词
      if (words.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const addTransaction = database.transaction([WORDS_STORE], 'readwrite')
          addTransaction.onerror = () => reject(addTransaction.error)
          addTransaction.oncomplete = () => resolve()
          
          const wordsStore = addTransaction.objectStore(WORDS_STORE)
          words.forEach(word => {
            wordsStore.put({ ...word, dictionary_id: dictionaryId })
          })
        })
      }
    }
    
    // 第三步：保存词典信息
    return new Promise((resolve, reject) => {
      const dictTransaction = database.transaction([DICT_STORE], 'readwrite')
      dictTransaction.onerror = () => reject(dictTransaction.error)
      dictTransaction.oncomplete = () => resolve()
      
      const dictStore = dictTransaction.objectStore(DICT_STORE)
      dictStore.put(dictionary)
    })
  }
  
  // 从 IndexedDB 删除单个单词
  async function deleteWordFromCache(wordId: string): Promise<void> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([WORDS_STORE], 'readwrite')
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      
      const wordsStore = transaction.objectStore(WORDS_STORE)
      wordsStore.delete(wordId)
    })
  }
  
  // 更新 IndexedDB 中的单个单词
  async function updateWordInCache(wordId: string, updates: Partial<Word>): Promise<void> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([WORDS_STORE], 'readwrite')
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      
      const wordsStore = transaction.objectStore(WORDS_STORE)
      const getRequest = wordsStore.get(wordId)
      
      getRequest.onsuccess = () => {
        const existingWord = getRequest.result
        if (existingWord) {
          wordsStore.put({ ...existingWord, ...updates })
        }
      }
    })
  }
  
  // 添加单个单词到 IndexedDB
  async function addWordToCache(word: Word): Promise<void> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([WORDS_STORE], 'readwrite')
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      
      const wordsStore = transaction.objectStore(WORDS_STORE)
      wordsStore.put(word)
    })
  }
  
  // 更新 IndexedDB 中词典的 word_count
  async function updateDictionaryCountInCache(dictionaryId: string, wordCount: number): Promise<void> {
    const database = await initDB()
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([DICT_STORE], 'readwrite')
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      
      const dictStore = transaction.objectStore(DICT_STORE)
      const getRequest = dictStore.get(dictionaryId)
      
      getRequest.onsuccess = () => {
        const dict = getRequest.result
        if (dict) {
          dictStore.put({ ...dict, word_count: wordCount, updated_at: new Date().toISOString() })
        }
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
    if (initialized) {
      return
    }
    if (loading.value) {
      return
    }
    
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
    // 记录创建前是否有词典（用于判断是否为第一个词典）
    const isFirstDictionary = dictionaries.value.length === 0
    
    const newDict: Dictionary = {
      id: crypto.randomUUID(),
      name: data.name,
      description: data.description || '',
      author: data.author || authStore.user?.email?.split('@')[0] || 'Anonymous',
      cover_image: data.cover_image || '',
      level: data.level || 'custom',
      type: data.type || 'custom',
      word_count: 0,
      is_public: data.is_public || false,
      creator_id: authStore.user?.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    let createdDict: Dictionary
    
    if (authStore.user) {
      const { data: insertedData, error } = await supabase
        .from('dictionaries')
        .insert(newDict)
        .select()
        .single()
      
      if (error) throw error
      
      createdDict = insertedData as Dictionary
      dictionaries.value.unshift(createdDict)
      await saveDictionaryToCache(createdDict)
    } else {
      // 离线模式
      createdDict = newDict
      dictionaries.value.unshift(createdDict)
      await saveDictionaryToCache(createdDict)
    }
    
    // 如果是第一个词典，自动选用
    if (isFirstDictionary) {
      currentDictionary.value = { ...createdDict, words: [] }
      currentWords.value = []
      localStorage.setItem(CURRENT_DICT_KEY, createdDict.id)
      dictionaryVersion.value++
    }
    
    return createdDict
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
    
    // 先从列表中移除
    dictionaries.value = dictionaries.value.filter(d => d.id !== id)
    await deleteDictionaryFromCache(id)
    
    // 如果删除的是当前选用的词典，或者当前词典已不在列表中
    const currentId = currentDictionary.value?.id
    const currentStillExists = currentId && dictionaries.value.some(d => d.id === currentId)
    
    if (currentId === id || !currentStillExists) {
      // 检查是否还有其他词典
      if (dictionaries.value.length > 0) {
        // 自动选择第一个词典
        const firstDict = dictionaries.value[0]
        const cached = await loadDictionaryFromCache(firstDict.id)
        if (cached) {
          currentDictionary.value = cached
          currentWords.value = cached.words || []
        } else {
          currentDictionary.value = { ...firstDict, words: [] }
          currentWords.value = []
        }
        localStorage.setItem(CURRENT_DICT_KEY, firstDict.id)
      } else {
        // 没有词典了，清空当前选用
        currentDictionary.value = null
        currentWords.value = []
        localStorage.removeItem(CURRENT_DICT_KEY)
      }
      // 递增版本号，触发依赖此词典的其他 store 更新
      dictionaryVersion.value++
    }
  }

  // 选择词典 - 离线优先策略
  // 1. 立即从缓存加载并切换（不阻塞UI）
  // 2. 异步同步到服务器（失败不影响本地操作）
  async function selectDictionary(dictionaryId: string, syncToServer = true): Promise<void> {
    // 第一步：立即从缓存加载（离线优先）
    let dictWithWords = await loadDictionaryFromCache(dictionaryId)
    
    // 如果缓存有数据，立即切换（不等待服务器）
    if (dictWithWords) {
      currentDictionary.value = dictWithWords
      currentWords.value = dictWithWords.words || []
      localStorage.setItem(CURRENT_DICT_KEY, dictionaryId)
      dictionaryVersion.value++
      
      // 异步同步到服务器（不阻塞，失败不影响）
      if (authStore.user && syncToServer) {
        syncSelectionToServer(dictionaryId).catch(() => {})
        // 异步从服务器更新缓存（后台刷新）
        refreshDictionaryFromServer(dictionaryId).catch(() => {})
      }
      return
    }
    
    // 第二步：缓存没有数据，尝试从服务器加载
    loading.value = true
    try {
      if (authStore.user) {
        const { data: dictData, error: dictError } = await supabase
          .from('dictionaries')
          .select('*')
          .eq('id', dictionaryId)
          .maybeSingle()
        
        if (dictError) throw dictError
        if (!dictData) throw new Error('词典不存在')
        
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
        
        // 缓存到本地
        await saveDictionaryToCache(dictData as Dictionary, wordsData as Word[])
        
        currentDictionary.value = dictWithWords
        currentWords.value = dictWithWords.words || []
        localStorage.setItem(CURRENT_DICT_KEY, dictionaryId)
        dictionaryVersion.value++
        
        // 同步选择到服务器
        if (syncToServer) {
          await syncSelectionToServer(dictionaryId)
        }
      } else {
        // 离线模式下没有缓存，无法选择
        throw new Error('词典数据未缓存，请先连接网络')
      }
    } catch (error) {
      console.error('Failed to select dictionary:', error)
      throw error
    } finally {
      loading.value = false
    }
  }
  
  // 异步同步选择到服务器
  async function syncSelectionToServer(dictionaryId: string): Promise<void> {
    if (!authStore.user) return
    
    try {
      await supabase
        .from('user_dictionary_selections')
        .upsert({
          user_id: authStore.user.id,
          dictionary_id: dictionaryId,
          selected_at: new Date().toISOString()
        })
    } catch {
      // 不抛出错误，允许离线操作
    }
  }
  
  // 异步从服务器刷新词典数据到缓存（后台更新）
  async function refreshDictionaryFromServer(dictionaryId: string): Promise<void> {
    if (!authStore.user) return
    
    try {
      const { data: dictData, error: dictError } = await supabase
        .from('dictionaries')
        .select('*')
        .eq('id', dictionaryId)
        .maybeSingle()
      
      if (dictError) throw dictError
      if (!dictData) return // 词典不存在，静默返回
      
      const { data: wordsData, error: wordsError } = await supabase
        .from('dictionary_words')
        .select('*')
        .eq('dictionary_id', dictionaryId)
        .order('sort_order', { ascending: true })
      
      if (wordsError) throw wordsError
      
      // 更新缓存
      await saveDictionaryToCache(dictData as Dictionary, wordsData as Word[])
      
      // 如果仍是当前词典，更新内存状态
      if (currentDictionary.value?.id === dictionaryId) {
        const words = wordsData as Word[]
        currentDictionary.value = { ...(dictData as Dictionary), words }
        currentWords.value = words
        dictionaryVersion.value++
      }
    } catch {
      // 静默失败
    }
  }

  // 加载指定词典用于查看（不改变当前选用的词典）
  // 优先从缓存加载，forceRefresh=true 时强制从服务器刷新
  async function loadViewingDictionary(dictionaryId: string, forceRefresh = false): Promise<void> {
    viewingDictId.value = dictionaryId
    
    // 如果不是强制刷新，先尝试从缓存加载
    if (!forceRefresh) {
      const cached = await loadDictionaryFromCache(dictionaryId)
      // 只要缓存中有词典数据就使用（即使没有单词）
      if (cached) {
        viewingDictionary.value = cached
        viewingWords.value = cached.words || []
        return
      }
    }
    
    // 未登录用户只能使用本地缓存
    if (!authStore.user) {
      // 尝试从 dictionaries 列表中查找
      const localDict = dictionaries.value.find(d => d.id === dictionaryId)
      if (localDict) {
        viewingDictionary.value = localDict
        viewingWords.value = []
        return
      }
      throw new Error('词典不存在或未同步')
    }
    
    loading.value = true
    
    // 先清空旧数据，确保 UI 显示加载状态
    viewingDictionary.value = null
    viewingWords.value = []
    
    try {
      // 从服务器加载词典详情
      const { data: dictData, error: dictError } = await supabase
        .from('dictionaries')
        .select('*')
        .eq('id', dictionaryId)
        .maybeSingle()
      
      if (dictError) throw dictError
      
      if (!dictData) {
        throw new Error('词典不存在')
      }
      
      // 加载单词列表
      const { data: wordsData, error: wordsError } = await supabase
        .from('dictionary_words')
        .select('*')
        .eq('dictionary_id', dictionaryId)
        .order('created_at', { ascending: true })
      
      if (wordsError) throw wordsError
      
      const dict = dictData as Dictionary
      const words = wordsData as Word[]
      const actualCount = words.length
      
      // 更新内存状态
      viewingDictionary.value = { ...dict, word_count: actualCount }
      viewingWords.value = [...words]
      
      // 同步更新 dictionaries 列表中的 word_count
      const dictIndex = dictionaries.value.findIndex(d => d.id === dictionaryId)
      if (dictIndex !== -1) {
        dictionaries.value[dictIndex] = { ...dictionaries.value[dictIndex], word_count: actualCount }
      }
      
      // 如果是当前选用的词典，也同步更新
      if (currentDictionary.value?.id === dictionaryId) {
        currentDictionary.value = { ...currentDictionary.value, word_count: actualCount }
        currentWords.value = [...words]
      }
      
      // 同步更新 IndexedDB 缓存
      await saveDictionaryToCache({ ...dict, word_count: actualCount }, words)
    } catch (error) {
      console.error('Failed to load viewing dictionary:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  // 强制从服务器刷新词典数据
  async function refreshViewingDictionary(): Promise<void> {
    if (!viewingDictId.value) return
    await loadViewingDictionary(viewingDictId.value, true)
  }
  
  // 清除查看状态
  function clearViewingDictionary(): void {
    viewingDictionary.value = null
    viewingWords.value = []
    viewingDictId.value = null
  }

  // 添加单词到词典（统一更新 viewingWords 和 currentWords）
  async function addWord(dictionaryId: string, wordData: Omit<Word, 'id' | 'created_at' | 'dictionary_id'>): Promise<Word> {
    const wordLower = wordData.word.trim().toLowerCase()
    
    // 检查单词是否已存在（优先检查 viewingWords）
    const wordsToCheck = viewingDictId.value === dictionaryId ? viewingWords.value : currentWords.value
    if (wordsToCheck.some(w => w.word.toLowerCase() === wordLower)) {
      throw new Error(`单词 "${wordData.word}" 在此词典中已存在`)
    }
    
    if (authStore.user) {
      const { data: existingWord } = await supabase
        .from('dictionary_words')
        .select('id')
        .eq('dictionary_id', dictionaryId)
        .ilike('word', wordLower)
        .maybeSingle()
      
      if (existingWord) {
        throw new Error(`单词 "${wordData.word}" 在此词典中已存在`)
      }
    }
    
    // 获取当前最大的 sort_order
    const existingCount = viewingDictId.value === dictionaryId 
      ? viewingWords.value.length 
      : (currentDictionary.value?.id === dictionaryId ? currentWords.value.length : 0)
    
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
      
      if (error) {
        if (error.code === '23505') {
          throw new Error(`单词 "${wordData.word}" 在此词典中已存在`)
        }
        throw error
      }
      
      const word = data as Word
      
      // 更新 viewingWords
      if (viewingDictId.value === dictionaryId) {
        viewingWords.value = [...viewingWords.value, word]
      }
      
      // 更新 currentWords（如果是同一个词典，直接同步）
      if (currentDictionary.value?.id === dictionaryId) {
        if (viewingDictId.value === dictionaryId) {
          currentWords.value = [...viewingWords.value]
        } else {
          currentWords.value = [...currentWords.value, word]
        }
      }
      
      // 更新缓存：添加单词到 IndexedDB
      await addWordToCache(word)
      
      // 更新词典的单词数量
      await syncDictionaryWordCount(dictionaryId)
      
      return word
    } else {
      // 离线模式
      if (viewingDictId.value === dictionaryId) {
        viewingWords.value = [...viewingWords.value, newWord]
      }
      if (currentDictionary.value?.id === dictionaryId) {
        if (viewingDictId.value === dictionaryId) {
          currentWords.value = [...viewingWords.value]
        } else {
          currentWords.value = [...currentWords.value, newWord]
        }
      }
      
      // 更新缓存
      await addWordToCache(newWord)
      
      const newCount = viewingDictId.value === dictionaryId 
        ? viewingWords.value.length 
        : currentWords.value.length
      await updateDictionaryCountInCache(dictionaryId, newCount)
      updateLocalDictionaryCount(dictionaryId, newCount)
      
      return newWord
    }
  }

  // 批量添加单词
  async function addWords(dictionaryId: string, wordsData: Omit<Word, 'id' | 'created_at' | 'dictionary_id'>[]): Promise<Word[]> {
    // 获取当前最大的 sort_order
    let existingCount = 0
    
    if (viewingDictId.value === dictionaryId) {
      existingCount = viewingWords.value.length
    } else if (currentDictionary.value?.id === dictionaryId) {
      existingCount = currentWords.value.length
    } else if (authStore.user) {
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
    
    let insertedWords: Word[] = []
    
    if (authStore.user) {
      // 使用 insert 而不是 upsert，并返回插入的数据
      // 先过滤掉已存在的单词
      const existingWordsLower = new Set(
        viewingDictId.value === dictionaryId 
          ? viewingWords.value.map(w => w.word.toLowerCase())
          : currentWords.value.map(w => w.word.toLowerCase())
      )
      const wordsToInsert = newWords.filter(w => !existingWordsLower.has(w.word.toLowerCase()))
      
      if (wordsToInsert.length > 0) {
        const { data, error } = await supabase
          .from('dictionary_words')
          .insert(wordsToInsert)
          .select()
        
        if (error) throw error
        insertedWords = (data || []) as Word[]
      }
    } else {
      // 离线模式：过滤重复后直接使用
      const existingWordsLower = new Set(
        viewingDictId.value === dictionaryId 
          ? viewingWords.value.map(w => w.word.toLowerCase())
          : currentWords.value.map(w => w.word.toLowerCase())
      )
      insertedWords = newWords.filter(w => !existingWordsLower.has(w.word.toLowerCase()))
    }
    
    // 更新 viewingWords
    if (viewingDictId.value === dictionaryId && insertedWords.length > 0) {
      viewingWords.value = [...viewingWords.value, ...insertedWords]
    }
    
    // 更新 currentWords
    if (currentDictionary.value?.id === dictionaryId && insertedWords.length > 0) {
      // 避免重复添加（如果 viewingDictId 和 currentDictionary 是同一个）
      if (viewingDictId.value !== dictionaryId) {
        currentWords.value = [...currentWords.value, ...insertedWords]
      } else {
        // 同一个词典，currentWords 也需要同步
        currentWords.value = [...viewingWords.value]
      }
      dictionaryVersion.value++
    }
    
    // 更新缓存：批量添加单词到 IndexedDB
    for (const word of insertedWords) {
      await addWordToCache(word)
    }
    
    // 统一同步词典单词数量
    await syncDictionaryWordCount(dictionaryId)
    
    return insertedWords
  }
  
  // 同步词典单词数量（从数据库获取实际数量并更新所有相关状态和缓存）
  async function syncDictionaryWordCount(dictionaryId: string): Promise<void> {
    let newCount: number
    
    if (authStore.user) {
      const { count, error } = await supabase
        .from('dictionary_words')
        .select('*', { count: 'exact', head: true })
        .eq('dictionary_id', dictionaryId)
      
      if (error || count === null) {
        return
      }
      newCount = count
      
      // 更新数据库中的 word_count
      await supabase
        .from('dictionaries')
        .update({ word_count: newCount, updated_at: new Date().toISOString() })
        .eq('id', dictionaryId)
    } else {
      // 离线模式：从本地状态获取
      if (viewingDictId.value === dictionaryId) {
        newCount = viewingWords.value.length
      } else if (currentDictionary.value?.id === dictionaryId) {
        newCount = currentWords.value.length
      } else {
        return
      }
    }
    
    // 更新内存状态
    updateLocalDictionaryCount(dictionaryId, newCount)
    
    // 更新 IndexedDB 缓存
    await updateDictionaryCountInCache(dictionaryId, newCount)
  }
  
  // 更新本地词典数量（不涉及数据库）
  function updateLocalDictionaryCount(dictionaryId: string, newCount: number): void {
    // 更新 dictionaries 列表
    const index = dictionaries.value.findIndex(d => d.id === dictionaryId)
    if (index !== -1) {
      dictionaries.value[index] = { ...dictionaries.value[index], word_count: newCount }
    }
    
    // 更新 viewingDictionary
    if (viewingDictionary.value?.id === dictionaryId) {
      viewingDictionary.value = { ...viewingDictionary.value, word_count: newCount }
    }
    
    // 更新 currentDictionary
    if (currentDictionary.value?.id === dictionaryId) {
      currentDictionary.value = { ...currentDictionary.value, word_count: newCount }
    }
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
    
    // 获取单词所属的词典ID
    const word = viewingWords.value.find(w => w.id === wordId) || currentWords.value.find(w => w.id === wordId)
    const dictionaryId = word?.dictionary_id
    
    // 更新 viewingWords
    const viewingIndex = viewingWords.value.findIndex(w => w.id === wordId)
    if (viewingIndex !== -1) {
      viewingWords.value[viewingIndex] = { ...viewingWords.value[viewingIndex], ...updates }
      viewingWords.value = [...viewingWords.value] // 触发响应式更新
    }
    
    // 更新 currentWords（如果是同一个词典，直接同步）
    if (dictionaryId && currentDictionary.value?.id === dictionaryId) {
      if (viewingDictId.value === dictionaryId) {
        currentWords.value = [...viewingWords.value]
      } else {
        const currentIndex = currentWords.value.findIndex(w => w.id === wordId)
        if (currentIndex !== -1) {
          currentWords.value[currentIndex] = { ...currentWords.value[currentIndex], ...updates }
          currentWords.value = [...currentWords.value]
        }
      }
    }
    
    // 更新 IndexedDB 缓存
    await updateWordInCache(wordId, updates)
  }

  // 删除单词
  async function deleteWord(wordId: string): Promise<void> {
    // 先从 viewingWords 或 currentWords 找到单词
    let wordToDelete = viewingWords.value.find(w => w.id === wordId)
    if (!wordToDelete) {
      wordToDelete = currentWords.value.find(w => w.id === wordId)
    }
    const dictionaryId = wordToDelete?.dictionary_id || viewingDictId.value || currentDictionary.value?.id
    
    if (authStore.user) {
      const { error } = await supabase
        .from('dictionary_words')
        .delete()
        .eq('id', wordId)
      
      if (error) throw error
    }
    
    // 更新 viewingWords
    viewingWords.value = viewingWords.value.filter(w => w.id !== wordId)
    
    // 更新 currentWords（如果是同一个词典，直接同步）
    if (dictionaryId && currentDictionary.value?.id === dictionaryId) {
      if (viewingDictId.value === dictionaryId) {
        currentWords.value = [...viewingWords.value]
      } else {
        currentWords.value = currentWords.value.filter(w => w.id !== wordId)
      }
    }
    
    // 从 IndexedDB 缓存中删除单词
    await deleteWordFromCache(wordId)
    
    // 同步词典单词数量（会同时更新内存状态和缓存）
    if (dictionaryId) {
      await syncDictionaryWordCount(dictionaryId)
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
  async function importFromWordList(wordList: string, _dictionaryId?: string): Promise<string[]> {
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
  
  // 从数据库查找已有单词定义（用于复用已有词库）
  // 优先从本地 IndexedDB 查找，再从服务器查找
  async function findExistingWordDefinitions(words: string[]): Promise<Map<string, Partial<Word>>> {
    const result = new Map<string, Partial<Word>>()
    const wordsLower = words.map(w => w.toLowerCase())
    
    // 1. 先从 IndexedDB 查找
    try {
      const database = await initDB()
      const transaction = database.transaction([WORDS_STORE], 'readonly')
      const wordsStore = transaction.objectStore(WORDS_STORE)
      const allWords = await new Promise<Word[]>((resolve, reject) => {
        const request = wordsStore.getAll()
        request.onsuccess = () => resolve(request.result as Word[])
        request.onerror = () => reject(request.error)
      })
      
      // 匹配单词
      for (const word of allWords) {
        const wordLower = word.word.toLowerCase()
        if (wordsLower.includes(wordLower) && (word.definition || word.definition_cn)) {
          result.set(wordLower, {
            word: word.word,
            pronunciation: word.pronunciation,
            definition: word.definition,
            definition_cn: word.definition_cn,
            part_of_speech: word.part_of_speech,
            example_sentence: word.example_sentence,
            difficulty: word.difficulty,
            category: word.category
          })
        }
      }
    } catch {
      // 静默失败
    }
    
    // 2. 对于本地没找到的，从服务器查找
    const notFoundWords = wordsLower.filter(w => !result.has(w))
    if (notFoundWords.length > 0 && authStore.user) {
      try {
        // 分批查询，避免 URL 过长
        const batchSize = 50
        for (let i = 0; i < notFoundWords.length; i += batchSize) {
          const batch = notFoundWords.slice(i, i + batchSize)
          const { data, error } = await supabase
            .from('dictionary_words')
            .select('word, pronunciation, definition, definition_cn, part_of_speech, example_sentence, difficulty, category')
            .in('word', batch)
          
          if (!error && data) {
            for (const word of data) {
              const wordLower = word.word.toLowerCase()
              if (!result.has(wordLower) && (word.definition || word.definition_cn)) {
                result.set(wordLower, word)
              }
            }
          }
        }
      } catch {
        // 静默失败
      }
    }
    
    return result
  }

  return {
    // State
    dictionaries,
    currentDictionary,
    currentWords,
    viewingDictionary,
    viewingWords,
    viewingDictId,
    loading,
    syncing,
    dictionaryVersion,
    
    // Computed
    wordCount,
    viewingWordCount,
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
    loadViewingDictionary,
    refreshViewingDictionary,
    clearViewingDictionary,
    addWord,
    addWords,
    updateWord,
    deleteWord,
    exportDictionary,
    importFromJSON,
    importFromCSV,
    importFromWordList,
    getRandomWords,
    searchWords,
    findExistingWordDefinitions
  }
})
