/**
 * TTS 管理器
 * 统一语音朗读接口，封装为可扩展的库
 */

import type { 
  TTSProviderType, 
  TTSLanguage, 
  TTSSettings,
  TTSRequest,
  TTSResponse,
  TTSVoice,
  TTSVoiceConfig,
  BrowserTTSConfig,
  OnlineTTSConfig,
  AITTSConfig
} from './types'
import { getDefaultTTSSettings } from './types'
import { ttsCache } from './cache'
import { browserTTS, onlineTTS, aiTTS } from './providers'

// 检测平台
function detectPlatform(): { os: string; browser: string } {
  const ua = navigator.userAgent
  
  let os = 'unknown'
  if (/iPhone|iPad|iPod/i.test(ua)) {
    os = 'ios'
  } else if (/Android/i.test(ua)) {
    os = 'android'
  } else if (/Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) {
    os = 'macos'
  } else if (/Windows/i.test(ua)) {
    os = 'windows'
  } else if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    os = 'linux'
  }
  
  let browser = 'unknown'
  if (/Edg/i.test(ua)) {
    browser = 'edge'
  } else if (/Firefox/i.test(ua)) {
    browser = 'firefox'
  } else if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) {
    browser = 'chrome'
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua) && !/Edg/i.test(ua)) {
    browser = 'safari'
  }
  
  return { os, browser }
}

/**
 * TTS 管理器类
 */
class TTSManager {
  private settings: TTSSettings
  private initialized = false

  constructor() {
    this.settings = getDefaultTTSSettings()
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.initialized) return

    // 检测平台
    this.settings.platform = detectPlatform()

    // 初始化各供应商
    await Promise.all([
      browserTTS.init(),
      onlineTTS.init(),
      aiTTS.init(),
      ttsCache.init()
    ])

    // 设置浏览器默认语音
    const bestEnglishVoice = browserTTS.getBestVoice('en')
    const bestChineseVoice = browserTTS.getBestVoice('zh')

    if (bestEnglishVoice && !this.settings.english.browser.voiceName) {
      this.settings.english.browser.voiceName = bestEnglishVoice
    }
    if (bestChineseVoice && !this.settings.chinese.browser.voiceName) {
      this.settings.chinese.browser.voiceName = bestChineseVoice
    }

