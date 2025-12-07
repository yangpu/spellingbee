/**
 * 后台音频播放服务
 * 用于在移动端保持应用在后台时继续播放语音
 * 
 * 原理：
 * 1. 使用 <audio> 元素循环播放静音音频文件，触发系统媒体会话
 * 2. 使用 Media Session API 注册媒体会话，让系统识别为媒体应用
 * 3. iOS 需要真正的 audio 元素才能在灵动岛/控制中心显示
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

class BackgroundAudioService {
  private audioElement: HTMLAudioElement | null = null
  private wakeLock: WakeLockSentinel | null = null
  public isActive = false
  private currentWord = ''
  private currentProgress: Progress = { current: 0, total: 0 }
  private callbacks: BackgroundAudioCallbacks | null = null
  
  constructor() {
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this)
  }
  
  /**
   * 初始化后台音频服务
   */
  async init(): Promise<void> {
    if (this.audioElement) return
    
    try {
      // 创建 audio 元素，播放静音音频文件
      this.audioElement = document.createElement('audio')
      this.audioElement.id = 'background-audio'
      
      // 使用一个真实的静音音频文件（需要存在于 public 目录）
      // 或者使用 data URI 生成一个极短的静音音频
      this.audioElement.src = this.createSilentAudioDataUri()
      this.audioElement.loop = true
      this.audioElement.volume = 0.01 // 极低音量
      this.audioElement.preload = 'auto'
      
      // 添加到 DOM（某些浏览器需要）
      this.audioElement.style.display = 'none'
      document.body.appendChild(this.audioElement)
      
      // 设置 Media Session
      this.setupMediaSession()
      
      // 监听页面可见性变化
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
      
      //console.log('[BackgroundAudio] Service initialized with audio element')
    } catch (e) {
      console.error('[BackgroundAudio] Init error:', e)
    }
  }
  
  /**
   * 创建静音音频的 Data URI
   * 生成一个 1 秒的静音 WAV 文件
   */
  private createSilentAudioDataUri(): string {
    // 创建一个 1 秒的静音 WAV 文件
    const sampleRate = 8000
    const numChannels = 1
    const bitsPerSample = 8
    const duration = 1 // 1 秒
    const numSamples = sampleRate * duration
    
    const buffer = new ArrayBuffer(44 + numSamples)
    const view = new DataView(buffer)
    
    // WAV 文件头
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }
    
    writeString(0, 'RIFF')
    view.setUint32(4, 36 + numSamples, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true) // Subchunk1Size
    view.setUint16(20, 1, true) // AudioFormat (PCM)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true) // ByteRate
    view.setUint16(32, numChannels * bitsPerSample / 8, true) // BlockAlign
    view.setUint16(34, bitsPerSample, true)
    writeString(36, 'data')
    view.setUint32(40, numSamples, true)
    
    // 静音数据（8位 PCM 的静音值是 128）
    for (let i = 0; i < numSamples; i++) {
      view.setUint8(44 + i, 128)
    }
    
    // 转换为 Base64
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    
    return 'data:audio/wav;base64,' + btoa(binary)
  }
  
  /**
   * 设置 Media Session
   */
  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) {
      //console.log('[BackgroundAudio] Media Session API not supported')
      return
    }
    
    // 设置媒体元数据
    navigator.mediaSession.metadata = new MediaMetadata({
      title: '单词学习',
      artist: 'Spelling Bee',
      album: '自动学习模式'
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
      album: 'Spelling Bee - 自动学习'
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
      // 1. 播放静音音频（触发系统媒体会话）
      if (this.audioElement) {
        await this.audioElement.play()
        //console.log('[BackgroundAudio] Silent audio playing')
      }
      
      // 2. 请求 Wake Lock（防止屏幕锁定时暂停）
      await this.requestWakeLock()
      
      // 3. 更新 Media Session 状态
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
      
      //console.log('[BackgroundAudio] Background mode started')
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
    
    // 暂停静音音频
    if (this.audioElement) {
      this.audioElement.pause()
    }
    
    // 释放 Wake Lock
    this.releaseWakeLock()
    
    // 更新 Media Session 状态
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused'
    }
    
    //console.log('[BackgroundAudio] Background mode stopped')
  }
  
  /**
   * 请求 Wake Lock（防止屏幕锁定）
   */
  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      //console.log('[BackgroundAudio] Wake Lock API not supported')
      return
    }
    
    try {
      this.wakeLock = await navigator.wakeLock.request('screen')
      
      this.wakeLock.addEventListener('release', () => {
        //console.log('[BackgroundAudio] Wake Lock released')
      })
      
      //console.log('[BackgroundAudio] Wake Lock acquired')
    } catch (e) {
      //console.log('[BackgroundAudio] Wake Lock request failed:', (e as Error).message)
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
      // 页面进入后台 - 确保音频继续播放
      //console.log('[BackgroundAudio] Page hidden, maintaining audio session')
      
      if (this.audioElement && this.audioElement.paused) {
        try {
          await this.audioElement.play()
        } catch (e) {
          console.error('[BackgroundAudio] Failed to resume audio:', e)
        }
      }
    } else {
      // 页面回到前台
      //console.log('[BackgroundAudio] Page visible')
      
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
    return 'mediaSession' in navigator
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
    
    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.src = ''
      if (this.audioElement.parentNode) {
        this.audioElement.parentNode.removeChild(this.audioElement)
      }
      this.audioElement = null
    }
  }
}

// 创建单例实例
export const backgroundAudio = new BackgroundAudioService()

export default backgroundAudio
