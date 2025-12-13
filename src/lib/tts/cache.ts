/**
 * TTS 语音缓存数据库
 * 使用 IndexedDB 存储语音数据，按文本作为 key 索引
 */

import type { TTSCacheEntry, TTSLanguage, TTSProviderType } from './types'

const DB_NAME = 'spellingbee_tts_cache'
const DB_VERSION = 1
const STORE_NAME = 'audio_cache'

// 缓存配置
const MAX_CACHE_SIZE = 500 * 1024 * 1024  // 最大缓存 500MB
const MAX_CACHE_ENTRIES = 10000           // 最大条目数
const CACHE_EXPIRY_DAYS = 30              // 缓存过期天数

class TTSCacheDB {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('Failed to open TTS cache database:', request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // 创建存储对象
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { 
            keyPath: 'id', 
            autoIncrement: true 
          })

          // 创建索引
          // 复合索引：text + language + provider + voiceId（用于精确查找）
          store.createIndex('cache_key', ['text', 'language', 'provider', 'voiceId'], { unique: true })
          // 文本索引（用于模糊查找）
          store.createIndex('text', 'text', { unique: false })
          // 语言索引
          store.createIndex('language', 'language', { unique: false })
          // 供应商索引
          store.createIndex('provider', 'provider', { unique: false })
          // 创建时间索引（用于清理过期缓存）
          store.createIndex('createdAt', 'createdAt', { unique: false })
          // 最后使用时间索引（用于 LRU 清理）
          store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false })
        }
      }
    })

    return this.initPromise
  }

  /**
   * 确保数据库已初始化
   */
  private async ensureDB(): Promise<IDBDatabase> {
    await this.init()
    if (!this.db) {
      throw new Error('TTS cache database not initialized')
    }
    return this.db
  }

  /**
   * 生成缓存 key
   */
  private getCacheKey(text: string, language: TTSLanguage, provider: TTSProviderType, voiceId: string): IDBValidKey {
    return [text, language, provider, voiceId]
  }

  /**
   * 获取缓存条目
   */
  async get(
    text: string, 
    language: TTSLanguage, 
    provider: TTSProviderType, 
    voiceId: string
  ): Promise<TTSCacheEntry | null> {
    const db = await this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('cache_key')
      const key = this.getCacheKey(text, language, provider, voiceId)

      const request = index.get(key)

      request.onsuccess = () => {
        const entry = request.result as TTSCacheEntry | undefined
        if (entry) {
          // 更新最后使用时间和使用次数
          entry.lastUsedAt = Date.now()
          entry.useCount = (entry.useCount || 0) + 1
          store.put(entry)
          resolve(entry)
        } else {
          resolve(null)
        }
      }

      request.onerror = () => {
        console.error('Failed to get TTS cache entry:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 存储缓存条目
   */
  async set(entry: Omit<TTSCacheEntry, 'id' | 'createdAt' | 'lastUsedAt' | 'useCount'>): Promise<void> {
    const db = await this.ensureDB()

    // 先检查是否需要清理空间
    await this.ensureSpace(entry.audioData.byteLength)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('cache_key')
      const key = this.getCacheKey(entry.text, entry.language, entry.provider, entry.voiceId)

      // 先检查是否已存在
      const getRequest = index.get(key)

      getRequest.onsuccess = () => {
        const existing = getRequest.result as TTSCacheEntry | undefined
        
        const now = Date.now()
        const newEntry: TTSCacheEntry = {
          ...entry,
          id: existing?.id,
          createdAt: existing?.createdAt || now,
          lastUsedAt: now,
          useCount: (existing?.useCount || 0) + 1
        }

        const putRequest = store.put(newEntry)

        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => {
          console.error('Failed to store TTS cache entry:', putRequest.error)
          reject(putRequest.error)
        }
      }

      getRequest.onerror = () => {
        console.error('Failed to check existing TTS cache entry:', getRequest.error)
        reject(getRequest.error)
      }
    })
  }

  /**
   * 删除缓存条目
   */
  async delete(
    text: string, 
    language: TTSLanguage, 
    provider: TTSProviderType, 
    voiceId: string
  ): Promise<void> {
    const db = await this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('cache_key')
      const key = this.getCacheKey(text, language, provider, voiceId)

      const request = index.openCursor(key)

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
        }
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to delete TTS cache entry:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 清除所有缓存
   */
  async clear(): Promise<void> {
    const db = await this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => {
        console.error('Failed to clear TTS cache:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{
    count: number
    totalSize: number
    oldestEntry: number | null
    newestEntry: number | null
  }> {
    const db = await this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)

      let count = 0
      let totalSize = 0
      let oldestEntry: number | null = null
      let newestEntry: number | null = null

      const request = store.openCursor()

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          const entry = cursor.value as TTSCacheEntry
          count++
          totalSize += entry.audioData.byteLength

          if (oldestEntry === null || entry.createdAt < oldestEntry) {
            oldestEntry = entry.createdAt
          }
          if (newestEntry === null || entry.createdAt > newestEntry) {
            newestEntry = entry.createdAt
          }

          cursor.continue()
        } else {
          resolve({ count, totalSize, oldestEntry, newestEntry })
        }
      }

      request.onerror = () => {
        console.error('Failed to get TTS cache stats:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 确保有足够空间存储新条目
   */
  private async ensureSpace(requiredSize: number): Promise<void> {
    const stats = await this.getStats()

    // 检查是否超过最大条目数
    if (stats.count >= MAX_CACHE_ENTRIES) {
      await this.cleanupLRU(Math.ceil(MAX_CACHE_ENTRIES * 0.1)) // 清理 10%
    }

    // 检查是否超过最大缓存大小
    if (stats.totalSize + requiredSize > MAX_CACHE_SIZE) {
      const targetSize = MAX_CACHE_SIZE * 0.8 // 清理到 80%
      await this.cleanupBySize(stats.totalSize - targetSize + requiredSize)
    }
  }

  /**
   * 清理过期缓存
   */
  async cleanupExpired(): Promise<number> {
    const db = await this.ensureDB()
    const expiryTime = Date.now() - CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('createdAt')
      const range = IDBKeyRange.upperBound(expiryTime)

      let deletedCount = 0
      const request = index.openCursor(range)

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          deletedCount++
          cursor.continue()
        } else {
          resolve(deletedCount)
        }
      }

      request.onerror = () => {
        console.error('Failed to cleanup expired TTS cache:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * LRU 清理（删除最少使用的条目）
   */
  private async cleanupLRU(count: number): Promise<void> {
    const db = await this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('lastUsedAt')

      let deleted = 0
      const request = index.openCursor()

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor && deleted < count) {
          cursor.delete()
          deleted++
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => {
        console.error('Failed to cleanup LRU TTS cache:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 按大小清理缓存
   */
  private async cleanupBySize(targetBytes: number): Promise<void> {
    const db = await this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('lastUsedAt')

      let freedBytes = 0
      const request = index.openCursor()

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor && freedBytes < targetBytes) {
          const entry = cursor.value as TTSCacheEntry
          freedBytes += entry.audioData.byteLength
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => {
        console.error('Failed to cleanup TTS cache by size:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 按供应商清理缓存
   */
  async clearByProvider(provider: TTSProviderType): Promise<number> {
    const db = await this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('provider')

      let deletedCount = 0
      const request = index.openCursor(provider)

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          deletedCount++
          cursor.continue()
        } else {
          resolve(deletedCount)
        }
      }

      request.onerror = () => {
        console.error('Failed to clear TTS cache by provider:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initPromise = null
    }
  }
}

// 导出单例
export const ttsCache = new TTSCacheDB()
