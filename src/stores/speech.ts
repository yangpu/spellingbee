import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import type { SpeechSettings, VoiceSettings, SpellingSettings } from '@/types'

const STORAGE_KEY = 'spellingbee_speech_settings'

interface Platform {
  os: string
  browser: string
}

// 检测操作系统和浏览器（改进版，优先检测移动端）
function detectPlatform(): Platform {
  const ua = navigator.userAgent
  
  // 操作系统检测 - 优先检测移动端
  let os = 'unknown'
  
  // iOS 检测（必须在 mac 之前，因为 iPad 的 UA 可能包含 Mac）
  if (/iPhone|iPad|iPod/i.test(ua)) {
    os = 'ios'
  }
  // Android 检测
  else if (/Android/i.test(ua)) {
    os = 'android'
  }
  // macOS 检测（排除 iOS 后）
  else if (/Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) {
    os = 'macos'
  }
  // Windows 检测
  else if (/Windows/i.test(ua)) {
    os = 'windows'
  }
  // Linux 检测
  else if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    os = 'linux'
  }
  
  // 浏览器检测 - 按优先级检测
  let browser = 'unknown'
  
  // Edge 检测（必须在 Chrome 之前，因为 Edge 的 UA 包含 Chrome）
  if (/Edg/i.test(ua)) {
    browser = 'edge'
  }
  // Firefox 检测
  else if (/Firefox/i.test(ua)) {
    browser = 'firefox'
  }
  // Chrome 检测（排除 Edge 后）
  else if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) {
    browser = 'chrome'
  }
  // Safari 检测（排除 Chrome 和 Edge 后，因为它们的 UA 也包含 Safari）
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua) && !/Edg/i.test(ua)) {
    browser = 'safari'
  }
  
  return { os, browser }
}

// 获取默认最优配置（针对教育场景）
function getDefaultSettings(): SpeechSettings {
  const { os } = detectPlatform()
  
  // 英文语音默认配置（教育场景：清晰、标准、适中语速）
  const englishDefaults: VoiceSettings = {
    voice: null, // 将在 voices 加载后选择最优
    rate: 0.85,  // 稍慢语速，便于学生听清
    pitch: 1.0,  // 标准音高
    volume: 1.0, // 满音量
  }
  
  // 中文语音默认配置
  const chineseDefaults: VoiceSettings = {
    voice: null,
    rate: 1.0,   // 标准语速
    pitch: 1.0,
    volume: 1.0,
  }
  
  // 字母拼读默认配置
  const spellingDefaults: SpellingSettings = {
    rate: 1.1,      // 字母朗读稍快
    pitch: 1.1,     // 稍高音调
    interval: 120,  // 字母间隔 120ms
  }
  
  // 根据平台调整默认值
  if (os === 'macos') {
    englishDefaults.rate = 0.8
    chineseDefaults.rate = 0.95
    spellingDefaults.rate = 1.0
    spellingDefaults.interval = 120
  } else if (os === 'windows') {
    // Windows 的 TTS 引擎字母朗读较慢，需要加快
    englishDefaults.rate = 0.9
    chineseDefaults.rate = 1.0
    spellingDefaults.rate = 1.5   // Windows 需要更快的语速
    spellingDefaults.pitch = 1.15 // 稍高音调让字母更清晰
    spellingDefaults.interval = 80 // 缩短间隔
  } else if (os === 'ios' || os === 'android') {
    // 移动端可能需要稍快一点
    englishDefaults.rate = 0.85
    chineseDefaults.rate = 1.0
    spellingDefaults.rate = 1.1
    spellingDefaults.interval = 100
  }
  
  return {
    english: englishDefaults,
    chinese: chineseDefaults,
    spelling: spellingDefaults,
    platform: detectPlatform()
  }
}

// 优选英文语音列表（教育场景优先）
const PREFERRED_ENGLISH_VOICES = [
  // macOS 优质语音
  'Samantha', 'Alex', 'Daniel', 'Karen', 'Moira', 'Tessa',
  // Windows 优质语音
  'Microsoft Zira', 'Microsoft David', 'Microsoft Mark',
  // Google 语音
  'Google US English', 'Google UK English Female', 'Google UK English Male',
  // 通用
  'English United States', 'English'
]

