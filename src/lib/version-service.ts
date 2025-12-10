/**
 * 版本管理服务
 * 通过 Supabase Realtime 监听版本更新，提供自动升级提示
 */

import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// 当前应用版本（构建时注入）
const currentVersion = __APP_VERSION__

interface VersionInfo {
  id: number
  version: string
  release_notes?: string
  created_at: string
}

interface VersionCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string | null
  releaseNotes?: string
}

class VersionService {
  private channel: RealtimeChannel | null = null
  private _latestVersion = ref<string | null>(null)
  private _releaseNotes = ref<string | null>(null)
  private _hasUpdate = ref(false)
  private _isChecking = ref(false)
  private updateHandlers: Set<(info: VersionInfo) => void> = new Set()
  
  get currentVersion() {
    return currentVersion
  }
  
  get latestVersion() {
    return this._latestVersion.value
  }
  
  get releaseNotes() {
    return this._releaseNotes.value
  }
  
  get hasUpdate() {
    return this._hasUpdate.value
  }
  
  get isChecking() {
    return this._isChecking.value
  }
  
  /**
   * 初始化版本服务
   * 检查一次版本并订阅实时更新
   */
  async init(): Promise<void> {
    // 检查当前版本
    await this.checkVersion()
    
    // 订阅版本更新
    this.subscribeToUpdates()
  }
  
  /**
   * 检查最新版本
   */
  async checkVersion(): Promise<VersionCheckResult> {
    this._isChecking.value = true
    
    try {
      const { data, error } = await supabase
        .from('app_versions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      if (error) {
        // 如果表为空，返回无更新
        if (error.code === 'PGRST116') {
          return {
            hasUpdate: false,
            currentVersion,
            latestVersion: null
          }
        }
        console.warn('[VersionService] Failed to check version:', error)
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion: null
        }
      }
      
      const versionInfo = data as VersionInfo
      this._latestVersion.value = versionInfo.version
      this._releaseNotes.value = versionInfo.release_notes || null
      
      // 比较版本
      const hasUpdate = this.compareVersions(versionInfo.version, currentVersion) > 0
      this._hasUpdate.value = hasUpdate
      
      return {
        hasUpdate,
        currentVersion,
        latestVersion: versionInfo.version,
        releaseNotes: versionInfo.release_notes
      }
    } catch (error) {
      console.error('[VersionService] Check version error:', error)
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: null
      }
    } finally {
      this._isChecking.value = false
    }
  }
  
  /**
   * 订阅版本更新
   */
  private subscribeToUpdates(): void {
    if (this.channel) {
      return
    }
    
    this.channel = supabase
      .channel('app-version-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'app_versions'
        },
        (payload) => {
          const versionInfo = payload.new as VersionInfo
          console.log('[VersionService] New version detected:', versionInfo.version)
          
          this._latestVersion.value = versionInfo.version
          this._releaseNotes.value = versionInfo.release_notes || null
          
          // 检查是否需要更新
          const hasUpdate = this.compareVersions(versionInfo.version, currentVersion) > 0
          this._hasUpdate.value = hasUpdate
          
          if (hasUpdate) {
            // 通知所有处理器
            this.updateHandlers.forEach(handler => {
              try {
                handler(versionInfo)
              } catch (e) {
                console.error('[VersionService] Handler error:', e)
              }
            })
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[VersionService] Subscribed to version updates')
        }
      })
  }
  
  /**
   * 添加更新处理器
   */
  onUpdate(handler: (info: VersionInfo) => void): () => void {
    this.updateHandlers.add(handler)
    return () => {
      this.updateHandlers.delete(handler)
    }
  }
  
  /**
   * 比较版本号
   * @returns 正数表示 v1 > v2，负数表示 v1 < v2，0 表示相等
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)
    
    const maxLen = Math.max(parts1.length, parts2.length)
    
    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0
      const p2 = parts2[i] || 0
      
      if (p1 > p2) return 1
      if (p1 < p2) return -1
    }
    
    return 0
  }
  
  /**
   * 清理
   */
  async destroy(): Promise<void> {
    if (this.channel) {
      await this.channel.unsubscribe()
      await supabase.removeChannel(this.channel)
      this.channel = null
    }
    this.updateHandlers.clear()
  }
}

// 导出单例
export const versionService = new VersionService()

// Vue composable
export function useVersionCheck() {
  const currentVersion = computed(() => versionService.currentVersion)
  const latestVersion = computed(() => versionService.latestVersion)
  const releaseNotes = computed(() => versionService.releaseNotes)
  const hasUpdate = computed(() => versionService.hasUpdate)
  const isChecking = computed(() => versionService.isChecking)
  
  const checkVersion = () => versionService.checkVersion()
  const onUpdate = (handler: (info: VersionInfo) => void) => versionService.onUpdate(handler)
  
  return {
    currentVersion,
    latestVersion,
    releaseNotes,
    hasUpdate,
    isChecking,
    checkVersion,
    onUpdate
  }
}

export type { VersionInfo, VersionCheckResult }
