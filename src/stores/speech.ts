import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { 
  ttsManager, 
  browserTTS,
  type TTSSettings,
  type TTSProviderType,
  type TTSLanguage,
  type BrowserTTSConfig,
  type OnlineTTSConfig,
  type AITTSConfig
} from '@/lib/tts'

const STORAGE_KEY = 'spellingbee_tts_settings'

// 旧版设置类型（用于迁移）
interface LegacySpeechSettings {
  english: { voice: string | null; rate: number; pitch: number; volume: number }
  chinese: { voice: string | null; rate: number; pitch: number; volume: number }
  spelling: { rate: number; pitch: number; interval: number }
  platform: { os: string; browser: string }
}

export const useSpeechStore = defineStore('speech', () => {
  const authStore = useAuthStore()
  
  // 初始化状态
  const initialized = ref(false)
  const loading = ref(false)
  
  // TTS 设置（使用新的 TTSSettings 类型）
  const settings = ref<TTSSettings>(ttsManager.getSettings())
  
  // 可用语音列表（浏览器语音）- 使用响应式 ref
  const availableVoices = ref<SpeechSynthesisVoice[]>([])
  const englishVoices = ref<SpeechSynthesisVoice[]>([])
  const chineseVoices = ref<SpeechSynthesisVoice[]>([])
  const englishVoiceCount = computed(() => englishVoices.value.length)
  const chineseVoiceCount = computed(() => chineseVoices.value.length)
  
  // 刷新语音列表
  function refreshVoices(): void {
    availableVoices.value = browserTTS.getRawVoices()
    englishVoices.value = browserTTS.getEnglishVoices()
    chineseVoices.value = browserTTS.getChineseVoices()
  }
  
  // 当前选中的语音对象
  const selectedEnglishVoice = computed(() => {
    const voiceName = settings.value.english.browser.voiceName
    if (!voiceName) return null
    return englishVoices.value.find(v => v.name === voiceName) || null
  })
  
  const selectedChineseVoice = computed(() => {
    const voiceName = settings.value.chinese.browser.voiceName
    if (!voiceName) return null
    return chineseVoices.value.find(v => v.name === voiceName) || null
  })
  
  // 当前激活的语音源
  const activeProvider = computed(() => settings.value.activeProvider)
  const englishProvider = computed(() => settings.value.english.provider)
  const chineseProvider = computed(() => settings.value.chinese.provider)
  
  // 迁移旧版设置到新版
  function migrateOldSettings(oldSettings: LegacySpeechSettings): Partial<TTSSettings> {
    return {
      english: {
        provider: 'browser',
        browser: {
          voiceName: oldSettings.english.voice,
          rate: oldSettings.english.rate,
          pitch: oldSettings.english.pitch,
          volume: oldSettings.english.volume
        },
        online: settings.value.english.online,
        ai: settings.value.english.ai
      },
      chinese: {
        provider: 'browser',
        browser: {
          voiceName: oldSettings.chinese.voice,
          rate: oldSettings.chinese.rate,
          pitch: oldSettings.chinese.pitch,
          volume: oldSettings.chinese.volume
        },
        online: settings.value.chinese.online,
        ai: settings.value.chinese.ai
      },
      spelling: oldSettings.spelling,
      platform: oldSettings.platform
    }
  }
  
  // 从本地存储加载设置
  function loadFromLocal(): boolean {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        
        // 检查是否是旧版设置格式
        if (parsed.english?.voice !== undefined && parsed.english?.browser === undefined) {
          // 迁移旧版设置
          const migrated = migrateOldSettings(parsed as LegacySpeechSettings)
          Object.assign(settings.value, migrated)
          // 保存迁移后的设置
          saveToLocal()
        } else {
          // 新版设置格式
          Object.assign(settings.value, parsed)
        }
        
        ttsManager.updateSettings(settings.value)
        return true
      }
    } catch (e) {
      console.error('Error loading TTS settings from local:', e)
    }
    return false
  }
  
  // 保存到本地存储
  function saveToLocal(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.error('Error saving TTS settings to local:', e)
    }
  }
  
  // 从 Supabase 加载设置
  async function loadFromCloud(): Promise<boolean> {
    if (!authStore.user) return false
    
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('speech_settings')
        .eq('user_id', authStore.user.id)
        .maybeSingle()
      
      if (error) throw error
      
      if (data?.speech_settings) {
        const cloudSettings = data.speech_settings
        
        // 检查是否是旧版设置格式
        if (cloudSettings.english?.voice !== undefined && cloudSettings.english?.browser === undefined) {
          const migrated = migrateOldSettings(cloudSettings as LegacySpeechSettings)
          Object.assign(settings.value, migrated)
        } else {
          Object.assign(settings.value, cloudSettings)
        }
        
        ttsManager.updateSettings(settings.value)
        saveToLocal()
        return true
      }
    } catch (e) {
      console.error('Error loading TTS settings from cloud:', e)
    }
    return false
  }
  
  // 保存到 Supabase
  async function saveToCloud(): Promise<boolean> {
    if (!authStore.user) return false
    
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: authStore.user.id,
          speech_settings: settings.value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })
      
      if (error) throw error
      return true
    } catch (e) {
      console.error('Error saving TTS settings to cloud:', e)
      return false
    }
  }
  
  // 保存设置（同时保存到本地和云端）
  async function saveSettings(): Promise<void> {
    ttsManager.updateSettings(settings.value)
    saveToLocal()
    if (authStore.user) {
      await saveToCloud()
    }
  }
  
  // 初始化
  async function init(): Promise<void> {
    if (initialized.value) return
    
    loading.value = true
    try {
      // 1. 初始化 TTS 管理器
      await ttsManager.init()
      
      // 2. 刷新语音列表（使其响应式）
      refreshVoices()
      
      // 3. 获取默认设置
      settings.value = ttsManager.getSettings()
      
      // 4. 从本地加载
      loadFromLocal()
      
      // 5. 如果用户已登录，从云端加载
      if (authStore.user) {
        await loadFromCloud()
      }
      
      // 6. 验证浏览器语音
      validateBrowserVoices()
      
      initialized.value = true
    } catch (e) {
      console.error('Error initializing speech store:', e)
    } finally {
      loading.value = false
    }
  }
  
  // 验证浏览器语音是否可用
  function validateBrowserVoices(): void {
    const enVoices = englishVoices.value
    const zhVoices = chineseVoices.value
    
    // 验证英文语音
    if (settings.value.english.browser.voiceName) {
      const exists = enVoices.some(v => v.name === settings.value.english.browser.voiceName)
      if (!exists) {
        settings.value.english.browser.voiceName = browserTTS.getBestVoice('en')
      }
    } else {
      settings.value.english.browser.voiceName = browserTTS.getBestVoice('en')
    }
    
    // 验证中文语音
    if (settings.value.chinese.browser.voiceName) {
      const exists = zhVoices.some(v => v.name === settings.value.chinese.browser.voiceName)
      if (!exists) {
        settings.value.chinese.browser.voiceName = browserTTS.getBestVoice('zh')
      }
    } else {
      settings.value.chinese.browser.voiceName = browserTTS.getBestVoice('zh')
    }
    
    ttsManager.updateSettings(settings.value)
  }
  
  // 设置激活的语音源
  function setActiveProvider(provider: TTSProviderType): void {
    settings.value.activeProvider = provider
    ttsManager.setActiveProvider(provider)
    saveSettings()
  }
  
  // 设置语言的语音源
  function setLanguageProvider(language: TTSLanguage, provider: TTSProviderType): void {
    if (language === 'en') {
      settings.value.english.provider = provider
    } else {
      settings.value.chinese.provider = provider
    }
    ttsManager.setLanguageProvider(language, provider)
    saveSettings()
  }
  
  // 更新浏览器语音设置（兼容旧接口）
  function updateEnglishSettings(newSettings: Partial<BrowserTTSConfig & { voice?: string | null }>): void {
    // 兼容旧的 voice 字段
    if (newSettings.voice !== undefined) {
      newSettings.voiceName = newSettings.voice
      delete newSettings.voice
    }
    Object.assign(settings.value.english.browser, newSettings)
    ttsManager.updateBrowserConfig('en', settings.value.english.browser)
    saveSettings()
  }
  
  function updateChineseSettings(newSettings: Partial<BrowserTTSConfig & { voice?: string | null }>): void {
    if (newSettings.voice !== undefined) {
      newSettings.voiceName = newSettings.voice
      delete newSettings.voice
    }
    Object.assign(settings.value.chinese.browser, newSettings)
    ttsManager.updateBrowserConfig('zh', settings.value.chinese.browser)
    saveSettings()
  }
  
  // 更新字母拼读设置
  function updateSpellingSettings(newSettings: Partial<{ rate: number; pitch: number; interval: number }>): void {
    Object.assign(settings.value.spelling, newSettings)
    ttsManager.updateSpellingConfig(newSettings)
    saveSettings()
  }
  
  // 更新在线语音设置
  function updateOnlineSettings(language: TTSLanguage, config: Partial<OnlineTTSConfig>): void {
    if (language === 'en') {
      Object.assign(settings.value.english.online, config)
    } else {
      Object.assign(settings.value.chinese.online, config)
    }
    ttsManager.updateOnlineConfig(language, config)
    saveSettings()
  }
  
  // 更新 AI 语音设置
  function updateAISettings(language: TTSLanguage, config: Partial<AITTSConfig>): void {
    if (language === 'en') {
      Object.assign(settings.value.english.ai, config)
    } else {
      Object.assign(settings.value.chinese.ai, config)
    }
    ttsManager.updateAIConfig(language, config)
    saveSettings()
  }
  
  // 重置为默认设置
  function resetToDefaults(): void {
    ttsManager.resetToDefaults()
    settings.value = ttsManager.getSettings()
    saveSettings()
  }
  
  // 朗读英文
  async function speakEnglish(text: string, options?: { rate?: number; pitch?: number; volume?: number; voice?: string }): Promise<void> {
    await ttsManager.speakEnglish(text, options)
  }
  
  // 朗读中文
  async function speakChinese(text: string, options?: { rate?: number; pitch?: number; volume?: number; voice?: string }): Promise<void> {
    await ttsManager.speakChinese(text, options)
  }
  
  // 朗读单词
  async function speakWord(word: string, options?: { rate?: number; pitch?: number; volume?: number }): Promise<void> {
    await ttsManager.speakWord(word, options)
  }
  
  // 朗读字母
  async function speakLetter(letter: string, options?: { rate?: number; pitch?: number }): Promise<void> {
    await ttsManager.speakLetter(letter, options)
  }
  
  // 获取字母拼读间隔
  function getSpellingInterval(): number {
    return ttsManager.getSpellingInterval()
  }
  
  // 停止播放
  function stop(): void {
    ttsManager.stop()
  }
  
  // 试听英文语音
  async function previewEnglish(voiceName?: string, rate?: number, pitch?: number, volume?: number): Promise<void> {
    // 临时设置语音参数
    const originalConfig = { ...settings.value.english.browser }
    if (voiceName) settings.value.english.browser.voiceName = voiceName
    if (rate !== undefined) settings.value.english.browser.rate = rate
    if (pitch !== undefined) settings.value.english.browser.pitch = pitch
    if (volume !== undefined) settings.value.english.browser.volume = volume
    
    ttsManager.updateBrowserConfig('en', settings.value.english.browser)
    
    try {
      // 强制使用浏览器语音进行试听
      await ttsManager.previewEnglish('browser')
    } finally {
      // 恢复原始配置
      settings.value.english.browser = originalConfig
      ttsManager.updateBrowserConfig('en', originalConfig)
    }
  }
  
  // 试听中文语音
  async function previewChinese(voiceName?: string, rate?: number, pitch?: number, volume?: number): Promise<void> {
    const originalConfig = { ...settings.value.chinese.browser }
    if (voiceName) settings.value.chinese.browser.voiceName = voiceName
    if (rate !== undefined) settings.value.chinese.browser.rate = rate
    if (pitch !== undefined) settings.value.chinese.browser.pitch = pitch
    if (volume !== undefined) settings.value.chinese.browser.volume = volume
    
    ttsManager.updateBrowserConfig('zh', settings.value.chinese.browser)
    
    try {
      // 强制使用浏览器语音进行试听
      await ttsManager.previewChinese('browser')
    } finally {
      settings.value.chinese.browser = originalConfig
      ttsManager.updateBrowserConfig('zh', originalConfig)
    }
  }
  
  // 获取在线语音供应商列表
  function getOnlineProviders() {
    return ttsManager.getOnlineProviders()
  }
  
  // 获取 AI 语音供应商列表
  function getAIProviders() {
    return ttsManager.getAIProviders()
  }
  
  // 获取缓存统计
  async function getCacheStats() {
    return ttsManager.getCacheStats()
  }
  
  // 清理缓存
  async function clearCache(): Promise<void> {
    await ttsManager.clearCache()
  }
  
  // 检查供应商是否可用
  function isProviderAvailable(provider: TTSProviderType): boolean {
    return ttsManager.isProviderAvailable(provider)
  }
  
  // 监听用户登录状态变化
  watch(() => authStore.user, async (newUser, oldUser) => {
    if (newUser && !oldUser) {
      await loadFromCloud()
      validateBrowserVoices()
    }
  })
  
  // 兼容旧版接口
  const legacySettings = computed(() => ({
    english: {
      voice: settings.value.english.browser.voiceName,
      rate: settings.value.english.browser.rate,
      pitch: settings.value.english.browser.pitch,
      volume: settings.value.english.browser.volume
    },
    chinese: {
      voice: settings.value.chinese.browser.voiceName,
      rate: settings.value.chinese.browser.rate,
      pitch: settings.value.chinese.browser.pitch,
      volume: settings.value.chinese.browser.volume
    },
    spelling: settings.value.spelling,
    platform: settings.value.platform
  }))
  
  return {
    // State
    availableVoices,
    englishVoices,
    chineseVoices,
    englishVoiceCount,
    chineseVoiceCount,
    settings: legacySettings, // 兼容旧版
    ttsSettings: settings,    // 新版完整设置
    initialized,
    loading,
    selectedEnglishVoice,
    selectedChineseVoice,
    activeProvider,
    englishProvider,
    chineseProvider,
    
    // Actions
    init,
    loadVoices: () => browserTTS.init(),
    saveSettings,
    updateEnglishSettings,
    updateChineseSettings,
    updateSpellingSettings,
    updateOnlineSettings,
    updateAISettings,
    setActiveProvider,
    setLanguageProvider,
    resetToDefaults,
    speakEnglish,
    speakChinese,
    speakWord,
    speakLetter,
    getSpellingInterval,
    stop,
    previewEnglish,
    previewChinese,
    loadFromCloud,
    saveToCloud,
    getOnlineProviders,
    getAIProviders,
    getCacheStats,
    clearCache,
    isProviderAvailable
  }
})
