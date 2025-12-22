/**
 * 在线词典 API 服务
 * 用于查询单词定义、生成完整词库
 */

import type { Word } from '@/types'

// 词典服务商类型
export type DictionaryProvider = 'free' | 'mymemory'

// 当前选择的服务商
let currentProvider: DictionaryProvider = 'mymemory'

// 设置词典服务商
export function setDictionaryProvider(provider: DictionaryProvider): void {
  currentProvider = provider
}

// 获取当前服务商
export function getDictionaryProvider(): DictionaryProvider {
  return currentProvider
}

// 词典 API 响应类型
interface DictionaryAPIResponse {
  word: string
  phonetic?: string
  phonetics?: Array<{
    text?: string
    audio?: string
  }>
  meanings?: Array<{
    partOfSpeech: string
    definitions: Array<{
      definition: string
      example?: string
      synonyms?: string[]
    }>
  }>
}

// MyMemory 翻译 API 响应
interface MyMemoryResponse {
  responseData: {
    translatedText: string
    match: number
  }
  responseStatus: number
  matches?: Array<{
    segment: string
    translation: string
    quality: number
  }>
}

/**
 * 使用 Free Dictionary API 查询单词
 * https://dictionaryapi.dev/
 */
async function queryFreeDictionaryAPI(word: string): Promise<Partial<Word> | null> {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json() as DictionaryAPIResponse[]
    
    if (!data || data.length === 0) {
      return null
    }
    
    const entry = data[0]
    const phonetic = entry.phonetics?.find(p => p.text)?.text || entry.phonetic || ''
    
    // 获取第一个含义
    const firstMeaning = entry.meanings?.[0]
    const partOfSpeech = firstMeaning?.partOfSpeech || ''
    const firstDef = firstMeaning?.definitions?.[0]
    const definition = firstDef?.definition || ''
    const example = firstDef?.example || ''
    
    // 合并所有定义
    const allDefinitions = entry.meanings
      ?.flatMap(m => m.definitions.map(d => `(${m.partOfSpeech}) ${d.definition}`))
      .slice(0, 3)
      .join('; ') || definition
    
    return {
      word: entry.word || word,
      pronunciation: phonetic,
      definition: allDefinitions,
      part_of_speech: partOfSpeech,
      example_sentence: example,
      difficulty: estimateDifficulty(word)
    }
  } catch (error) {
    console.error(`Failed to query Free Dictionary API for "${word}":`, error)
    return null
  }
}

/**
 * 使用 MyMemory 翻译 API 获取中文翻译
 * https://mymemory.translated.net/doc/spec.php
 * 免费 API，每天 5000 字符限制（匿名），注册后 10000 字符
 */
async function queryMyMemoryAPI(text: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      q: text,
      langpair: 'en|zh-CN'
    })
    
    const response = await fetch(`https://api.mymemory.translated.net/get?${params}`)
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json() as MyMemoryResponse
    
    if (data.responseStatus !== 200) {
      return null
    }
    
    return data.responseData.translatedText || null
  } catch (error) {
    console.error(`Failed to query MyMemory API:`, error)
    return null
  }
}

/**
 * 使用 MyMemory 查询单词（含中文翻译）
 */
async function queryWordWithTranslation(word: string): Promise<Partial<Word> | null> {
  // 先从 Free Dictionary 获取英文定义
  const freeResult = await queryFreeDictionaryAPI(word)
  
  // 直接翻译单词本身获取中文释义（而非翻译英文定义）
  const translation = await queryMyMemoryAPI(word)
  
  if (!freeResult) {
    // 如果没有英文定义，但有中文翻译
    if (translation) {
      return {
        word,
        definition: '',
        definition_cn: translation,
        difficulty: estimateDifficulty(word)
      }
    }
    return null
  }
  
  // 将单词的中文翻译作为中文释义
  if (translation) {
    freeResult.definition_cn = translation
  }
  
  return freeResult
}

/**
 * 根据单词长度和复杂度估算难度
 */
function estimateDifficulty(word: string): number {
  const length = word.length
  const hasComplexPattern = /([^aeiou]{3,}|tion|sion|ous|ious|eous|ance|ence|ment|able|ible)/i.test(word)
  
  let difficulty = 1
  
  if (length <= 4) {
    difficulty = 1
  } else if (length <= 6) {
    difficulty = 2
  } else if (length <= 8) {
    difficulty = 3
  } else if (length <= 10) {
    difficulty = 4
  } else {
    difficulty = 5
  }
  
  if (hasComplexPattern && difficulty < 5) {
    difficulty++
  }
  
  return Math.min(difficulty, 5)
}

/**
 * 查询单词定义（根据当前服务商）
 * 可选传入 findExistingFn 先从数据库查找
 */
