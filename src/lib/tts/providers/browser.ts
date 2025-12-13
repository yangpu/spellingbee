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

// 优选英文语音列表（教育场景优先）
const PREFERRED_ENGLISH_VOICES = [
  'Samantha', 'Alex', 'Daniel', 'Karen', 'Moira', 'Tessa',
  'Microsoft Zira', 'Microsoft David', 'Microsoft Mark',
  'Google US English', 'Google UK English Female', 'Google UK English Male',
  'English United States', 'English'
]

// 优选中文语音列表
const PREFERRED_CHINESE_VOICES = [
  'Tingting', 'Sinji', 'Meijia', 'Lili',
  'Microsoft Xiaoxiao', 'Microsoft Yunxi', 'Microsoft Huihui', 'Microsoft Kangkang',
  'Google 普通话', 'Google 中文',
  'Chinese', '中文'
]

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
   */
  getBestVoice(language: TTSLanguage): string | null {
    const langPrefix = language === 'en' ? 'en' : 'zh'
    const langVoices = this.voices.filter(v => v.lang.startsWith(langPrefix))
    
    if (langVoices.length === 0) return null

    const preferredList = language === 'en' ? PREFERRED_ENGLISH_VOICES : PREFERRED_CHINESE_VOICES

    for (const preferred of preferredList) {
      const voice = langVoices.find(v => 
        v.name.toLowerCase().includes(preferred.toLowerCase())
      )
      if (voice) return voice.name
    }

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

      utterance.onend = () => {
        this.currentUtterance = null
        resolve()
      }

      utterance.onerror = (e) => {
        this.currentUtterance = null
        // 忽略取消错误
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve()
        } else {
          reject(new Error(`Speech synthesis error: ${e.error}`))
        }
      }

      speechSynthesis.speak(utterance)
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
