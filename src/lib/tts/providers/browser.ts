/**
 * 浏览器语音合成供应商
 * 使用 Web Speech API (speechSynthesis)
 */

import type { 
  TTSProvider, 
  TTSRequest, 
  TTSResponse, 
  TTSVoice, 
  TTSLanguage,
  BrowserTTSConfig
} from '../types'

// 按平台优选的英文语音列表
const PLATFORM_ENGLISH_VOICES: Record<string, string[]> = {
  // macOS - 系统自带高质量语音
  macos: [
    'Samantha', 'Alex', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Fiona',
    'Google US English', 'Google UK English Female'
  ],
  // iOS - Safari 使用系统语音
  ios: [
    'Samantha', 'Daniel', 'Karen', 'Moira', 'Tessa',
    'en-US', 'en-GB'
  ],
  // Windows - Microsoft 语音
  windows: [
    'Microsoft Zira', 'Microsoft David', 'Microsoft Mark', 'Microsoft Aria',
    'Google US English', 'Google UK English Female', 'Google UK English Male'
  ],
  // Android - Google 语音
  android: [
    'Google US English', 'Google UK English Female', 'Google UK English Male',
    'English United States', 'en-US', 'en_US'
  ],
  // Linux - 通用
  linux: [
    'Google US English', 'English United States', 'English'
  ],
  // 通用回退
  default: [
    'Samantha', 'Alex', 'Daniel', 'Karen',
    'Microsoft Zira', 'Microsoft David',
    'Google US English', 'Google UK English Female',
    'English United States', 'English', 'en-US'
  ]
}

// 按平台优选的中文语音列表
const PLATFORM_CHINESE_VOICES: Record<string, string[]> = {
  // macOS - 系统自带高质量语音
  macos: [
    'Tingting', 'Sinji', 'Meijia', 'Lili',
    'Google 普通话', 'Google 中文'
  ],
  // iOS - Safari 使用系统语音
  ios: [
    'Tingting', 'Sinji', 'Meijia', 'Lili',
    'zh-CN', 'zh-TW'
  ],
  // Windows - Microsoft 语音
  windows: [
    'Microsoft Xiaoxiao', 'Microsoft Yunxi', 'Microsoft Huihui', 'Microsoft Kangkang',
    'Microsoft Yaoyao', 'Microsoft Xiaoyu',
    'Google 普通话', 'Google 中文'
  ],
  // Android - Google 语音
  android: [
    'Google 普通话', 'Google 中文',
    'Chinese', 'zh-CN', 'zh_CN', 'cmn-Hans-CN'
  ],
  // Linux - 通用
  linux: [
    'Google 普通话', 'Google 中文', 'Chinese', '中文'
  ],
  // 通用回退
  default: [
    'Tingting', 'Sinji', 'Meijia', 'Lili',
    'Microsoft Xiaoxiao', 'Microsoft Yunxi', 'Microsoft Huihui',
    'Google 普通话', 'Google 中文',
    'Chinese', '中文', 'zh-CN'
  ]
}

// 检测当前平台
function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'default'
  
  const ua = navigator.userAgent
  
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'ios'
  } else if (/Android/i.test(ua)) {
    return 'android'
  } else if (/Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) {
    return 'macos'
  } else if (/Windows/i.test(ua)) {
    return 'windows'
  } else if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    return 'linux'
  }
  
  return 'default'
}

export class BrowserTTSProvider implements TTSProvider {
  readonly type = 'browser' as const
  readonly name = '浏览器语音'
  readonly supportedLanguages: TTSLanguage[] = ['en', 'zh']

  private voices: SpeechSynthesisVoice[] = []
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private config: {
    en: BrowserTTSConfig
    zh: BrowserTTSConfig
  }

  constructor() {
    this.config = {
      en: { voiceName: null, rate: 0.85, pitch: 1.0, volume: 1.0 },
      zh: { voiceName: null, rate: 1.0, pitch: 1.0, volume: 1.0 }
    }
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    await this.loadVoices()
  }

