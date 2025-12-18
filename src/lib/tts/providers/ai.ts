/**
 * AI 语音合成供应商
 * 调用大语言模型 TTS 服务
 */

import type { 
  TTSProvider, 
  TTSRequest, 
  TTSResponse, 
  TTSVoice, 
  TTSLanguage,
  AITTSConfig,
  AITTSProvider as AIProviderType,
  AIProviderInfo
} from '../types'
import { ttsCache } from '../cache'
import { supabase } from '@/lib/supabase'

// 从环境变量获取默认 API Keys
const DEFAULT_AI_API_KEYS = {
  openai: import.meta.env.VITE_TTS_OPENAI_API_KEY || '',
  openaiBaseUrl: import.meta.env.VITE_TTS_OPENAI_BASE_URL || '',
  elevenlabs: import.meta.env.VITE_TTS_ELEVENLABS_API_KEY || '',
  minimax: import.meta.env.VITE_TTS_MINIMAX_API_KEY || '',
  doubao: import.meta.env.VITE_TTS_DOUBAO_API_KEY || '',
}

// AI 语音供应商配置（目前只保留豆包 TTS，其他供应商暂时屏蔽）
export const AI_PROVIDERS: AIProviderInfo[] = [
  {
    id: 'doubao',
    name: '豆包 TTS',
    description: '字节跳动豆包语音合成，通过 Supabase Edge Function 调用',
    website: 'https://www.volcengine.com/product/tts',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    models: ['tts-1'],
    voices: [
      { id: 'BV700_streaming', name: '灿灿 (女声)', language: 'zh', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'BV701_streaming', name: '擎苍 (男声)', language: 'zh', gender: 'male', provider: 'ai', providerName: '豆包' },
      { id: 'BV001_streaming', name: '通用女声', language: 'zh', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'BV002_streaming', name: '通用男声', language: 'zh', gender: 'male', provider: 'ai', providerName: '豆包' },
      { id: 'BV405_streaming', name: '甜美小源 (女声)', language: 'zh', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'BV007_streaming', name: '亲切女声', language: 'zh', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'BV503_streaming', name: 'Ariana (美式女声)', language: 'en', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'BV504_streaming', name: 'Jackson (美式男声)', language: 'en', gender: 'male', provider: 'ai', providerName: '豆包' },
      { id: 'BV027_streaming', name: 'Amelia (美式女声)', language: 'en', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'BV040_streaming', name: 'Anna (英式女声)', language: 'en', gender: 'female', provider: 'ai', providerName: '豆包' },
    ]
  },
  // 以下供应商暂时屏蔽，后续有需求再启用
  // {
  //   id: 'minimax',
  //   name: 'MiniMax',
  //   description: 'MiniMax 语音合成，中文效果优秀，新用户有免费额度',
  //   website: 'https://api.minimax.chat',
  //   requiresApiKey: true,
  //   free: false,
  //   supportedLanguages: ['en', 'zh'],
  //   models: ['speech-01'],
  //   voices: [
  //     { id: 'male-qn-qingse', name: '青涩青年音色', language: 'zh', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
  //     { id: 'female-shaonv', name: '少女音色', language: 'zh', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
  //     { id: 'female-yujie', name: '御姐音色', language: 'zh', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
  //     { id: 'male-qn-jingying', name: '精英青年音色', language: 'zh', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
  //     { id: 'presenter_male', name: '男性主持人', language: 'zh', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
  //     { id: 'presenter_female', name: '女性主持人', language: 'zh', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
  //     { id: 'male-qn-qingse-en', name: 'English Male', language: 'en', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
  //     { id: 'female-shaonv-en', name: 'English Female', language: 'en', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
  //   ]
  // },
  // {
  //   id: 'openai',
  //   name: 'OpenAI TTS',
  //   description: 'OpenAI 语音合成，自然流畅',
  //   website: 'https://platform.openai.com/docs/guides/text-to-speech',
  //   requiresApiKey: true,
  //   free: false,
  //   supportedLanguages: ['en', 'zh'],
  //   models: ['tts-1', 'tts-1-hd'],
  //   voices: [
  //     { id: 'alloy', name: 'Alloy (中性)', language: 'en', gender: 'neutral', provider: 'ai', providerName: 'OpenAI' },
  //     { id: 'echo', name: 'Echo (男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'OpenAI' },
  //     { id: 'fable', name: 'Fable (男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'OpenAI' },
  //     { id: 'onyx', name: 'Onyx (男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'OpenAI' },
  //     { id: 'nova', name: 'Nova (女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'OpenAI' },
  //     { id: 'shimmer', name: 'Shimmer (女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'OpenAI' },
  //   ]
  // },
  // {
  //   id: 'elevenlabs',
  //   name: 'ElevenLabs',
  //   description: '最先进的 AI 语音合成，支持声音克隆',
  //   website: 'https://elevenlabs.io',
  //   requiresApiKey: true,
  //   free: false,
  //   supportedLanguages: ['en', 'zh'],
  //   models: ['eleven_multilingual_v2', 'eleven_turbo_v2'],
  //   voices: [
  //     { id: 'rachel', name: 'Rachel (美式女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'ElevenLabs' },
  //     { id: 'adam', name: 'Adam (美式男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'ElevenLabs' },
  //     { id: 'antoni', name: 'Antoni (英式男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'ElevenLabs' },
  //     { id: 'bella', name: 'Bella (美式女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'ElevenLabs' },
  //   ]
  // },
]