// 优选中文语音列表
const PREFERRED_CHINESE_VOICES = [
  // macOS 优质语音
  'Tingting', 'Sinji', 'Meijia', 'Lili',
  // Windows 优质语音
  'Microsoft Xiaoxiao', 'Microsoft Yunxi', 'Microsoft Huihui', 'Microsoft Kangkang',
  // Google 语音
  'Google 普通话', 'Google 中文',
  // 通用
  'Chinese', '中文'
]

export const useSpeechStore = defineStore('speech', () => {
  const authStore = useAuthStore()
  
  // 可用语音列表
  const availableVoices = ref<SpeechSynthesisVoice[]>([])
  
  // 英文语音（过滤出实际可用的）
  const englishVoices = computed(() => 
    availableVoices.value.filter(v => v.lang.startsWith('en'))
  )
  
  // 中文语音（过滤出实际可用的）
  const chineseVoices = computed(() => 
    availableVoices.value.filter(v => v.lang.startsWith('zh'))
  )
  
  // 英文语音数量
  const englishVoiceCount = computed(() => englishVoices.value.length)
  
  // 中文语音数量
  const chineseVoiceCount = computed(() => chineseVoices.value.length)
  
  // 当前设置
  const settings = ref<SpeechSettings>(getDefaultSettings())
  const initialized = ref(false)
  const loading = ref(false)
  
  // 获取当前选中的英文语音对象
  const selectedEnglishVoice = computed(() => {
    if (!settings.value.english.voice) return null
    return availableVoices.value.find(v => v.name === settings.value.english.voice) || null
  })
  
  // 获取当前选中的中文语音对象
  const selectedChineseVoice = computed(() => {
    if (!settings.value.chinese.voice) return null
    return availableVoices.value.find(v => v.name === settings.value.chinese.voice) || null
  })
  
  // 加载可用语音
  function loadVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      const voices = speechSynthesis.getVoices()
      if (voices.length > 0) {
        availableVoices.value = voices
        resolve(voices)
      } else {
        // 某些浏览器需要等待 voiceschanged 事件
        speechSynthesis.onvoiceschanged = () => {
          availableVoices.value = speechSynthesis.getVoices()
          resolve(availableVoices.value)
        }
        // 超时处理
        setTimeout(() => {
          if (availableVoices.value.length === 0) {
            availableVoices.value = speechSynthesis.getVoices()
          }
          resolve(availableVoices.value)
        }, 1000)
      }
    })
  }
  
  // 选择最优语音（优先检查优选列表，否则选择第一个可用语音）
  function selectBestVoice(voices: SpeechSynthesisVoice[], preferredList: string[], langPrefix: string): string | null {
    // 过滤出匹配语言的语音
    const langVoices = voices.filter(v => v.lang.startsWith(langPrefix))
    if (langVoices.length === 0) return null
    
    // 按优先级查找优选语音
    for (const preferred of preferredList) {
      const voice = langVoices.find(v => 
        v.name.toLowerCase().includes(preferred.toLowerCase())
      )
      if (voice) return voice.name
    }
    
    // 回退：返回第一个可用语音
    return langVoices[0].name
  }
  
  // 初始化默认语音
  function initDefaultVoices(): void {
    if (!settings.value.english.voice) {
      settings.value.english.voice = selectBestVoice(
        availableVoices.value, 
        PREFERRED_ENGLISH_VOICES, 
        'en'
      )
    }
    if (!settings.value.chinese.voice) {
      settings.value.chinese.voice = selectBestVoice(
        availableVoices.value, 
        PREFERRED_CHINESE_VOICES, 
        'zh'
      )
    }
  }
  
  // 从本地存储加载设置
  function loadFromLocal(): boolean {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SpeechSettings>
        // 合并设置，保留默认值作为回退
        if (parsed.english) {
          Object.assign(settings.value.english, parsed.english)
        }
        if (parsed.chinese) {
          Object.assign(settings.value.chinese, parsed.chinese)
        }
        if (parsed.spelling) {
          Object.assign(settings.value.spelling, parsed.spelling)
        }
        return true
      }
    } catch (e) {
      console.error('Error loading speech settings from local:', e)
    }
    return false
  }
  
  // 保存到本地存储
  function saveToLocal(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        english: settings.value.english,
        chinese: settings.value.chinese,
        spelling: settings.value.spelling,
        platform: settings.value.platform
      }))
    } catch (e) {
      console.error('Error saving speech settings to local:', e)
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
        .single()
      
      if (error) {
        // 如果是没有记录的错误，不算失败
        if (error.code === 'PGRST116') return false
        throw error
      }
      
      if (data?.speech_settings) {
        const cloudSettings = data.speech_settings as Partial<SpeechSettings>
        if (cloudSettings.english) {
          Object.assign(settings.value.english, cloudSettings.english)
        }
        if (cloudSettings.chinese) {
          Object.assign(settings.value.chinese, cloudSettings.chinese)
        }
        if (cloudSettings.spelling) {
          Object.assign(settings.value.spelling, cloudSettings.spelling)
        }
        // 同步到本地
        saveToLocal()
        return true
      }
    } catch (e) {
      console.error('Error loading speech settings from cloud:', e)
    }
    return false
  }
  
  // 保存到 Supabase
  async function saveToCloud(): Promise<boolean> {
    if (!authStore.user) return false
    
    try {
      const settingsData = {
        english: settings.value.english,
        chinese: settings.value.chinese,
        spelling: settings.value.spelling,
        platform: settings.value.platform,
        updated_at: new Date().toISOString()
      }
      
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: authStore.user.id,
          speech_settings: settingsData,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })
      
      if (error) throw error
      return true
    } catch (e) {
      console.error('Error saving speech settings to cloud:', e)
      return false
    }
  }
  
  // 保存设置（同时保存到本地和云端）
  async function saveSettings(): Promise<void> {
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
      // 1. 加载可用语音
      await loadVoices()
      
      // 2. 先从本地加载
      loadFromLocal()
      
      // 3. 如果用户已登录，尝试从云端加载（云端优先）
      if (authStore.user) {
        await loadFromCloud()
      }
      
      // 4. 如果没有设置语音，选择最优默认语音
      initDefaultVoices()
      
      // 5. 验证当前选中的语音是否仍然可用
      validateVoices()
      
      initialized.value = true
    } catch (e) {
      console.error('Error initializing speech store:', e)
    } finally {
      loading.value = false
    }
  }
  
  // 验证语音是否可用（优先检查优选语音，否则选择第一个可用）
  function validateVoices(): void {
    // 验证英文语音
    if (settings.value.english.voice) {
      const exists = englishVoices.value.some(v => v.name === settings.value.english.voice)
      if (!exists) {
        // 当前语音不可用，重新选择
        settings.value.english.voice = selectBestVoice(
          availableVoices.value, 
          PREFERRED_ENGLISH_VOICES, 
          'en'
        )
      }
    } else {
      // 没有设置语音，选择最优
      settings.value.english.voice = selectBestVoice(
        availableVoices.value, 
        PREFERRED_ENGLISH_VOICES, 
        'en'
      )
    }
    
    // 验证中文语音
    if (settings.value.chinese.voice) {
      const exists = chineseVoices.value.some(v => v.name === settings.value.chinese.voice)
      if (!exists) {
        // 当前语音不可用，重新选择
        settings.value.chinese.voice = selectBestVoice(
          availableVoices.value, 
          PREFERRED_CHINESE_VOICES, 
          'zh'
        )
      }
    } else {
      // 没有设置语音，选择最优
      settings.value.chinese.voice = selectBestVoice(
        availableVoices.value, 
        PREFERRED_CHINESE_VOICES, 
        'zh'
      )
    }
  }
  
  // 更新英文语音设置
  function updateEnglishSettings(newSettings: Partial<VoiceSettings>): void {
    Object.assign(settings.value.english, newSettings)
    saveSettings()
  }
  
  // 更新中文语音设置
  function updateChineseSettings(newSettings: Partial<VoiceSettings>): void {
    Object.assign(settings.value.chinese, newSettings)
    saveSettings()
  }
  
  // 更新字母拼读设置
  function updateSpellingSettings(newSettings: Partial<SpellingSettings>): void {
    Object.assign(settings.value.spelling, newSettings)
    saveSettings()
  }
  
  // 重置为默认设置
  function resetToDefaults(): void {
    const defaults = getDefaultSettings()
    settings.value.english = { ...defaults.english }
    settings.value.chinese = { ...defaults.chinese }
    settings.value.spelling = { ...defaults.spelling }
    initDefaultVoices()
    saveSettings()
  }
  
  interface SpeakOptions {
    rate?: number
    pitch?: number
    volume?: number
    voice?: string
  }
  
  // 朗读英文文本
  function speakEnglish(text: string, options: SpeakOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      speechSynthesis.cancel()
      
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      
      // 应用设置
      utterance.rate = options.rate ?? settings.value.english.rate
      utterance.pitch = options.pitch ?? settings.value.english.pitch
      utterance.volume = options.volume ?? settings.value.english.volume
      
      // 设置语音
      const voiceName = options.voice ?? settings.value.english.voice
      if (voiceName) {
        const voice = availableVoices.value.find(v => v.name === voiceName)
        if (voice) utterance.voice = voice
      }
      
      utterance.onend = () => resolve()
      utterance.onerror = (e) => {
        // 忽略取消错误（用户快速操作时会触发）
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve()
        } else {
          reject(e)
        }
      }
      
      speechSynthesis.speak(utterance)
    })
  }
  
  // 朗读中文文本
  function speakChinese(text: string, options: SpeakOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      speechSynthesis.cancel()
      
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      
      // 应用设置
      utterance.rate = options.rate ?? settings.value.chinese.rate
      utterance.pitch = options.pitch ?? settings.value.chinese.pitch
      utterance.volume = options.volume ?? settings.value.chinese.volume
      
      // 设置语音
      const voiceName = options.voice ?? settings.value.chinese.voice
      if (voiceName) {
        const voice = availableVoices.value.find(v => v.name === voiceName)
        if (voice) utterance.voice = voice
      }
      
      utterance.onend = () => resolve()
      utterance.onerror = (e) => {
        // 忽略取消错误（用户快速操作时会触发）
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve()
        } else {
          reject(e)
        }
      }
      
      speechSynthesis.speak(utterance)
    })
  }
  
  // 朗读单词（英文，用于学习和比赛）
  function speakWord(word: string, options: SpeakOptions = {}): Promise<void> {
    // 单词朗读使用稍慢的语速
    const wordRate = options.rate ?? Math.max(0.6, settings.value.english.rate - 0.15)
    return speakEnglish(word, { ...options, rate: wordRate })
  }
  
  // 朗读字母（英文，用于拼读）
  function speakLetter(letter: string, options: SpeakOptions = {}): Promise<void> {
    // 使用字母拼读专用配置
    const letterRate = options.rate ?? settings.value.spelling.rate
    const letterPitch = options.pitch ?? settings.value.spelling.pitch
    return speakEnglish(letter, { ...options, rate: letterRate, pitch: letterPitch })
  }
  
  // 获取字母拼读间隔时间
  function getSpellingInterval(): number {
    return settings.value.spelling.interval
  }
  
  // 试听英文语音
  function previewEnglish(voiceName: string, rate: number, pitch: number, volume: number): Promise<void> {
    const testText = 'Hello, this is a test of the English voice.'
    return speakEnglish(testText, { voice: voiceName, rate, pitch, volume })
  }
  
  // 试听中文语音
  function previewChinese(voiceName: string, rate: number, pitch: number, volume: number): Promise<void> {
    const testText = '你好，这是中文语音测试。'
    return speakChinese(testText, { voice: voiceName, rate, pitch, volume })
  }
  
  // 监听用户登录状态变化
  watch(() => authStore.user, async (newUser, oldUser) => {
    if (newUser && !oldUser) {
      // 用户登录后，从云端同步设置
      await loadFromCloud()
      validateVoices()
    }
  })
  
  return {
    // State
    availableVoices,
    englishVoices,
    chineseVoices,
    englishVoiceCount,
    chineseVoiceCount,
    settings,
    initialized,
    loading,
    selectedEnglishVoice,
    selectedChineseVoice,
    
    // Actions
    init,
    loadVoices,
    saveSettings,
    updateEnglishSettings,
    updateChineseSettings,
    updateSpellingSettings,
    resetToDefaults,
    speakEnglish,
    speakChinese,
    speakWord,
    speakLetter,
    getSpellingInterval,
    previewEnglish,
    previewChinese,
    loadFromCloud,
    saveToCloud
  }
})
