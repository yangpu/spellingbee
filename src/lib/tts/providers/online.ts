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
  OnlineProviderInfo
} from '../types'
import { ttsCache } from '../cache'
import { supabase } from '@/lib/supabase'

// 从环境变量获取默认 API Keys
const DEFAULT_API_KEYS = {
  tencent: import.meta.env.VITE_TTS_TENCENT_API_KEY || '',
  azure: import.meta.env.VITE_TTS_AZURE_API_KEY || '',
  azureRegion: import.meta.env.VITE_TTS_AZURE_REGION || 'eastasia',
  google: import.meta.env.VITE_TTS_GOOGLE_API_KEY || '',
}

// 在线语音供应商配置（目前只保留腾讯云，其他供应商暂时屏蔽）
export const ONLINE_PROVIDERS: OnlineProviderInfo[] = [
  {
    id: 'tencent',
    name: '腾讯云',
    description: '腾讯云语音合成，通过 Supabase Edge Function 调用，音质优秀',
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
  // 以下供应商暂时屏蔽，后续有需求再启用
  // {
  //   id: 'youdao',
  //   name: '有道翻译',
  //   description: '有道翻译语音朗读，免费使用，适合英语学习',
  //   website: 'https://fanyi.youdao.com',
  //   requiresApiKey: false,
  //   free: true,
  //   supportedLanguages: ['en', 'zh'],
  //   voices: [
  //     { id: 'en-US-1', name: '美式英语', language: 'en', gender: 'female', provider: 'online', providerName: '有道翻译' },
  //     { id: 'en-GB-1', name: '英式英语', language: 'en', gender: 'female', provider: 'online', providerName: '有道翻译' },
  //     { id: 'zh-CN-1', name: '中文普通话', language: 'zh', gender: 'female', provider: 'online', providerName: '有道翻译' },
  //   ]
  // },
  // {
  //   id: 'azure',
  //   name: 'Microsoft Azure',
  //   description: '微软 Azure 认知服务语音合成，音质优秀',
  //   website: 'https://azure.microsoft.com/services/cognitive-services/text-to-speech/',
  //   requiresApiKey: true,
  //   free: false,
  //   supportedLanguages: ['en', 'zh'],
  //   voices: [
  //     { id: 'en-US-JennyNeural', name: 'Jenny (美式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Azure' },
  //     { id: 'en-US-GuyNeural', name: 'Guy (美式男声)', language: 'en', gender: 'male', provider: 'online', providerName: 'Azure' },
  //     { id: 'en-GB-SoniaNeural', name: 'Sonia (英式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Azure' },
  //     { id: 'en-GB-RyanNeural', name: 'Ryan (英式男声)', language: 'en', gender: 'male', provider: 'online', providerName: 'Azure' },
  //     { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: 'Azure' },
  //     { id: 'zh-CN-YunxiNeural', name: '云希 (男声)', language: 'zh', gender: 'male', provider: 'online', providerName: 'Azure' },
  //     { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: 'Azure' },
  //   ]
  // },
  // {
  //   id: 'google',
  //   name: 'Google Cloud',
  //   description: 'Google Cloud Text-to-Speech，支持多种语言',
  //   website: 'https://cloud.google.com/text-to-speech',
  //   requiresApiKey: true,
  //   free: false,
  //   supportedLanguages: ['en', 'zh'],
  //   voices: [
  //     { id: 'en-US-Neural2-F', name: 'Neural2-F (美式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Google' },
  //     { id: 'en-US-Neural2-D', name: 'Neural2-D (美式男声)', language: 'en', gender: 'male', provider: 'online', providerName: 'Google' },
  //     { id: 'en-GB-Neural2-A', name: 'Neural2-A (英式女声)', language: 'en', gender: 'female', provider: 'online', providerName: 'Google' },
  //     { id: 'cmn-CN-Wavenet-A', name: 'Wavenet-A (女声)', language: 'zh', gender: 'female', provider: 'online', providerName: 'Google' },
  //     { id: 'cmn-CN-Wavenet-B', name: 'Wavenet-B (男声)', language: 'zh', gender: 'male', provider: 'online', providerName: 'Google' },
  //   ]
  // },
  // {
  //   id: 'aliyun',
  //   name: '阿里云',
  //   description: '阿里云智能语音服务（需后端代理，浏览器端暂不支持）',
  //   website: 'https://ai.aliyun.com/nls/tts',
  //   requiresApiKey: true,
  //   free: false,
  //   supportedLanguages: ['en', 'zh'],
  //   voices: [
  //     { id: 'xiaoyun', name: '小云 (标准女声)', language: 'zh', gender: 'female', provider: 'online', providerName: '阿里云' },
  //     { id: 'xiaogang', name: '小刚 (标准男声)', language: 'zh', gender: 'male', provider: 'online', providerName: '阿里云' },
  //     { id: 'ruoxi', name: '若兮 (温柔女声)', language: 'zh', gender: 'female', provider: 'online', providerName: '阿里云' },
  //     { id: 'harry', name: 'Harry (英式男声)', language: 'en', gender: 'male', provider: 'online', providerName: '阿里云' },
  //     { id: 'abby', name: 'Abby (美式女声)', language: 'en', gender: 'female', provider: 'online', providerName: '阿里云' },
  //   ]
  // }
]

export class OnlineTTSProvider implements TTSProvider {
  readonly type = 'online' as const
  readonly name = '在线语音'
  readonly supportedLanguages: TTSLanguage[] = ['en', 'zh']

  private config: {
    en: OnlineTTSConfig
    zh: OnlineTTSConfig
  }
  private currentAudio: HTMLAudioElement | null = null  // 用于播放音频
  private currentBlobUrl: string | null = null  // 跟踪当前 Blob URL 以便清理

  constructor() {
    this.config = {
      en: {
        provider: 'tencent',
        voiceId: '101051',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0
      },
      zh: {
        provider: 'tencent',
        voiceId: '101001',
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
   * 缓存策略：
   * 1. 本地 IndexedDB 缓存（最快）
   * 2. 调用 Edge Function（内部处理 Storage 缓存 + API 调用）
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = this.config[request.language === 'en' ? 'en' : 'zh']

    // 检查本地 IndexedDB 缓存
    const localCached = await ttsCache.get(
      request.text,
      request.language,
      'online',
      config.voiceId
    )

    if (localCached) {
      return {
        audioData: localCached.audioData,
        mimeType: localCached.mimeType,
        duration: localCached.duration,
        cached: true
      }
    }

    // 调用 Edge Function（内部处理 Storage 缓存）
    const response = await this.callProviderAPI(request, config)

    // 保存到本地 IndexedDB 缓存
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
    // 优先使用用户配置的 API Key，否则使用默认配置
    const apiKey = config.apiKey || DEFAULT_API_KEYS.azure
    const region = config.region || DEFAULT_API_KEYS.azureRegion
    
    if (!apiKey || !region) {
      throw new Error('Azure TTS 需要配置 API Key 和区域')
    }

    const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
    
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
        'Ocp-Apim-Subscription-Key': apiKey,
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
    // 优先使用用户配置的 API Key，否则使用默认配置
    const apiKey = config.apiKey || DEFAULT_API_KEYS.google
    if (!apiKey) {
      throw new Error('Google TTS 需要配置 API Key')
    }

    const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`

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
   * 腾讯云 TTS API
   * 通过 Supabase Edge Function 调用腾讯云语音合成
   * API Key 格式: AppId:SecretId:SecretKey
   */
  private async callTencentAPI(
    request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    // 优先使用用户配置的 API Key，否则使用默认配置
    const apiKey = config.apiKey || DEFAULT_API_KEYS.tencent
    if (!apiKey) {
      throw new Error('腾讯云 TTS 需要配置 API 密钥，请在设置中配置')
    }

    // API Key 格式: AppId:SecretId:SecretKey
    const parts = apiKey.split(':')
    if (parts.length !== 3) {
      throw new Error('腾讯云 API 密钥格式错误，请使用格式: AppId:SecretId:SecretKey')
    }
    
    const [appIdStr, secretId, secretKey] = parts
    const appId = parseInt(appIdStr, 10)
    if (isNaN(appId)) {
      throw new Error('腾讯云 AppId 必须是数字')
    }

    // 将语速从 0.5-2.0 映射到腾讯云的 -2 到 6
    // 1.0 对应 0，0.5 对应 -2，2.0 对应 6
    const rate = Math.round((config.rate - 1) * 4)
    
    // 将音量从 0-1 映射到腾讯云的 0-10
    const volume = Math.round(config.volume * 10)

    const requestBody = {
      text: request.text,
      language: request.language,
      voiceId: config.voiceId,
      rate,
      volume,
      secretId,
      secretKey,
      appId
    }

    // 调用 Supabase Edge Function
    const { data, error } = await supabase.functions.invoke('tencent-tts', {
      body: requestBody
    })

    if (error) {
      // 尝试从 response 获取更详细的错误信息
      let errorDetail = ''
      if (error.context) {
        try {
          const errorBody = await error.context.text?.()
          if (errorBody) {
            const parsed = JSON.parse(errorBody)
            errorDetail = parsed.error || parsed.message || errorBody
          }
        } catch {
          // 忽略解析错误
        }
      }
      const errorMessage = errorDetail || error.message || '未知错误'
      throw new Error(`腾讯云 TTS 请求失败: ${errorMessage}`)
    }

    // 检查是否返回了 JSON 错误响应
    if (data && typeof data === 'object' && !ArrayBuffer.isView(data) && !(data instanceof Blob) && !(data instanceof ArrayBuffer)) {
      if ('error' in data) {
        const details = data.details ? JSON.stringify(data.details) : ''
        throw new Error(`${data.error}${details ? ': ' + details : ''}`)
      }
      // 如果是其他 JSON 对象，可能是错误
      throw new Error(`腾讯云 TTS 返回了意外的数据格式: ${JSON.stringify(data)}`)
    }

    // Edge Function 返回的是 ArrayBuffer
    if (data instanceof ArrayBuffer) {
      return {
        audioData: data,
        mimeType: 'audio/mpeg',
        cached: false
      }
    }

    // 如果返回的是 Blob（Supabase functions-js 对 application/octet-stream 返回 Blob）
    if (data instanceof Blob) {
      const audioData = await data.arrayBuffer()
      return {
        audioData,
        mimeType: data.type || 'audio/mpeg',
        cached: false
      }
    }

    // 如果是字符串，可能是 text 响应（错误情况）
    if (typeof data === 'string') {
      // 尝试解析为 JSON
      try {
        const parsed = JSON.parse(data)
        if (parsed.error) {
          throw new Error(parsed.error)
        }
      } catch {
        // 不是 JSON，直接报错
      }
      throw new Error(`腾讯云 TTS 返回了文本而非音频数据: ${data.substring(0, 100)}`)
    }

    throw new Error(`腾讯云 TTS 返回数据格式错误，类型: ${typeof data}`)
  }

  /**
   * 阿里云 TTS API
   * 阿里云需要 Token 认证，浏览器端暂不支持
   */
  private async callAliyunAPI(
    _request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    if (!config.apiKey) {
      throw new Error('阿里云 TTS 需要配置 API 密钥，请在设置中配置')
    }

    // 阿里云需要 AccessKey 进行签名认证
    // 浏览器端无法安全地进行签名，建议使用后端代理
    throw new Error('阿里云 TTS 需要后端代理支持，浏览器端暂不可用。建议使用有道翻译（免费）或其他已支持的供应商。')
  }

  /**
   * 有道翻译 TTS API（免费版）
   * 使用有道翻译的公开语音接口
   * 注意：由于 CORS 限制，不能通过 fetch 获取数据，需要直接使用 audio 元素播放
   */
  private async callYoudaoAPI(
    request: TTSRequest,
    config: OnlineTTSConfig
  ): Promise<TTSResponse> {
    // 有道不支持通过 fetch 获取音频数据（CORS 限制）
    // 返回 audioUrl，让 speak 方法使用 audio 元素播放
    const langCode = request.language === 'en' ? 'en' : 'zh-CHS'
    const voiceType = config.voiceId?.includes('GB') ? 1 : 0  // 0: 美式, 1: 英式
    
    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(request.text)}&le=${langCode}&type=${voiceType}`
    
    return {
      audioUrl: url,
      mimeType: 'audio/mpeg',
      cached: false
    }
  }

  /**
   * 播放语音
   */
  async speak(request: TTSRequest): Promise<void> {
    const config = this.config[request.language === 'en' ? 'en' : 'zh']
    
    // 有道翻译使用 audio 元素直接播放 URL（绕过 CORS）
    if (config.provider === 'youdao') {
      await this.speakWithAudioElement(request, config)
      return
    }
    
    const response = await this.synthesize(request)

    if (!response.audioData) {
      throw new Error('No audio data available')
    }

    await this.playAudio(response.audioData, config.volume)
  }

  /**
   * 使用 audio 元素播放（用于有道等有 CORS 限制的供应商）
   */
  private async speakWithAudioElement(request: TTSRequest, config: OnlineTTSConfig): Promise<void> {
    this.stop()
    
    const langCode = request.language === 'en' ? 'en' : 'zh-CHS'
    const voiceType = config.voiceId?.includes('GB') ? 1 : 0
    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(request.text)}&le=${langCode}&type=${voiceType}`
    
    return new Promise((resolve, reject) => {
      const audio = new Audio(url)
      audio.volume = config.volume
      this.currentAudio = audio
      
      // 超时保护
      const timeoutId = setTimeout(() => {
        this.currentAudio = null
        audio.pause()
        resolve()  // 超时后静默完成
      }, 10000)  // 10秒超时
      
      audio.onended = () => {
        clearTimeout(timeoutId)
        this.currentAudio = null
        resolve()
      }
      
      audio.onerror = () => {
        clearTimeout(timeoutId)
        this.currentAudio = null
        reject(new Error('有道语音播放失败，请检查网络连接'))
      }
      
      audio.play().catch((e) => {
        clearTimeout(timeoutId)
        this.currentAudio = null
        reject(new Error(`有道语音播放失败: ${e.message}`))
      })
    })
  }

  /**
   * 播放音频数据
   * 使用 HTMLAudioElement 播放，兼容移动端
   * 复用同一个 Audio 元素以支持移动端连续播放
   */
  private async playAudio(audioData: ArrayBuffer, volume: number): Promise<void> {
    // 清理之前的 Blob URL
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }

    // 创建新的 Blob URL
    const blob = new Blob([audioData], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    this.currentBlobUrl = url
    
    return new Promise((resolve, reject) => {
      // 复用或创建 Audio 元素
      // 移动端需要复用同一个 Audio 元素才能连续播放
      if (!this.currentAudio) {
        this.currentAudio = new Audio()
      }
      
      const audio = this.currentAudio
      audio.volume = volume
      
      // 超时保护
      const timeoutId = setTimeout(() => {
        if (this.currentBlobUrl === url) {
          URL.revokeObjectURL(url)
          this.currentBlobUrl = null
        }
        resolve()
      }, 30000)  // 30秒超时
      
      const cleanup = () => {
        clearTimeout(timeoutId)
        audio.onended = null
        audio.onerror = null
      }
      
      audio.onended = () => {
        cleanup()
        if (this.currentBlobUrl === url) {
          URL.revokeObjectURL(url)
          this.currentBlobUrl = null
        }
        resolve()
      }
      
      audio.onerror = (e) => {
        cleanup()
        if (this.currentBlobUrl === url) {
          URL.revokeObjectURL(url)
          this.currentBlobUrl = null
        }
        reject(new Error(`音频播放失败: ${e}`))
      }
      
      // 设置新的音频源并播放
      audio.src = url
      audio.load()
      audio.play().catch((e) => {
        cleanup()
        if (this.currentBlobUrl === url) {
          URL.revokeObjectURL(url)
          this.currentBlobUrl = null
        }
        reject(new Error(`音频播放失败: ${e.message}`))
      })
    })
  }

  /**
   * 停止播放
   */
  stop(): void {
    // 停止 Audio 元素
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.currentTime = 0
      } catch {
        // 忽略错误
      }
      // 不要销毁 Audio 元素，保留以便复用
    }
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }
  }
}

// 导出单例
export const onlineTTS = new OnlineTTSProvider()
