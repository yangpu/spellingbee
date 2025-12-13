/**
 * 在线语音合成供应商
 * 通过 API 调用云端语音服务
 */

import type { 
  TTSProvider, 
  TTSRequest, 
  TTSResponse, 
  TTSVoice, 
  TTSLanguage,
  OnlineTTSConfig,
  OnlineTTSProvider as OnlineProviderType,
  OnlineProviderInfo
} from '../types'
import { ttsCache } from '../cache'

// 在线语音供应商配置
export const ONLINE_PROVIDERS: OnlineProviderInfo[] = [
  {
    id: 'youdao',
    name: '有道翻译',
    description: '有道翻译语音朗读，免费使用，适合英语学习',
    website: 'https://fanyi.youdao.com',
    requiresApiKey: false,
    free: true,
    supportedLanguages: ['en', 'zh'],
    voices: [
      { id: 'en-US-1', name: '美式英语', language: 'en', gender: 'female', provider: 'online', providerName: '有道翻译' },
      { id: 'en-GB-1', name: '英式英语', language: 'en', gender: 'female', provider: 'online', providerName: '有道翻译' },
      { id: 'zh-CN-1', name: '中文普通话', language: 'zh', gender: 'female', provider: 'online', providerName: '有道翻译' },
    ]
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    description: '微软 Azure 认知服务语音合成，音质优秀',
    website: 'https://azure.microsoft.com/services/cognitive-services/text-to-speech/',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    voices: [
      { id: 'en-US-JennyNeural', name: 'Jenny (美式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Azure' },
      { id: 'en-US-GuyNeural', name: 'Guy (美式男声)', language: 'en', gender: 'male', provider: 'online', providerName: 'Azure' },
      { id: 'en-GB-SoniaNeural', name: 'Sonia (英式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Azure' },
      { id: 'en-GB-RyanNeural', name: 'Ryan (英式男声)', language: 'en', gender: 'male', provider: 'online', providerName: 'Azure' },
      { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: 'Azure' },
      { id: 'zh-CN-YunxiNeural', name: '云希 (男声)', language: 'zh', gender: 'male', provider: 'online', providerName: 'Azure' },
      { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: 'Azure' },
    ]
  },
  {
    id: 'google',
    name: 'Google Cloud',
    description: 'Google Cloud Text-to-Speech，支持多种语言',
    website: 'https://cloud.google.com/text-to-speech',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    voices: [
      { id: 'en-US-Neural2-F', name: 'Neural2-F (美式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Google' },
      { id: 'en-US-Neural2-D', name: 'Neural2-D (美式男声)', language: 'en', gender: 'male', provider: 'online', providerName: 'Google' },
      { id: 'en-GB-Neural2-A', name: 'Neural2-A (英式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Google' },
      { id: 'cmn-CN-Wavenet-A', name: 'Wavenet-A (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: 'Google' },
      { id: 'cmn-CN-Wavenet-B', name: 'Wavenet-B (男声)', language: 'zh', gender: 'male', provider: 'online', providerName: 'Google' },
    ]
  },
  {
    id: 'tencent',
    name: '腾讯云',
    description: '腾讯云语音合成，国内访问快速',
    website: 'https://cloud.tencent.com/product/tts',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    voices: [
      { id: '101001', name: '智瑜 (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: '腾讯云' },
      { id: '101002', name: '智聆 (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: '腾讯云' },
      { id: '101003', name: '智美 (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: '腾讯云' },
      { id: '101004', name: '智云 (男声)', language: 'zh', gender: 'male', provider: 'online', providerName: '腾讯云' },
      { id: '101050', name: 'WeJack (男声)', language: 'en', gender: 'male', provider: 'online', providerName: '腾讯云' },
      { id: '101051', name: 'WeRose (女声)', language: 'en', gender: 'female', provider: 'online', providerName: '腾讯云' },
    ]
  },
  {
    id: 'aliyun',
    name: '阿里云',
    description: '阿里云智能语音服务',
    website: 'https://ai.aliyun.com/nls/tts',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    voices: [
      { id: 'xiaoyun', name: '小云 (标准女声)', language: 'zh', gender: 'female', provider: 'online', providerName: '阿里云' },
      { id: 'xiaogang', name: '小刚 (标准男声)', language: 'zh', gender: 'male', provider: 'online', providerName: '阿里云' },
      { id: 'ruoxi', name: '若兮 (温柔女声)', language: 'zh', gender: 'female', provider: 'online', providerName: '阿里云' },
      { id: 'harry', name: 'Harry (英式男声)', language: 'en', gender: 'male', provider: 'online', providerName: '阿里云' },
      { id: 'abby', name: 'Abby (美式女声)', language: 'en', gender: 'female', provider: 'online', providerName: '阿里云' },
    ]
  }
]

export class OnlineTTSProvider implements TTSProvider {
  readonly type = 'online' as const
  readonly name = '在线语音'
  readonly supportedLanguages: TTSLanguage[] = ['en', 'zh']

  private config: {
    en: OnlineTTSConfig
    zh: OnlineTTSConfig
  }
  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null

  constructor() {
    this.config = {
      en: {
        provider: 'azure',
        voiceId: 'en-US-JennyNeural',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0
      },
      zh: {
        provider: 'azure',
        voiceId: 'zh-CN-XiaoxiaoNeural',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0
      }
    }
  }

  async init(): Promise<void> {
    await ttsCache.init()
  }

  isAvailable(): boolean {
    // 检查是否配置了 API 密钥
    const enConfig = this.config.en
    const zhConfig = this.config.zh
    return !!(enConfig.apiKey || zhConfig.apiKey)
  }

  async getVoices(language?: TTSLanguage): Promise<TTSVoice[]> {
    const allVoices: TTSVoice[] = []

    for (const provider of ONLINE_PROVIDERS) {
      if (!language || provider.supportedLanguages.includes(language)) {
        const filteredVoices = language 
          ? provider.voices.filter(v => v.language === language)
          : provider.voices
        allVoices.push(...filteredVoices)
      }
    }

    return allVoices
  }

  /**
   * 设置语音配置
   */
  setConfig(language: TTSLanguage, config: Partial<OnlineTTSConfig>): void {
    const langKey = language === 'en' ? 'en' : 'zh'
    Object.assign(this.config[langKey], config)
  }

  /**
   * 获取语音配置
   */
  getConfig(language: TTSLanguage): OnlineTTSConfig {
    return this.config[language === 'en' ? 'en' : 'zh']
  }

  /**
   * 获取供应商列表
   */
  getProviders(): OnlineProviderInfo[] {
    return ONLINE_PROVIDERS
  }

  /**
   * 合成语音
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = this.config[request.language === 'en' ? 'en' : 'zh']

    // 先检查缓存
    const cached = await ttsCache.get(
      request.text,
      request.language,
      'online',
      config.voiceId
    )

    if (cached) {
      return {
        audioData: cached.audioData,
        mimeType: cached.mimeType,
        duration: cached.duration,
        cached: true
      }
    }

    // 调用对应供应商的 API
    const response = await this.callProviderAPI(request, config)

    // 缓存结果
    if (response.audioData) {
      await ttsCache.set({
        text: request.text,
        language: request.language,
        provider: 'online',
        providerName: config.provider,
        voiceId: config.voiceId,
        audioData: response.audioData,
        mimeType: response.mimeType
      })
    }

    return response
  }

  /**
   * 调用供应商 API
   */
  private async callProviderAPI(
    request: TTSRequest, 
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    switch (config.provider) {
      case 'azure':
        return this.callAzureAPI(request, config)
      case 'google':
        return this.callGoogleAPI(request, config)
      case 'tencent':
        return this.callTencentAPI(request, config)
      case 'aliyun':
        return this.callAliyunAPI(request, config)
      case 'youdao':
        return this.callYoudaoAPI(request, config)
      default:
        throw new Error(`Unsupported online TTS provider: ${config.provider}`)
    }
  }

  /**
   * Azure TTS API
   */
  private async callAzureAPI(
    request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    if (!config.apiKey || !config.region) {
      throw new Error('Azure TTS requires API key and region')
    }

    const endpoint = `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`
    
    // SSML 格式
    const ssml = `
      <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${request.language === 'en' ? 'en-US' : 'zh-CN'}'>
        <voice name='${config.voiceId}'>
          <prosody rate='${config.rate}' pitch='${(config.pitch - 1) * 50}%'>
            ${request.text}
          </prosody>
        </voice>
      </speak>
    `

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
      },
      body: ssml
    })

    if (!response.ok) {
      throw new Error(`Azure TTS API error: ${response.status}`)
    }

    const audioData = await response.arrayBuffer()

    return {
      audioData,
      mimeType: 'audio/mpeg',
      cached: false
    }
  }

  /**
   * Google TTS API
   */
  private async callGoogleAPI(
    request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    if (!config.apiKey) {
      throw new Error('Google TTS requires API key')
    }

    const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.apiKey}`

    const body = {
      input: { text: request.text },
      voice: {
        languageCode: request.language === 'en' ? 'en-US' : 'zh-CN',
        name: config.voiceId
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: config.rate,
        pitch: config.pitch
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`Google TTS API error: ${response.status}`)
    }

    const data = await response.json()
    const audioData = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0)).buffer

    return {
      audioData,
      mimeType: 'audio/mpeg',
      cached: false
    }
  }

  /**
   * 腾讯云 TTS API（简化版，实际需要签名）
   */
  private async callTencentAPI(
    request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    // 腾讯云需要复杂的签名机制，这里提供框架
    // 实际使用需要配置 SecretId 和 SecretKey
    throw new Error('腾讯云 TTS 需要配置 API 密钥，请在设置中配置')
  }

  /**
   * 阿里云 TTS API（简化版）
   */
  private async callAliyunAPI(
    request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    // 阿里云需要 Token 认证
    throw new Error('阿里云 TTS 需要配置 API 密钥，请在设置中配置')
  }

  /**
   * 有道翻译 TTS API（免费版）
   * 使用有道翻译的公开语音接口
   */
  private async callYoudaoAPI(
    request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    // 有道翻译免费语音接口
    const langCode = request.language === 'en' ? 'en' : 'zh-CHS'
    const voiceType = config.voiceId?.includes('GB') ? 1 : 0  // 0: 美式, 1: 英式
    
    // 使用有道翻译的公开 TTS 接口
    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(request.text)}&le=${langCode}&type=${voiceType}`
    
    try {
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`有道语音接口错误: ${response.status}`)
      }
      
      const audioData = await response.arrayBuffer()
      
      return {
        audioData,
        mimeType: 'audio/mpeg',
        cached: false
      }
    } catch (error) {
      console.error('有道 TTS 调用失败:', error)
      throw new Error('有道语音服务暂时不可用，请稍后重试')
    }
  }

  /**
   * 播放语音
   */
  async speak(request: TTSRequest): Promise<void> {
    const response = await this.synthesize(request)

    if (!response.audioData) {
      throw new Error('No audio data available')
    }

    await this.playAudio(response.audioData, this.config[request.language === 'en' ? 'en' : 'zh'].volume)
  }

  /**
   * 播放音频数据
   */
  private async playAudio(audioData: ArrayBuffer, volume: number): Promise<void> {
    this.stop()

    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }

    const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0))
    const source = this.audioContext.createBufferSource()
    const gainNode = this.audioContext.createGain()

    source.buffer = audioBuffer
    gainNode.gain.value = volume

    source.connect(gainNode)
    gainNode.connect(this.audioContext.destination)

    this.currentSource = source

    return new Promise((resolve) => {
      source.onended = () => {
        this.currentSource = null
        resolve()
      }
      source.start()
    })
  }

  /**
   * 停止播放
   */
  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch {
        // 忽略已停止的错误
      }
      this.currentSource = null
    }
  }
}

// 导出单例
export const onlineTTS = new OnlineTTSProvider()
