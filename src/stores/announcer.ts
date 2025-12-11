import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useAuthStore } from './auth'
import { useSpeechStore } from './speech'
import { supabase } from '@/lib/supabase'
import type { AnnouncerSettings } from '@/types'

const STORAGE_KEY = 'spellingbee_announcer_settings'

// 获取基础路径（支持子路径部署）
const BASE_URL = import.meta.env.BASE_URL || '/'

// 获取完整的音频文件路径
function getSoundPath(filename: string): string {
  return `${BASE_URL}sounds/${filename}`
}

export const useAnnouncerStore = defineStore('announcer', () => {
  const authStore = useAuthStore()
  const speechStore = useSpeechStore()
  
  // 默认设置（使用相对文件名，运行时拼接完整路径）
  const defaultSettings: AnnouncerSettings = {
    type: 'animal', // 'human' | 'animal' - 默认动物播音员
    human: {
      correctPhrase: 'Correct!',
      incorrectPhrase: 'Incorrect.',
      newChallengePhrase: '新挑战！'
    },
    animal: {
      success: {
        type: 'cat',
        soundFile: 'meow.wav' // 只存文件名
      },
      failure: {
        type: 'dog',
        soundFile: 'bark.wav' // 只存文件名
      },
      newChallenge: {
        type: 'dog',
        soundFile: 'bark.wav' // 默认使用小狗音效
      }
    }
  }
  
  // 当前设置
  const settings = ref<AnnouncerSettings>({ ...defaultSettings })
  const initialized = ref(false)
  
  // 音频缓存
  const audioCache = ref<Record<string, HTMLAudioElement>>({})
  
  // 预加载音频
  async function preloadAudio(url: string): Promise<HTMLAudioElement> {
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
  async function init(): Promise<void> {
    if (initialized.value) return
    
    loadFromLocal()
    
    // 预加载动物音效
    try {
      await preloadAudio(getFullSoundUrl(settings.value.animal.success.soundFile))
      await preloadAudio(getFullSoundUrl(settings.value.animal.failure.soundFile))
    } catch (e) {
      console.warn('Failed to preload audio:', e)
    }
    
    initialized.value = true
  }
  
  // 获取完整的音频 URL
  function getFullSoundUrl(soundFile: string): string {
    // 如果是 data URL 或完整 URL，直接返回
    if (soundFile.startsWith('data:') || soundFile.startsWith('http')) {
      return soundFile
    }
    // 如果是旧格式的绝对路径，提取文件名
    if (soundFile.startsWith('/sounds/')) {
      soundFile = soundFile.replace('/sounds/', '')
    }
    // 拼接完整路径
    return getSoundPath(soundFile)
  }
  
  // 从本地加载
  function loadFromLocal(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AnnouncerSettings>
        settings.value = { ...defaultSettings, ...parsed }
      }
    } catch (e) {
      console.error('Error loading announcer settings:', e)
    }
  }
  
  // 保存到本地
  function saveToLocal(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.error('Error saving announcer settings:', e)
    }
  }
  
  // 保存设置（仅本地存储，不同步云端）
  async function saveSettings(): Promise<void> {
    saveToLocal()
  }
  
  // 更新设置
  function updateSettings(newSettings: Partial<AnnouncerSettings>): void {
    settings.value = { ...settings.value, ...newSettings }
    saveSettings()
  }
  
  // 播放成功反馈
  async function playSuccess(): Promise<string> {
    if (settings.value.type === 'human') {
      // 人物模式：朗读成功语句
      await speechStore.speakEnglish(settings.value.human.correctPhrase, { rate: 1.0 })
      return 'human'
    } else {
      // 动物模式：播放音效
      const soundUrl = getFullSoundUrl(settings.value.animal.success.soundFile)
      await playSound(soundUrl)
      return settings.value.animal.success.type // 'cat'
    }
  }
  
  // 播放失败反馈
  async function playFailure(): Promise<string> {
    if (settings.value.type === 'human') {
      // 人物模式：朗读失败语句
      await speechStore.speakEnglish(settings.value.human.incorrectPhrase, { rate: 1.0 })
      return 'human'
    } else {
      // 动物模式：播放音效
      const soundUrl = getFullSoundUrl(settings.value.animal.failure.soundFile)
      await playSound(soundUrl)
      return settings.value.animal.failure.type // 'dog'
    }
  }
  
  // 播放新挑战通知
  async function playNewChallenge(): Promise<string> {
    if (settings.value.type === 'human') {
      // 人物模式：朗读新挑战语句
      const phrase = settings.value.human.newChallengePhrase || '新挑战！'
      await speechStore.speakChinese(phrase, { rate: 1.0 })
      return 'human'
    } else {
      // 动物模式：播放音效（默认使用小狗）
      const newChallengeConfig = settings.value.animal.newChallenge || { type: 'dog', soundFile: 'bark.wav' }
      const soundUrl = getFullSoundUrl(newChallengeConfig.soundFile)
      await playSound(soundUrl)
      return newChallengeConfig.type
    }
  }
  
  // 播放音效（音量比正常语音小20%）
  async function playSound(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let audio = audioCache.value[url]
      
      if (!audio) {
        audio = new Audio(url)
      } else {
        // 重置播放位置
        audio.currentTime = 0
      }
      
      // 设置音量为80%（比正常语音小20%）
      audio.volume = 0.8
      
      audio.onended = () => resolve()
      audio.onerror = (e) => reject(e)
      
      audio.play().catch(reject)
    })
  }
  
  // 重置为默认设置
  function resetToDefaults(): void {
    settings.value = { ...defaultSettings }
    saveSettings()
  }
  
  // 上传自定义音效（返回 base64 URL）
  function uploadCustomSound(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        resolve(e.target?.result as string)
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
    playNewChallenge,
    playSound,
    resetToDefaults,
    uploadCustomSound,
    preloadAudio
  }
})
