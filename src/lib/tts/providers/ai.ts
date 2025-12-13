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

// AI 语音供应商配置
export const AI_PROVIDERS: AIProviderInfo[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax 语音合成，中文效果优秀，新用户有免费额度',
    website: 'https://api.minimax.chat',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    models: ['speech-01'],
    voices: [
      { id: 'male-qn-qingse', name: '青涩青年音色', language: 'zh', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
      { id: 'female-shaonv', name: '少女音色', language: 'zh', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
      { id: 'female-yujie', name: '御姐音色', language: 'zh', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
      { id: 'male-qn-jingying', name: '精英青年音色', language: 'zh', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
      { id: 'presenter_male', name: '男性主持人', language: 'zh', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
      { id: 'presenter_female', name: '女性主持人', language: 'zh', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
      { id: 'male-qn-qingse-en', name: 'English Male', language: 'en', gender: 'male', provider: 'ai', providerName: 'MiniMax' },
      { id: 'female-shaonv-en', name: 'English Female', language: 'en', gender: 'female', provider: 'ai', providerName: 'MiniMax' },
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI TTS',
    description: 'OpenAI 语音合成，自然流畅',
    website: 'https://platform.openai.com/docs/guides/text-to-speech',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    models: ['tts-1', 'tts-1-hd'],
    voices: [
      { id: 'alloy', name: 'Alloy (中性)', language: 'en', gender: 'neutral', provider: 'ai', providerName: 'OpenAI' },
      { id: 'echo', name: 'Echo (男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'OpenAI' },
      { id: 'fable', name: 'Fable (男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'OpenAI' },
      { id: 'onyx', name: 'Onyx (男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'OpenAI' },
      { id: 'nova', name: 'Nova (女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'OpenAI' },
      { id: 'shimmer', name: 'Shimmer (女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'OpenAI' },
    ]
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: '最先进的 AI 语音合成，支持声音克隆',
    website: 'https://elevenlabs.io',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    models: ['eleven_multilingual_v2', 'eleven_turbo_v2'],
    voices: [
      { id: 'rachel', name: 'Rachel (美式女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'ElevenLabs' },
      { id: 'adam', name: 'Adam (美式男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'ElevenLabs' },
      { id: 'antoni', name: 'Antoni (英式男声)', language: 'en', gender: 'male', provider: 'ai', providerName: 'ElevenLabs' },
      { id: 'bella', name: 'Bella (美式女声)', language: 'en', gender: 'female', provider: 'ai', providerName: 'ElevenLabs' },
    ]
  },
  {
    id: 'doubao',
    name: '豆包 TTS',
    description: '字节跳动豆包语音合成',
    website: 'https://www.volcengine.com/product/tts',
    requiresApiKey: true,
    free: false,
    supportedLanguages: ['en', 'zh'],
    models: ['tts-1'],
    voices: [
      { id: 'zh_female_shuangkuaisisi_moon_bigtts', name: '爽快思思', language: 'zh', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'zh_male_wennuanahu_moon_bigtts', name: '温暖阿虎', language: 'zh', gender: 'male', provider: 'ai', providerName: '豆包' },
      { id: 'zh_female_tianmeixiaoyuan_moon_bigtts', name: '甜美小源', language: 'zh', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'en_female_amanda', name: 'Amanda', language: 'en', gender: 'female', provider: 'ai', providerName: '豆包' },
      { id: 'en_male_ryan', name: 'Ryan', language: 'en', gender: 'male', provider: 'ai', providerName: '豆包' },
    ]
  }
]

export class AITTSProvider implements TTSProvider {
  readonly type = 'ai' as const
  readonly name = 'AI 语音'
  readonly supportedLanguages: TTSLanguage[] = ['en', 'zh']

  private config: {
    en: AITTSConfig
    zh: AITTSConfig
  }
  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null

  constructor() {
    this.config = {
      en: {
        provider: 'openai',
        voiceId: 'alloy',
        model: 'tts-1',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0
      },
      zh: {
        provider: 'minimax',
        voiceId: 'female-shaonv',
        model: 'speech-01',
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
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = this.config[request.language === 'en' ? 'en' : 'zh']

    // 先检查缓存
    const cached = await ttsCache.get(
      request.text,
      request.language,
      'ai',
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
    if (!config.apiKey) {
      throw new Error('OpenAI TTS requires API key')
    }

    const baseUrl = config.baseUrl || 'https://api.openai.com/v1'
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
        'Authorization': `Bearer ${config.apiKey}`,
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
    if (!config.apiKey) {
      throw new Error('ElevenLabs TTS requires API key')
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
        'xi-api-key': config.apiKey,
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
    if (!config.apiKey) {
      throw new Error('MiniMax TTS requires API key')
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
        'Authorization': `Bearer ${config.apiKey}`,
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
   */
  private async callDoubaoAPI(
    request: TTSRequest,
    config: AITTSConfig
  ): Promise<TTSResponse> {
    if (!config.apiKey) {
      throw new Error('豆包 TTS requires API key')
    }

    // 火山引擎 TTS API
    throw new Error('豆包 TTS 需要配置 API 密钥，请在设置中配置')
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
export const aiTTS = new AITTSProvider()