  /**
   * 加载可用语音
   */
  private loadVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      const voices = speechSynthesis.getVoices()
      if (voices.length > 0) {
        this.voices = voices
        resolve(voices)
      } else {
        speechSynthesis.onvoiceschanged = () => {
          this.voices = speechSynthesis.getVoices()
          resolve(this.voices)
        }
        // 超时处理
        setTimeout(() => {
          if (this.voices.length === 0) {
            this.voices = speechSynthesis.getVoices()
          }
          resolve(this.voices)
        }, 1000)
      }
    })
  }

  /**
   * 检查是否可用
   */
  isAvailable(): boolean {
    return typeof speechSynthesis !== 'undefined'
  }

  /**
   * 获取可用语音列表
   */
  async getVoices(language?: TTSLanguage): Promise<TTSVoice[]> {
    if (this.voices.length === 0) {
      await this.loadVoices()
    }

    let filteredVoices = this.voices

    if (language) {
      const langPrefix = language === 'en' ? 'en' : 'zh'
      filteredVoices = this.voices.filter(v => v.lang.startsWith(langPrefix))
    }

    return filteredVoices.map(v => ({
      id: v.name,
      name: v.name,
      language: v.lang.startsWith('zh') ? 'zh' : 'en',
      provider: 'browser',
      providerName: '浏览器',
      description: `${v.lang}${v.localService ? ' (本地)' : ' (网络)'}`
    }))
  }

  /**
   * 获取最优语音
   * 根据当前平台选择最合适的默认语音
   */
  getBestVoice(language: TTSLanguage): string | null {
    const langPrefix = language === 'en' ? 'en' : 'zh'
    const langVoices = this.voices.filter(v => v.lang.startsWith(langPrefix))
    
    // 如果没有可用语音，返回 null
    if (langVoices.length === 0) return null

    // 检测当前平台
    const platform = detectPlatform()
    
    // 获取当前平台的优选语音列表，如果没有则使用默认列表
    const platformVoices = language === 'en' 
      ? PLATFORM_ENGLISH_VOICES 
      : PLATFORM_CHINESE_VOICES
    
    const preferredList = platformVoices[platform] || platformVoices['default']

    // 尝试按优先级匹配语音
    for (const preferred of preferredList) {
      const voice = langVoices.find(v => 
        v.name.toLowerCase().includes(preferred.toLowerCase()) ||
        v.lang.toLowerCase().includes(preferred.toLowerCase())
      )
      if (voice) return voice.name
    }

    // 如果优选列表都没匹配到，回退到默认列表
    if (platform !== 'default') {
      const defaultList = platformVoices['default']
      for (const preferred of defaultList) {
        const voice = langVoices.find(v => 
          v.name.toLowerCase().includes(preferred.toLowerCase()) ||
          v.lang.toLowerCase().includes(preferred.toLowerCase())
        )
        if (voice) return voice.name
      }
    }

    // 最终回退：返回第一个可用语音
    return langVoices[0].name
  }

  /**
   * 设置语音配置
   */
  setConfig(language: TTSLanguage, config: Partial<BrowserTTSConfig>): void {
    const langKey = language === 'en' ? 'en' : 'zh'
    Object.assign(this.config[langKey], config)
  }

  /**
   * 获取语音配置
   */
  getConfig(language: TTSLanguage): BrowserTTSConfig {
    return this.config[language === 'en' ? 'en' : 'zh']
  }

  /**
   * 合成语音（返回音频数据）
   * 注意：浏览器 TTS 不支持直接获取音频数据，返回空
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    // 浏览器 TTS 不支持获取音频数据
    // 只能通过 speak 方法直接播放
    return {
      mimeType: 'audio/wav',
      cached: false
    }
  }

  /**
   * 直接播放语音
   */
  speak(request: TTSRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stop()

      // iOS Safari 需要特殊处理
      const platform = detectPlatform()
      const isIOS = platform === 'ios'

      // 确保语音列表已加载
      if (this.voices.length === 0) {
        this.voices = speechSynthesis.getVoices()
      }

      const utterance = new SpeechSynthesisUtterance(request.text)
      this.currentUtterance = utterance

      // 设置语言
      utterance.lang = request.language === 'en' ? 'en-US' : 'zh-CN'

      // 获取配置
      const config = this.config[request.language === 'en' ? 'en' : 'zh']

      // 应用配置
      utterance.rate = request.config?.rate ?? config.rate
      utterance.pitch = request.config?.pitch ?? config.pitch
      utterance.volume = request.config?.volume ?? config.volume

      // 设置语音
      if (config.voiceName) {
        const voice = this.voices.find(v => v.name === config.voiceName)
        if (voice) utterance.voice = voice
      }

      // iOS Safari 有时 onend 不触发，需要添加超时处理
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let resolved = false

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        this.currentUtterance = null
      }

      utterance.onend = () => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve()
      }

      utterance.onerror = (e) => {
        if (resolved) return
        resolved = true
        cleanup()
        // 忽略取消错误
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve()
        } else {
          reject(new Error(`Speech synthesis error: ${e.error}`))
        }
      }

      // iOS 特殊处理：添加 onstart 确认播放已开始
      utterance.onstart = () => {
        // 播放开始后设置超时（基于文本长度估算）
        const estimatedDuration = Math.max(3000, request.text.length * 150)
        if (isIOS) {
          timeoutId = setTimeout(() => {
            if (!resolved) {
              resolved = true
              cleanup()
              // iOS 上超时后静默完成，不报错
              resolve()
            }
          }, estimatedDuration)
        }
      }

      // iOS Safari 有时需要先 cancel 再 speak
      if (isIOS) {
        speechSynthesis.cancel()
        // 短暂延迟后再播放
        setTimeout(() => {
          speechSynthesis.speak(utterance)
        }, 50)
      } else {
        speechSynthesis.speak(utterance)
      }

      // 全局超时保护（防止永久卡住）
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          speechSynthesis.cancel()
          resolve()  // 超时后静默完成
        }
      }, 30000)  // 30秒最大超时
    })
  }

  /**
   * 停止播放
   */
  stop(): void {
    speechSynthesis.cancel()
    this.currentUtterance = null
  }

  /**
   * 获取原始浏览器语音列表
   */
  getRawVoices(): SpeechSynthesisVoice[] {
    return this.voices
  }

  /**
   * 获取英文语音列表
   */
  getEnglishVoices(): SpeechSynthesisVoice[] {
    return this.voices.filter(v => v.lang.startsWith('en'))
  }

  /**
   * 获取中文语音列表
   */
  getChineseVoices(): SpeechSynthesisVoice[] {
    return this.voices.filter(v => v.lang.startsWith('zh'))
  }
}

// 导出单例
export const browserTTS = new BrowserTTSProvider()
