/**
 * 检测浏览器是否允许自动播放语音
 * @returns Promise<boolean> - true 表示允许，false 表示不允许
 */
export async function checkSpeechPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const utterance = new SpeechSynthesisUtterance('')
      utterance.volume = 0
      utterance.rate = 10 // 最快速度
      
      let resolved = false
      
      utterance.onstart = () => {
        if (!resolved) {
          resolved = true
          speechSynthesis.cancel()
          resolve(true)
        }
      }
      
      utterance.onerror = (event) => {
        if (!resolved) {
          resolved = true
          // not-allowed 表示需要用户交互
          resolve(event.error !== 'not-allowed')
        }
      }
      
      utterance.onend = () => {
        if (!resolved) {
          resolved = true
          resolve(true)
        }
      }
      
      speechSynthesis.speak(utterance)
      
      // 超时处理
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          speechSynthesis.cancel()
          resolve(true) // 超时默认允许
        }
      }, 500)
    } catch (e) {
      resolve(false)
    }
  })
}