export async function lookupWord(
  word: string,
  findExistingFn?: (words: string[]) => Promise<Map<string, Partial<Word>>>
): Promise<Partial<Word>> {
  // 先尝试从数据库查找
  if (findExistingFn) {
    try {
      const existing = await findExistingFn([word])
      const found = existing.get(word.toLowerCase())
      if (found && (found.definition || found.definition_cn)) {
        console.log('[lookupWord] Found existing definition for:', word)
        return { ...found, word }
      }
    } catch (error) {
      console.warn('[lookupWord] Failed to find existing definition:', error)
    }
  }
  
  // 从在线 API 查询
  if (currentProvider === 'mymemory') {
    const result = await queryWordWithTranslation(word)
    if (result) {
      return { ...result, word }
    }
  } else {
    const result = await queryFreeDictionaryAPI(word)
    if (result) {
      return { ...result, word }
    }
  }
  
  // 如果没有结果，返回基本信息
  return {
    word,
    definition: '',
    difficulty: estimateDifficulty(word)
  }
}

/**
 * 批量查询单词定义
 */
export async function lookupWords(
  words: string[],
  onProgress?: (current: number, total: number, word: string) => void
): Promise<Partial<Word>[]> {
  const results: Partial<Word>[] = []
  const total = words.length
  
  // 并行查询，但限制并发数
  const batchSize = currentProvider === 'mymemory' ? 2 : 5 // MyMemory 需要更慢以避免限流
  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    
    const batchResults = await Promise.all(
      batch.map(async (word, index) => {
        const result = await lookupWord(word)
        onProgress?.(i + index + 1, total, word)
        return result
      })
    )
    
    results.push(...batchResults)
    
    // 添加延迟避免 API 限流
    if (i + batchSize < words.length) {
      await new Promise(resolve => setTimeout(resolve, currentProvider === 'mymemory' ? 500 : 200))
    }
  }
  
  return results
}

/**
 * 从单词列表生成完整词库
 * 优先从数据库查找已有定义，只有不存在的单词才调用在线 API
 */
export async function generateWordDefinitions(
  wordList: string[],
  onProgress?: (current: number, total: number, word: string, status: 'success' | 'failed' | 'cached') => void,
  findExistingFn?: (words: string[]) => Promise<Map<string, Partial<Word>>>
): Promise<{
  success: Partial<Word>[]
  failed: string[]
}> {
  const success: Partial<Word>[] = []
  const failed: string[] = []
  
  // 去重并清理
  const uniqueWords = [...new Set(wordList.map(w => w.trim().toLowerCase()))].filter(w => w.length > 0)
  const total = uniqueWords.length
  
  // 第一步：从数据库查找已有定义
  let existingDefinitions = new Map<string, Partial<Word>>()
  if (findExistingFn) {
    try {
      existingDefinitions = await findExistingFn(uniqueWords)
      console.log('[generateWordDefinitions] Found', existingDefinitions.size, 'existing definitions')
    } catch (error) {
      console.warn('[generateWordDefinitions] Failed to find existing definitions:', error)
    }
  }
  
  // 分离已有定义和需要查询的单词
  const wordsToQuery: string[] = []
  let processedCount = 0
  
  for (const word of uniqueWords) {
    const existing = existingDefinitions.get(word)
    if (existing && (existing.definition || existing.definition_cn)) {
      success.push(existing)
      processedCount++
      onProgress?.(processedCount, total, word, 'cached')
    } else {
      wordsToQuery.push(word)
    }
  }
  
  console.log('[generateWordDefinitions] Need to query', wordsToQuery.length, 'words from API')
  
  // 第二步：对未找到的单词调用在线 API
  const batchSize = currentProvider === 'mymemory' ? 2 : 3
  for (let i = 0; i < wordsToQuery.length; i += batchSize) {
    const batch = wordsToQuery.slice(i, i + batchSize)
    
    const batchResults = await Promise.all(
      batch.map(async (word) => {
        try {
          const result = await lookupWord(word)
          
          // 有定义或中文翻译都算成功
          if (result.definition || result.definition_cn) {
            processedCount++
            onProgress?.(processedCount, total, word, 'success')
            return { success: true, data: result }
          } else {
            processedCount++
            onProgress?.(processedCount, total, word, 'failed')
            return { success: false, word }
          }
        } catch {
          processedCount++
          onProgress?.(processedCount, total, word, 'failed')
          return { success: false, word }
        }
      })
    )
    
    batchResults.forEach(result => {
      if (result.success && 'data' in result && result.data) {
        success.push(result.data)
      } else if ('word' in result && result.word) {
        failed.push(result.word)
      }
    })
    
    // 添加延迟
    if (i + batchSize < wordsToQuery.length) {
      await new Promise(resolve => setTimeout(resolve, currentProvider === 'mymemory' ? 600 : 300))
    }
  }
  
  return { success, failed }
}

export default {
  lookupWord,
  lookupWords,
  generateWordDefinitions,
  setDictionaryProvider,
  getDictionaryProvider
}
