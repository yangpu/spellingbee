/**
 * TTS 语音朗读库
 * 统一接口，支持浏览器语音、在线语音、AI语音
 */

export { ttsManager, ttsCache } from './manager'
export { browserTTS, onlineTTS, aiTTS, ONLINE_PROVIDERS, AI_PROVIDERS } from './providers'
export * from './types'
