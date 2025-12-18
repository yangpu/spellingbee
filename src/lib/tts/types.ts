/**
 * TTS (Text-to-Speech) 类型定义
 * 统一语音朗读接口，支持多种语音源
 */

// 语音源类型
export type TTSProviderType = 'browser' | 'online' | 'ai'

// 语音语言
export type TTSLanguage = 'en' | 'zh'

// 在线语音供应商
export type OnlineTTSProvider = 
  | 'azure'      // Microsoft Azure TTS
  | 'google'     // Google Cloud TTS
  | 'aws'        // Amazon Polly
  | 'tencent'    // 腾讯云语音合成
  | 'aliyun'     // 阿里云语音合成
  | 'baidu'      // 百度语音合成
  | 'youdao'     // 有道智云

// AI 语音供应商
export type AITTSProvider = 
  | 'openai'     // OpenAI TTS
  | 'elevenlabs' // ElevenLabs
  | 'azure-ai'   // Azure AI Speech
  | 'minimax'    // MiniMax
  | 'doubao'     // 豆包 TTS

// 语音配置基础接口
export interface TTSVoiceConfig {
  rate: number      // 语速 0.5-2.0
  pitch: number     // 音高 0.5-2.0
  volume: number    // 音量 0-1
}

// 浏览器语音配置
export interface BrowserTTSConfig extends TTSVoiceConfig {
  voiceName: string | null  // 浏览器语音名称
}

// 在线语音配置
export interface OnlineTTSConfig extends TTSVoiceConfig {
  provider: OnlineTTSProvider
  voiceId: string           // 供应商语音 ID
  apiKey?: string           // API 密钥（可选，可在环境变量配置）
  region?: string           // 区域（某些供应商需要）
}

// AI 语音配置
export interface AITTSConfig extends TTSVoiceConfig {
  provider: AITTSProvider
  voiceId: string           // AI 语音 ID
  model?: string            // 模型名称
  apiKey?: string           // API 密钥
  baseUrl?: string          // 自定义 API 地址
}

// 完整 TTS 设置
export interface TTSSettings {
  // 当前激活的语音源类型
  activeProvider: TTSProviderType
  
  // 各语言的语音源设置
  english: {
    provider: TTSProviderType
    browser: BrowserTTSConfig
    online: OnlineTTSConfig
    ai: AITTSConfig
  }
  
  chinese: {
    provider: TTSProviderType
    browser: BrowserTTSConfig
    online: OnlineTTSConfig
    ai: AITTSConfig
  }
  
  // 字母拼读配置（使用英文语音）
  spelling: {
    rate: number
    pitch: number
    interval: number  // 字母间隔 ms
  }
  
  // 平台信息
  platform: {
    os: string
    browser: string
  }
}

// 语音缓存条目
export interface TTSCacheEntry {
  id?: number                // IndexedDB 自增 ID
  text: string               // 原始文本（作为 key）
  language: TTSLanguage      // 语言
  provider: TTSProviderType  // 语音源类型
  providerName: string       // 具体供应商名称
  voiceId: string            // 语音 ID
  audioData: ArrayBuffer     // 音频数据
  mimeType: string           // 音频 MIME 类型
  duration?: number          // 音频时长（秒）
  createdAt: number          // 创建时间戳
  lastUsedAt: number         // 最后使用时间戳
  useCount: number           // 使用次数
}

// TTS 请求参数
export interface TTSRequest {
  text: string
  language: TTSLanguage
  config?: Partial<TTSVoiceConfig>
}

// TTS 响应
export interface TTSResponse {
  audioUrl?: string         // 音频 URL（用于播放）
  audioData?: ArrayBuffer   // 音频数据
  mimeType: string
  duration?: number
  cached: boolean           // 是否来自缓存
}

// TTS 供应商接口
export interface TTSProvider {
  readonly type: TTSProviderType
  readonly name: string
  readonly supportedLanguages: TTSLanguage[]
  
  // 初始化
  init(): Promise<void>
  
  // 检查是否可用
  isAvailable(): boolean
  
  // 获取可用语音列表
  getVoices(language?: TTSLanguage): Promise<TTSVoice[]>
  
  // 合成语音
  synthesize(request: TTSRequest): Promise<TTSResponse>
  
  // 直接播放（不返回音频数据）
  speak(request: TTSRequest): Promise<void>
  
  // 停止播放
  stop(): void
}

// 语音信息
export interface TTSVoice {
  id: string                // 语音 ID
  name: string              // 显示名称
  language: TTSLanguage     // 语言
  gender?: 'male' | 'female' | 'neutral'
  provider: TTSProviderType
  providerName: string      // 具体供应商名称
  description?: string      // 描述
  previewUrl?: string       // 试听 URL
}

// 在线语音供应商信息
export interface OnlineProviderInfo {
  id: OnlineTTSProvider
  name: string
  description: string
  website: string
  requiresApiKey: boolean
  free?: boolean              // 是否免费试用
  supportedLanguages: TTSLanguage[]
  voices: TTSVoice[]
}

// AI 语音供应商信息
export interface AIProviderInfo {
  id: AITTSProvider
  name: string
  description: string
  website: string
  requiresApiKey: boolean
  free?: boolean              // 是否免费试用
  supportedLanguages: TTSLanguage[]
  models: string[]
  voices: TTSVoice[]
}

// 默认配置
export const DEFAULT_BROWSER_CONFIG: BrowserTTSConfig = {
  voiceName: null,
  rate: 0.85,
  pitch: 1.0,
  volume: 1.0
}

export const DEFAULT_ONLINE_CONFIG: OnlineTTSConfig = {
  provider: 'tencent',
  voiceId: '101051',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
}

export const DEFAULT_AI_CONFIG: AITTSConfig = {
  provider: 'doubao',
  voiceId: 'BV503_streaming',
  model: 'tts-1',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
}

export const DEFAULT_SPELLING_CONFIG = {
  rate: 1.1,
  pitch: 1.1,
  interval: 120
}

// 获取默认 TTS 设置
export function getDefaultTTSSettings(): TTSSettings {
  return {
    activeProvider: 'browser',
    english: {
      provider: 'browser',
      browser: { ...DEFAULT_BROWSER_CONFIG },
      online: { ...DEFAULT_ONLINE_CONFIG },
      ai: { ...DEFAULT_AI_CONFIG }
    },
    chinese: {
      provider: 'browser',
      browser: { ...DEFAULT_BROWSER_CONFIG, rate: 1.0 },
      online: { 
        ...DEFAULT_ONLINE_CONFIG, 
        provider: 'tencent',
        voiceId: '101001'
      },
      ai: { 
        ...DEFAULT_AI_CONFIG,
        provider: 'doubao',
        voiceId: 'BV700_streaming'
      }
    },
    spelling: { ...DEFAULT_SPELLING_CONFIG },
    platform: { os: 'unknown', browser: 'unknown' }
  }
}
