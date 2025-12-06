import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'

const STORAGE_KEY = 'spellingbee_speech_settings'

// 检测操作系统和浏览器
function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() || ''
  
  let os = 'unknown'
  if (platform.includes('mac') || ua.includes('mac')) os = 'macos'
  else if (platform.includes('win') || ua.includes('win')) os = 'windows'
  else if (ua.includes('android')) os = 'android'
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) os = 'ios'
  else if (ua.includes('linux')) os = 'linux'
  
  let browser = 'unknown'
  if (ua.includes('chrome') && !ua.includes('edg')) browser = 'chrome'
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'safari'
  else if (ua.includes('firefox')) browser = 'firefox'
  else if (ua.includes('edg')) browser = 'edge'
  
  return { os, browser }
}

// 获取默认最优配置（针对教育场景）
function getDefaultSettings() {
  const { os, browser } = detectPlatform()
  
  // 英文语音默认配置（教育场景：清晰、标准、适中语速）
  const englishDefaults = {
    voice: null, // 将在 voices 加载后选择最优
    rate: 0.85,  // 稍慢语速，便于学生听清
    pitch: 1.0,  // 标准音高
    volume: 1.0, // 满音量
  }
  
  // 中文语音默认配置
  const chineseDefaults = {
    voice: null,
    rate: 1.0,   // 标准语速
    pitch: 1.0,
    volume: 1.0,
  }
  
  // 根据平台调整默认值
  if (os === 'macos') {
    englishDefaults.rate = 0.8
    chineseDefaults.rate = 0.95
  } else if (os === 'windows') {
    englishDefaults.rate = 0.9
    chineseDefaults.rate = 1.0
  } else if (os === 'ios' || os === 'android') {
    // 移动端可能需要稍快一点
    englishDefaults.rate = 0.85
    chineseDefaults.rate = 1.0
  }
  
  return {
    english: englishDefaults,
    chinese: chineseDefaults,
    platform: { os, browser }
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
  const availableVoices = ref([])
  const englishVoices = computed(() => 
    availableVoices.value.filter(v => v.lang.startsWith('en'))
  )
  const chineseVoices = computed(() => 
    availableVoices.value.filter(v => v.lang.startsWith('zh'))
  )
  
  // 当前设置
  const settings = ref(getDefaultSettings())
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
  function loadVoices() {
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
  
  // 选择最优语音
  function selectBestVoice(voices, preferredList, langPrefix) {
    // 按优先级查找
    for (const preferred of preferredList) {
      const voice = voices.find(v => 
        v.name.includes(preferred) && v.lang.startsWith(langPrefix)
      )
      if (voice) return voice.name
    }
    
    // 回退：找任何匹配语言的语音
    const fallback = voices.find(v => v.lang.startsWith(langPrefix))
    return fallback?.name || null
  }
  
  // 初始化默认语音
  function initDefaultVoices() {
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
  function loadFromLocal() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        // 合并设置，保留默认值作为回退
        if (parsed.english) {
          Object.assign(settings.value.english, parsed.english)
        }
        if (parsed.chinese) {
          Object.assign(settings.value.chinese, parsed.chinese)
        }
        return true
      }
    } catch (e) {
      console.error('Error loading speech settings from local:', e)
    }
    return false
  }
  
  // 保存到本地存储
  function saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        english: settings.value.english,
        chinese: settings.value.chinese,
        platform: settings.value.platform
      }))
    } catch (e) {
      console.error('Error saving speech settings to local:', e)
    }
  }
  
  // 从 Supabase 加载设置
  async function loadFromCloud() {
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
        const cloudSettings = data.speech_settings
        if (cloudSettings.english) {
          Object.assign(settings.value.english, cloudSettings.english)
        }
        if (cloudSettings.chinese) {
          Object.assign(settings.value.chinese, cloudSettings.chinese)
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
  async function saveToCloud() {
    if (!authStore.user) return false
    
    try {
      const settingsData = {
        english: settings.value.english,
        chinese: settings.value.chinese,
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
  async function saveSettings() {
    saveToLocal()
    if (authStore.user) {
      await saveToCloud()
    }
  }
  
  // 初始化
  async function init() {
    if (initialized.value) return
    
    loading.value = true
    try {
      // 1. 加载可用语音
      await loadVoices()
      
      // 2. 先从本地加载
      const hasLocal = loadFromLocal()
      
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
  
  // 验证语音是否可用
  function validateVoices() {
    // 验证英文语音
    if (settings.value.english.voice) {
      const exists = availableVoices.value.some(v => v.name === settings.value.english.voice)
      if (!exists) {
        settings.value.english.voice = selectBestVoice(
          availableVoices.value, 
          PREFERRED_ENGLISH_VOICES, 
          'en'
        )
      }
    }
    
    // 验证中文语音
    if (settings.value.chinese.voice) {
      const exists = availableVoices.value.some(v => v.name === settings.value.chinese.voice)
      if (!exists) {
        settings.value.chinese.voice = selectBestVoice(
          availableVoices.value, 
          PREFERRED_CHINESE_VOICES, 
          'zh'
        )
      }
    }
  }
  
  // 更新英文语音设置
  function updateEnglishSettings(newSettings) {
    Object.assign(settings.value.english, newSettings)
    saveSettings()
  }
  
  // 更新中文语音设置
  function updateChineseSettings(newSettings) {
    Object.assign(settings.value.chinese, newSettings)
    saveSettings()
  }
  
  // 重置为默认设置
  function resetToDefaults() {
    const defaults = getDefaultSettings()
    settings.value.english = { ...defaults.english }
    settings.value.chinese = { ...defaults.chinese }
    initDefaultVoices()
    saveSettings()
  }
  
  // 朗读英文文本
  function speakEnglish(text, options = {}) {
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
  function speakChinese(text, options = {}) {
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
  function speakWord(word, options = {}) {
    // 单词朗读使用稍慢的语速
    const wordRate = options.rate ?? Math.max(0.6, settings.value.english.rate - 0.15)
    return speakEnglish(word, { ...options, rate: wordRate })
  }
  
  // 朗读字母（英文，用于拼读）
  function speakLetter(letter, options = {}) {
    // 字母朗读使用稍快的语速和稍高的音调
    const letterRate = options.rate ?? Math.min(1.0, settings.value.english.rate + 0.1)
    const letterPitch = options.pitch ?? Math.min(1.2, settings.value.english.pitch + 0.1)
    return speakEnglish(letter, { ...options, rate: letterRate, pitch: letterPitch })
  }
  
  // 试听英文语音
  function previewEnglish(voiceName, rate, pitch, volume) {
    const testText = 'Hello, this is a test of the English voice.'
    return speakEnglish(testText, { voice: voiceName, rate, pitch, volume })
  }
  
  // 试听中文语音
  function previewChinese(voiceName, rate, pitch, volume) {
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
    resetToDefaults,
    speakEnglish,
    speakChinese,
    speakWord,
    speakLetter,
    previewEnglish,
    previewChinese,
    loadFromCloud,
    saveToCloud
  }
})