export class AITTSProvider implements TTSProvider {
  readonly type = 'ai' as const
  readonly name = 'AI 语音'
  readonly supportedLanguages: TTSLanguage[] = ['en', 'zh']

  private config: {
    en: AITTSConfig
    zh: AITTSConfig
  }
  private currentAudio: HTMLAudioElement | null = null
  private currentBlobUrl: string | null = null  // 跟踪当前 Blob URL 以便清理

  constructor() {
    this.config = {
      en: {
        provider: 'doubao',
        voiceId: 'BV503_streaming',
        model: 'tts-1',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0
      },
      zh: {
        provider: 'doubao',
        voiceId: 'BV700_streaming',
        model: 'tts-1',
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
    const enConfig = this.config.en
    const zhConfig = this.config.zh
    return !!(enConfig.apiKey || zhConfig.apiKey)
  }

  async getVoices(language?: TTSLanguage): Promise<TTSVoice[]> {
    const allVoices: TTSVoice[] = []

    for (const provider of AI_PROVIDERS) {
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
  setConfig(language: TTSLanguage, config: Partial<AITTSConfig>): void {
    const langKey = language === 'en' ? 'en' : 'zh'
    Object.assign(this.config[langKey], config)
  }

  /**
   * 获取语音配置
   */
  getConfig(language: TTSLanguage): AITTSConfig {
    return this.config[language === 'en' ? 'en' : 'zh']
  }

  /**
   * 获取供应商列表
   */
  getProviders(): AIProviderInfo[] {
    return AI_PROVIDERS
  }

  /**
   * 合成语音
   * 缓存策略：本地 IndexedDB 缓存
   * AI 语音直接调用各供应商 API
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = this.config[request.language === 'en' ? 'en' : 'zh']

    // 检查本地 IndexedDB 缓存
    const localCached = await ttsCache.get(
      request.text,
      request.language,
      'ai',
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

    // 调用 AI TTS API 生成
    const response = await this.callProviderAPI(request, config)

    // 保存到本地 IndexedDB 缓存
    if (response.audioData) {
      await ttsCache.set({
        text: request.text,
        language: request.language,
        provider: 'ai',
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
    config: AITTSConfig
  ): Promise<TTSResponse> {
    switch (config.provider) {
      case 'openai':
        return this.callOpenAIAPI(request, config)
      case 'elevenlabs':
        return this.callElevenLabsAPI(request, config)
      case 'minimax':
        return this.callMiniMaxAPI(request, config)
      case 'doubao':
        return this.callDoubaoAPI(request, config)
      default:
        throw new Error(`Unsupported AI TTS provider: ${config.provider}`)
    }
  }

  /**
   * OpenAI TTS API
   */
  private async callOpenAIAPI(
    request: TTSRequest,
    config: AITTSConfig
  ): Promise<TTSResponse> {
    // 优先使用用户配置的 API Key，否则使用默认配置
    const apiKey = config.apiKey || DEFAULT_AI_API_KEYS.openai
    if (!apiKey) {
      throw new Error('OpenAI TTS 需要配置 API Key')
    }

    const baseUrl = config.baseUrl || DEFAULT_AI_API_KEYS.openaiBaseUrl || 'https://api.openai.com/v1'
    const endpoint = `${baseUrl}/audio/speech`

    const body = {
      model: config.model || 'tts-1',
      input: request.text,
      voice: config.voiceId,
      speed: config.rate
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI TTS API error: ${response.status} - ${error}`)
    }

    const audioData = await response.arrayBuffer()

    return {
      audioData,
      mimeType: 'audio/mpeg',
      cached: false
    }
  }

  /**
   * ElevenLabs TTS API
   */
  private async callElevenLabsAPI(
    request: TTSRequest,
    config: AITTSConfig
  ): Promise<TTSResponse> {
    // 优先使用用户配置的 API Key，否则使用默认配置
    const apiKey = config.apiKey || DEFAULT_AI_API_KEYS.elevenlabs
    if (!apiKey) {
      throw new Error('ElevenLabs TTS 需要配置 API Key')
    }

    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`

    const body = {
      text: request.text,
      model_id: config.model || 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`ElevenLabs TTS API error: ${response.status} - ${error}`)
    }

    const audioData = await response.arrayBuffer()

    return {
      audioData,
      mimeType: 'audio/mpeg',
      cached: false
    }
  }

  /**
   * MiniMax TTS API
   */
  private async callMiniMaxAPI(
    request: TTSRequest,
    config: AITTSConfig
  ): Promise<TTSResponse> {
    // 优先使用用户配置的 API Key，否则使用默认配置
    const apiKey = config.apiKey || DEFAULT_AI_API_KEYS.minimax
    if (!apiKey) {
      throw new Error('MiniMax TTS 需要配置 API Key')
    }

    // MiniMax 需要 group_id，这里假设从 baseUrl 获取
    const groupId = config.baseUrl || ''
    const endpoint = `https://api.minimax.chat/v1/text_to_speech?GroupId=${groupId}`

    const body = {
      model: config.model || 'speech-01',
      text: request.text,
      voice_setting: {
        voice_id: config.voiceId,
        speed: config.rate,
        pitch: Math.round((config.pitch - 1) * 10) // 转换为 -10 到 10
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`MiniMax TTS API error: ${response.status} - ${error}`)
    }

    const audioData = await response.arrayBuffer()

    return {
      audioData,
      mimeType: 'audio/mpeg',
      cached: false
    }
  }

  /**
   * 豆包 TTS API
   * 通过 Supabase Edge Function 调用火山引擎语音合成
   * API Key 格式: AppId:Token 或 AppId:Token:Cluster
   */
  private async callDoubaoAPI(
    request: TTSRequest,
    config: AITTSConfig
  ): Promise<TTSResponse> {
    // 优先使用用户配置的 API Key，否则使用默认配置
    const apiKey = config.apiKey || DEFAULT_AI_API_KEYS.doubao
    if (!apiKey) {
      throw new Error('豆包 TTS 需要配置 API 密钥，请在设置中配置')
    }

    // API Key 格式: AppId:Token 或 AppId:Token:Cluster
    const parts = apiKey.split(':')
    if (parts.length < 2) {
      throw new Error('豆包 API 密钥格式错误，请使用格式: AppId:Token 或 AppId:Token:Cluster')
    }
    
    const [appId, token, cluster] = parts

    // 将语速从 0.5-2.0 映射到火山引擎的 0.2-3.0
    const rate = Math.max(0.2, Math.min(3.0, config.rate))
    
    // 将音量从 0-1 映射到火山引擎的 0.1-3.0
    const volume = Math.max(0.1, Math.min(3.0, config.volume * 3))

    // 调用 Supabase Edge Function
    const { data, error } = await supabase.functions.invoke('doubao-tts', {
      body: {
        text: request.text,
        language: request.language,
        voiceId: config.voiceId,
        rate,
        volume,
        appId,
        token,
        cluster: cluster || undefined
      }
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
      throw new Error(`豆包 TTS 请求失败: ${errorMessage}`)
    }

    // 检查是否返回了 JSON 错误响应
    if (data && typeof data === 'object' && !ArrayBuffer.isView(data) && !(data instanceof Blob) && !(data instanceof ArrayBuffer)) {
      if ('error' in data) {
        const details = data.message ? `: ${data.message}` : ''
        throw new Error(`${data.error}${details}`)
      }
      throw new Error(`豆包 TTS 返回了意外的数据格式: ${JSON.stringify(data)}`)
    }

    // Edge Function 返回的是 ArrayBuffer
    if (data instanceof ArrayBuffer) {
      return {
        audioData: data,
        mimeType: 'audio/mpeg',
        cached: false
      }
    }

    // 如果返回的是 Blob
    if (data instanceof Blob) {
      const audioData = await data.arrayBuffer()
      return {
        audioData,
        mimeType: data.type || 'audio/mpeg',
        cached: false
      }
    }

    throw new Error(`豆包 TTS 返回数据格式错误，类型: ${typeof data}`)
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
export const aiTTS = new AITTSProvider()