    this.initialized = true
  }

  /**
   * 获取当前设置
   */
  getSettings(): TTSSettings {
    return this.settings
  }

  /**
   * 更新设置
   */
  updateSettings(newSettings: Partial<TTSSettings>): void {
    Object.assign(this.settings, newSettings)
    this.syncProvidersConfig()
  }

  /**
   * 同步配置到各供应商
   */
  private syncProvidersConfig(): void {
    // 同步浏览器语音配置
    browserTTS.setConfig('en', this.settings.english.browser)
    browserTTS.setConfig('zh', this.settings.chinese.browser)

    // 同步在线语音配置
    onlineTTS.setConfig('en', this.settings.english.online)
    onlineTTS.setConfig('zh', this.settings.chinese.online)

    // 同步 AI 语音配置
    aiTTS.setConfig('en', this.settings.english.ai)
    aiTTS.setConfig('zh', this.settings.chinese.ai)
  }

  /**
   * 设置激活的语音源
   */
  setActiveProvider(provider: TTSProviderType): void {
    this.settings.activeProvider = provider
  }

  /**
   * 设置语言的语音源
   */
  setLanguageProvider(language: TTSLanguage, provider: TTSProviderType): void {
    if (language === 'en') {
      this.settings.english.provider = provider
    } else {
      this.settings.chinese.provider = provider
    }
  }

  /**
   * 获取当前语音源
   */
  getActiveProvider(language?: TTSLanguage): TTSProviderType {
    if (language) {
      return language === 'en' 
        ? this.settings.english.provider 
        : this.settings.chinese.provider
    }
    return this.settings.activeProvider
  }

  /**
   * 获取可用语音列表
   */
  async getVoices(language?: TTSLanguage, provider?: TTSProviderType): Promise<TTSVoice[]> {
    const targetProvider = provider || this.settings.activeProvider

    switch (targetProvider) {
      case 'browser':
        return browserTTS.getVoices(language)
      case 'online':
        return onlineTTS.getVoices(language)
      case 'ai':
        return aiTTS.getVoices(language)
      default:
        return []
    }
  }

  /**
   * 朗读文本
   */
  async speak(text: string, language: TTSLanguage, options?: Partial<TTSVoiceConfig>): Promise<void> {
    const provider = language === 'en' 
      ? this.settings.english.provider 
      : this.settings.chinese.provider

    const request: TTSRequest = {
      text,
      language,
      config: options
    }

    switch (provider) {
      case 'browser':
        await browserTTS.speak(request)
        break
      case 'online':
        await onlineTTS.speak(request)
        break
      case 'ai':
        await aiTTS.speak(request)
        break
    }
  }

  /**
   * 朗读英文
   */
  async speakEnglish(text: string, options?: Partial<TTSVoiceConfig>): Promise<void> {
    return this.speak(text, 'en', options)
  }

  /**
   * 朗读中文
   */
  async speakChinese(text: string, options?: Partial<TTSVoiceConfig>): Promise<void> {
    return this.speak(text, 'zh', options)
  }

  /**
   * 朗读单词（使用稍慢语速）
   */
  async speakWord(word: string, options?: Partial<TTSVoiceConfig>): Promise<void> {
    const config = this.settings.english
    const currentRate = options?.rate ?? config.browser.rate
    const wordRate = Math.max(0.6, currentRate - 0.15)
    return this.speakEnglish(word, { ...options, rate: wordRate })
  }

  /**
   * 朗读字母（用于拼读）
   */
  async speakLetter(letter: string, options?: Partial<TTSVoiceConfig>): Promise<void> {
    const spelling = this.settings.spelling
    return this.speakEnglish(letter, {
      rate: options?.rate ?? spelling.rate,
      pitch: options?.pitch ?? spelling.pitch,
      ...options
    })
  }

  /**
   * 获取字母拼读间隔
   */
  getSpellingInterval(): number {
    return this.settings.spelling.interval
  }

  /**
   * 停止播放
   */
  stop(): void {
    browserTTS.stop()
    onlineTTS.stop()
    aiTTS.stop()
  }

  /**
   * 合成语音（返回音频数据）
   */
  async synthesize(text: string, language: TTSLanguage): Promise<TTSResponse> {
    const provider = language === 'en' 
      ? this.settings.english.provider 
      : this.settings.chinese.provider

    const request: TTSRequest = { text, language }

    switch (provider) {
      case 'browser':
        return browserTTS.synthesize(request)
      case 'online':
        return onlineTTS.synthesize(request)
      case 'ai':
        return aiTTS.synthesize(request)
      default:
        throw new Error(`Unknown provider: ${provider}`)
    }
  }

  /**
   * 试听英文语音
   */
  async previewEnglish(provider?: TTSProviderType): Promise<void> {
    const testText = 'Hello, this is a test of the English voice.'
    const targetProvider = provider || this.settings.english.provider

    const request: TTSRequest = { text: testText, language: 'en' }

    switch (targetProvider) {
      case 'browser':
        await browserTTS.speak(request)
        break
      case 'online':
        await onlineTTS.speak(request)
        break
      case 'ai':
        await aiTTS.speak(request)
        break
    }
  }

  /**
   * 试听中文语音
   */
  async previewChinese(provider?: TTSProviderType): Promise<void> {
    const testText = '你好，这是中文语音测试。'
    const targetProvider = provider || this.settings.chinese.provider

    const request: TTSRequest = { text: testText, language: 'zh' }

    switch (targetProvider) {
      case 'browser':
        await browserTTS.speak(request)
        break
      case 'online':
        await onlineTTS.speak(request)
        break
      case 'ai':
        await aiTTS.speak(request)
        break
    }
  }

  /**
   * 试听单词
   */
  async previewWord(word: string = 'beautiful'): Promise<void> {
    await this.speakWord(word)
  }

  /**
   * 试听字母拼读
   */
  async previewSpelling(word: string = 'APPLE'): Promise<void> {
    const letters = word.toUpperCase().split('')
    for (let i = 0; i < letters.length; i++) {
      await this.speakLetter(letters[i])
      if (i < letters.length - 1) {
        await new Promise(resolve => setTimeout(resolve, this.settings.spelling.interval))
      }
    }
  }

  /**
   * 更新浏览器语音配置
   */
  updateBrowserConfig(language: TTSLanguage, config: Partial<BrowserTTSConfig>): void {
    if (language === 'en') {
      Object.assign(this.settings.english.browser, config)
    } else {
      Object.assign(this.settings.chinese.browser, config)
    }
    browserTTS.setConfig(language, this.settings[language === 'en' ? 'english' : 'chinese'].browser)
  }

  /**
   * 更新在线语音配置
   */
  updateOnlineConfig(language: TTSLanguage, config: Partial<OnlineTTSConfig>): void {
    if (language === 'en') {
      Object.assign(this.settings.english.online, config)
    } else {
      Object.assign(this.settings.chinese.online, config)
    }
    onlineTTS.setConfig(language, this.settings[language === 'en' ? 'english' : 'chinese'].online)
  }

  /**
   * 更新 AI 语音配置
   */
  updateAIConfig(language: TTSLanguage, config: Partial<AITTSConfig>): void {
    if (language === 'en') {
      Object.assign(this.settings.english.ai, config)
    } else {
      Object.assign(this.settings.chinese.ai, config)
    }
    aiTTS.setConfig(language, this.settings[language === 'en' ? 'english' : 'chinese'].ai)
  }

  /**
   * 更新字母拼读配置
   */
  updateSpellingConfig(config: Partial<{ rate: number; pitch: number; interval: number }>): void {
    Object.assign(this.settings.spelling, config)
  }

  /**
   * 获取缓存统计
   */
  async getCacheStats() {
    return ttsCache.getStats()
  }

  /**
   * 清理缓存
   */
  async clearCache(): Promise<void> {
    await ttsCache.clear()
  }

  /**
   * 清理过期缓存
   */
  async cleanupExpiredCache(): Promise<number> {
    return ttsCache.cleanupExpired()
  }

  /**
   * 获取浏览器语音列表（原始）
   */
  getBrowserVoices() {
    return {
      all: browserTTS.getRawVoices(),
      english: browserTTS.getEnglishVoices(),
      chinese: browserTTS.getChineseVoices()
    }
  }

  /**
   * 获取在线语音供应商列表
   */
  getOnlineProviders() {
    return onlineTTS.getProviders()
  }

  /**
   * 获取 AI 语音供应商列表
   */
  getAIProviders() {
    return aiTTS.getProviders()
  }

  /**
   * 检查供应商是否可用
   */
  isProviderAvailable(provider: TTSProviderType): boolean {
    switch (provider) {
      case 'browser':
        return browserTTS.isAvailable()
      case 'online':
        return onlineTTS.isAvailable()
      case 'ai':
        return aiTTS.isAvailable()
      default:
        return false
    }
  }

  /**
   * 重置为默认设置
   */
  resetToDefaults(): void {
    this.settings = getDefaultTTSSettings()
    this.settings.platform = detectPlatform()

    // 重新设置浏览器默认语音
    const bestEnglishVoice = browserTTS.getBestVoice('en')
    const bestChineseVoice = browserTTS.getBestVoice('zh')

    if (bestEnglishVoice) {
      this.settings.english.browser.voiceName = bestEnglishVoice
    }
    if (bestChineseVoice) {
      this.settings.chinese.browser.voiceName = bestChineseVoice
    }

    this.syncProvidersConfig()
  }
}

// 导出单例
export const ttsManager = new TTSManager()

// 导出类型和工具
export * from './types'
export { ttsCache } from './cache'
export { browserTTS, onlineTTS, aiTTS, ONLINE_PROVIDERS, AI_PROVIDERS } from './providers'
