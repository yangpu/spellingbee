/**
 * 后台音频播放服务
 * 用于在移动端保持应用在后台时继续播放语音
 * 
 * 原理：
 * 1. 使用 Web Audio API 创建静音音频流，防止系统暂停应用
 * 2. 使用 Media Session API 注册媒体会话，让系统识别为媒体应用
 * 3. 使用 Wake Lock API（如果支持）防止屏幕锁定时暂停
 */

interface BackgroundAudioCallbacks {
  onPlay?: () => void
  onPause?: () => void
  onNext?: () => void
  onPrevious?: () => void
}

interface Progress {
  current: number
  total: number
}

// Extend Window interface for webkit prefixed AudioContext
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

class BackgroundAudioService {
  private audioContext: AudioContext | null = null
  private silentSource: OscillatorNode | null = null
  private silentGain: GainNode | null = null
  private wakeLock: WakeLockSentinel | null = null
  private isActive = false
  private currentWord = ''
  private currentProgress: Progress = { current: 0, total: 0 }
  private callbacks: BackgroundAudioCallbacks | null = null
  
  constructor() {
    // 绑定方法
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this)
  }
  
  /**
   * 初始化后台音频服务
   */
  async init(): Promise<void> {
    if (this.audioContext) return
    
    try {
      // 创建 AudioContext
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass()
      }
      
      // 设置 Media Session（如果支持）
      this.setupMediaSession()
      
      // 监听页面可见性变化
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
      
      console.log('[BackgroundAudio] Service initialized')
    } catch (e) {
      console.error('[BackgroundAudio] Init error:', e)
    }
  }
  
  /**
   * 设置 Media Session
   */
  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) {
      console.log('[BackgroundAudio] Media Session API not supported')
      return
    }
    
    // 设置媒体元数据
    navigator.mediaSession.metadata = new MediaMetadata({
      title: '单词学习',
      artist: 'Spelling Bee',
      album: '自动学习模式',
      artwork: [
        { src: '/bee.svg', sizes: '96x96', type: 'image/svg+xml' },
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
      ]
    })
    
    // 设置播放状态
    navigator.mediaSession.playbackState = 'none'
  }
  
  /**
   * 更新媒体会话信息
   */
  updateMediaSession(word: string, progress: Progress): void {
    if (!('mediaSession' in navigator)) return
    
    this.currentWord = word
    this.currentProgress = progress
    
    navigator.mediaSession.metadata = new MediaMetadata({
      title: word || '单词学习',
      artist: `第 ${progress.current} / ${progress.total} 个单词`,
      album: 'Spelling Bee - 自动学习',
      artwork: [
        { src: '/bee.svg', sizes: '96x96', type: 'image/svg+xml' },
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
      ]
    })
  }
  
  /**
   * 启动后台播放模式
   */
  async start(callbacks: BackgroundAudioCallbacks = {}): Promise<void> {
    if (this.isActive) return
    
    this.isActive = true
    this.callbacks = callbacks
    
    try {
      // 1. 确保 AudioContext 处于运行状态
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }
      
      // 2. 创建静音音频流（保持音频会话活跃）
      this.startSilentAudio()
      
      // 3. 请求 Wake Lock（防止屏幕锁定时暂停）
      await this.requestWakeLock()
      
      // 4. 更新 Media Session 状态
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
        
        // 设置媒体控制回调
        navigator.mediaSession.setActionHandler('play', () => {
          if (callbacks.onPlay) callbacks.onPlay()
        })
        navigator.mediaSession.setActionHandler('pause', () => {
          if (callbacks.onPause) callbacks.onPause()
        })
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          if (callbacks.onNext) callbacks.onNext()
        })
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          if (callbacks.onPrevious) callbacks.onPrevious()
        })
      }
      
      console.log('[BackgroundAudio] Background mode started')
    } catch (e) {
      console.error('[BackgroundAudio] Start error:', e)
    }
  }
  
  /**
   * 停止后台播放模式
   */
  stop(): void {
    if (!this.isActive) return
    
    this.isActive = false
    this.callbacks = null
    
    // 停止静音音频
    this.stopSilentAudio()
    
    // 释放 Wake Lock
    this.releaseWakeLock()
    
    // 更新 Media Session 状态
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused'
    }
    
    console.log('[BackgroundAudio] Background mode stopped')
  }
  
  /**
   * 创建并播放静音音频流
   * 这是保持后台活跃的关键
   */
  private startSilentAudio(): void {
    if (!this.audioContext || this.silentSource) return
    
    try {
      // 创建一个非常小的振荡器（几乎静音）
      const oscillator = this.audioContext.createOscillator()
      const gainNode = this.audioContext.createGain()
      
      // 设置为几乎听不到的音量
      gainNode.gain.value = 0.001
      
      oscillator.connect(gainNode)
      gainNode.connect(this.audioContext.destination)
      
      oscillator.frequency.value = 1 // 1Hz，人耳听不到
      oscillator.start()
      
      this.silentSource = oscillator
      this.silentGain = gainNode
      
      console.log('[BackgroundAudio] Silent audio started')
    } catch (e) {
      console.error('[BackgroundAudio] Silent audio error:', e)
    }
  }
  
  /**
   * 停止静音音频流
   */
  private stopSilentAudio(): void {
    if (this.silentSource) {
      try {
        this.silentSource.stop()
        this.silentSource.disconnect()
      } catch (e) {
        // 忽略错误
      }
      this.silentSource = null
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect()
      } catch (e) {
        // 忽略错误
      }
      this.silentGain = null
    }
  }
  
  /**
   * 请求 Wake Lock（防止屏幕锁定）
   */
  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      console.log('[BackgroundAudio] Wake Lock API not supported')
      return
    }
    
    try {
      this.wakeLock = await navigator.wakeLock.request('screen')
      
      this.wakeLock.addEventListener('release', () => {
        console.log('[BackgroundAudio] Wake Lock released')
      })
      
      console.log('[BackgroundAudio] Wake Lock acquired')
    } catch (e) {
      console.log('[BackgroundAudio] Wake Lock request failed:', (e as Error).message)
    }
  }
  
  /**
   * 释放 Wake Lock
   */
  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release()
      } catch (e) {
        // 忽略错误
      }
      this.wakeLock = null
    }
  }
  
  /**
   * 处理页面可见性变化
   */
  private async handleVisibilityChange(): Promise<void> {
    if (!this.isActive) return
    
    if (document.hidden) {
      // 页面进入后台
      console.log('[BackgroundAudio] Page hidden, maintaining audio session')
      
      // 确保 AudioContext 继续运行
      if (this.audioContext && this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume()
        } catch (e) {
          console.error('[BackgroundAudio] Failed to resume AudioContext:', e)
        }
      }
    } else {
      // 页面回到前台
      console.log('[BackgroundAudio] Page visible')
      
      // 重新请求 Wake Lock（可能在后台被释放）
      if (!this.wakeLock && this.isActive) {
        await this.requestWakeLock()
      }
    }
  }
  
  /**
   * 检查是否支持后台播放
   */
  static isSupported(): boolean {
    const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext)
    const hasMediaSession = 'mediaSession' in navigator
    return hasAudioContext || hasMediaSession
  }
  
  /**
   * 检查是否是移动设备
   */
  static isMobile(): boolean {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  }
  
  /**
   * 销毁服务
   */
  destroy(): void {
    this.stop()
    
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    
    if (this.audioContext) {
      try {
        this.audioContext.close()
      } catch (e) {
        // 忽略错误
      }
      this.audioContext = null
    }
  }
}

// 创建单例实例
export const backgroundAudio = new BackgroundAudioService()

export default backgroundAudio
