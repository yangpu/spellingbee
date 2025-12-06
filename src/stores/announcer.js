import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAuthStore } from './auth'
import { useSpeechStore } from './speech'
import { supabase } from '@/lib/supabase'

const STORAGE_KEY = 'spellingbee_announcer_settings'

export const useAnnouncerStore = defineStore('announcer', () => {
  const authStore = useAuthStore()
  const speechStore = useSpeechStore()
  
  // 默认设置
  const defaultSettings = {
    type: 'human', // 'human' | 'animal'
    human: {
      correctPhrase: 'Correct!',
      incorrectPhrase: 'Incorrect.'
    },
    animal: {
      success: {
        type: 'cat',
        soundFile: '/sounds/meow.wav'
      },
      failure: {
        type: 'dog',
        soundFile: '/sounds/bark.wav'
      }
    }
  }
  
  // 当前设置
  const settings = ref({ ...defaultSettings })
  const initialized = ref(false)
  
  // 音频缓存
  const audioCache = ref({})
  
  // 预加载音频
  async function preloadAudio(url) {
    if (audioCache.value[url]) return audioCache.value[url]
    
    return new Promise((resolve, reject) => {
      const audio = new Audio()
      audio.preload = 'auto'
      audio.src = url
      
      audio.oncanplaythrough = () => {
        audioCache.value[url] = audio
        resolve(audio)
      }
      
      audio.onerror = (e) => {
        console.error('Failed to load audio:', url, e)
        reject(e)
      }
      
      // 超时处理
      setTimeout(() => {
        if (!audioCache.value[url]) {
          reject(new Error('Audio load timeout'))
        }
      }, 5000)
    })
  }
  
  // 初始化
  async function init() {
    if (initialized.value) return
    
    loadFromLocal()
    
    if (authStore.user) {
      await loadFromCloud()
    }
    
    // 预加载动物音效
    try {
      await preloadAudio(settings.value.animal.success.soundFile)
      await preloadAudio(settings.value.animal.failure.soundFile)
    } catch (e) {
      console.warn('Failed to preload audio:', e)
    }
    
    initialized.value = true
  }
  
  // 从本地加载
  function loadFromLocal() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        settings.value = { ...defaultSettings, ...parsed }
      }
    } catch (e) {
      console.error('Error loading announcer settings:', e)
    }
  }
  
  // 保存到本地
  function saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.error('Error saving announcer settings:', e)
    }
  }
  
  // 从云端加载
  async function loadFromCloud() {
    if (!authStore.user) return
    
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('announcer_settings')
        .eq('user_id', authStore.user.id)
        .single()
      
      if (!error && data?.announcer_settings) {
        settings.value = { ...defaultSettings, ...data.announcer_settings }
        saveToLocal()
      }
    } catch (e) {
      console.error('Error loading announcer settings from cloud:', e)
    }
  }
  
  // 保存到云端
  async function saveToCloud() {
    if (!authStore.user) return
    
    try {
      await supabase
        .from('user_settings')
        .upsert({
          user_id: authStore.user.id,
          announcer_settings: settings.value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })
    } catch (e) {
      console.error('Error saving announcer settings to cloud:', e)
    }
  }
  
  // 保存设置
  async function saveSettings() {
    saveToLocal()
    if (authStore.user) {
      await saveToCloud()
    }
  }
  
  // 更新设置
  function updateSettings(newSettings) {
    settings.value = { ...settings.value, ...newSettings }
    saveSettings()
  }
  
  // 播放成功反馈
  async function playSuccess() {
    if (settings.value.type === 'human') {
      // 人物模式：朗读成功语句
      await speechStore.speakEnglish(settings.value.human.correctPhrase, { rate: 1.0 })
      return 'human'
    } else {
      // 动物模式：播放音效
      const soundUrl = settings.value.animal.success.soundFile
      await playSound(soundUrl)
      return settings.value.animal.success.type // 'cat'
    }
  }
  
  // 播放失败反馈
  async function playFailure() {
    if (settings.value.type === 'human') {
      // 人物模式：朗读失败语句
      await speechStore.speakEnglish(settings.value.human.incorrectPhrase, { rate: 1.0 })
      return 'human'
    } else {
      // 动物模式：播放音效
      const soundUrl = settings.value.animal.failure.soundFile
      await playSound(soundUrl)
      return settings.value.animal.failure.type // 'dog'
    }
  }
  
  // 播放音效
  async function playSound(url) {
    return new Promise((resolve, reject) => {
      let audio = audioCache.value[url]
      
      if (!audio) {
        audio = new Audio(url)
      } else {
        // 重置播放位置
        audio.currentTime = 0
      }
      
      audio.onended = () => resolve()
      audio.onerror = (e) => reject(e)
      
      audio.play().catch(reject)
    })
  }
  
  // 重置为默认设置
  function resetToDefaults() {
    settings.value = { ...defaultSettings }
    saveSettings()
  }
  
  // 上传自定义音效（返回 base64 URL）
  function uploadCustomSound(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        resolve(e.target.result)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
  
  return {
    settings,
    initialized,
    init,
    saveSettings,
    updateSettings,
    playSuccess,
    playFailure,
    playSound,
    resetToDefaults,
    uploadCustomSound,
    preloadAudio
  }
})
