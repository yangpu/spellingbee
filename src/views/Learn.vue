<template>
  <div class="learn-page">
    <div class="page-header">
      <h1>单词学习</h1>
      <p>通过卡片学习单词，掌握拼写、发音和释义</p>
    </div>

    <!-- Settings -->
    <div class="settings-bar" v-if="!isLearning">
      <div class="setting-item">
        <label>学习数量</label>
        <t-input-number v-model="settings.count" :min="5" :max="50" :step="5" />
      </div>
      <div class="setting-item">
        <label>难度筛选</label>
        <t-select v-model="settings.difficulty" placeholder="全部难度" clearable style="width: 150px">
          <t-option :value="1" label="⭐ 简单" />
          <t-option :value="2" label="⭐⭐ 较易" />
          <t-option :value="3" label="⭐⭐⭐ 中等" />
          <t-option :value="4" label="⭐⭐⭐⭐ 较难" />
          <t-option :value="5" label="⭐⭐⭐⭐⭐ 困难" />
        </t-select>
      </div>
      <t-button theme="primary" size="large" @click="startLearning">
        <template #icon><t-icon name="play" /></template>
        开始学习
      </t-button>
    </div>

    <!-- Learning Card -->
    <div class="learning-container" v-if="isLearning && currentWord">
      <!-- Progress -->
      <div class="progress-bar">
        <div class="progress-info">
          <span>第 {{ currentIndex + 1 }} / {{ learnWords.length }} 个单词</span>
          <span>已掌握: {{ masteredCount }} | 复习: {{ reviewCount }}</span>
        </div>
        <t-progress :percentage="(((currentIndex + 1) / learnWords.length) * 100).toFixed(0)" theme="plump" />
      </div>

      <!-- Auto Learn Toggle -->
      <div class="auto-learn-bar">
        <t-button 
          :theme="isAutoLearning ? 'danger' : 'default'" 
          variant="outline"
          @click="toggleAutoLearn"
        >
          <template #icon><t-icon :name="isAutoLearning ? 'pause' : 'play-circle'" /></template>
          {{ isAutoLearning ? '停止自动学习' : '自动学习' }}
        </t-button>
        <span v-if="isAutoLearning" class="auto-status">自动学习中...</span>
      </div>

      <!-- Card -->
      <div class="word-card" :class="{ 'card-flipped': isFlipped }">
        <div class="card-inner">
          <!-- Front - Word only -->
          <div class="card-front">
            <div class="card-content">
              <div class="word-display" @click="speakWord">
                <span 
                  v-for="(char, i) in currentWord.word.split('')" 
                  :key="i"
                  class="word-char"
                  :class="{ 'char-highlighted': i < highlightedLetterIndex }"
                >{{ char }}</span>
                <t-button variant="text" size="small" class="speak-btn">
                  <template #icon><t-icon name="sound" size="24px" /></template>
                </t-button>
              </div>
              <div class="word-pronunciation">{{ currentWord.pronunciation }}</div>
              <p class="hint-text">点击卡片查看释义，或按空格键翻转</p>
            </div>
          </div>
          
          <!-- Back - Full info -->
          <div class="card-back">
            <div class="card-content">
              <div class="word-display-small">{{ currentWord.word }}</div>
              <div class="word-pronunciation">{{ currentWord.pronunciation }}</div>
              <div class="word-pos">
                <t-tag theme="primary" variant="light">{{ currentWord.part_of_speech }}</t-tag>
              </div>
              <div class="word-definition">{{ currentWord.definition }}</div>
              <div class="word-definition-cn" v-if="currentWord.definition_cn">
                {{ currentWord.definition_cn }}
              </div>
              <div class="word-example" v-if="currentWord.example_sentence">
                <t-icon name="chat" />
                {{ currentWord.example_sentence }}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Click overlay -->
        <div class="card-click-area" @click="flipCard"></div>
      </div>

      <!-- Actions -->
      <div class="card-actions">
        <t-button variant="outline" size="large" @click="markReview">
          <template #icon><t-icon name="refresh" /></template>
          需要复习
        </t-button>
        <t-button theme="primary" size="large" @click="markMastered">
          <template #icon><t-icon name="check" /></template>
          已掌握
        </t-button>
      </div>

      <!-- Keyboard hints -->
      <div class="keyboard-hints">
        <span><kbd>Space</kbd> 翻转卡片</span>
        <span><kbd>←</kbd> 需要复习</span>
        <span><kbd>→</kbd> 已掌握</span>
        <span><kbd>Enter</kbd> 朗读</span>
      </div>
    </div>

    <!-- Empty state -->
    <div class="empty-state" v-if="!isLearning && !wordsStore.wordCount">
      <t-icon name="folder-open" size="64px" />
      <h3>词库为空</h3>
      <p>请先添加一些单词到词库</p>
      <t-button theme="primary" @click="$router.push('/words')">
        前往词库
      </t-button>
    </div>

    <!-- Completion -->
    <div class="completion-card" v-if="isCompleted">
      <div class="completion-icon">🎉</div>
      <h2>学习完成！</h2>
      <div class="completion-stats">
        <div class="stat">
          <span class="value">{{ learnWords.length }}</span>
          <span class="label">学习单词</span>
        </div>
        <div class="stat">
          <span class="value text-success">{{ masteredCount }}</span>
          <span class="label">已掌握</span>
        </div>
        <div class="stat">
          <span class="value text-warning">{{ reviewCount }}</span>
          <span class="label">待复习</span>
        </div>
      </div>
      <div class="completion-actions">
        <t-button variant="outline" @click="continueLearning" v-if="reviewWords.length > 0">
          复习 {{ reviewWords.length }} 个单词
        </t-button>
        <t-button theme="primary" @click="startNew">
          开始新一轮
        </t-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useWordsStore } from '@/stores/words'

const wordsStore = useWordsStore()

// Settings
const settings = reactive({
  count: 10,
  difficulty: null
})

// State
const isLearning = ref(false)
const isCompleted = ref(false)
const isFlipped = ref(false)
const learnWords = ref([])
const currentIndex = ref(0)
const masteredWords = ref([])
const reviewWords = ref([])

// Auto learning state
const isAutoLearning = ref(false)
const highlightedLetterIndex = ref(0)
const autoLearnTimer = ref(null)

// Computed
const currentWord = computed(() => learnWords.value[currentIndex.value] || null)
const masteredCount = computed(() => masteredWords.value.length)
const reviewCount = computed(() => reviewWords.value.length)

// Methods
function startLearning() {
  const words = wordsStore.getRandomWords(settings.count, settings.difficulty)
  if (words.length === 0) return
  
  learnWords.value = words
  currentIndex.value = 0
  masteredWords.value = []
  reviewWords.value = []
  isLearning.value = true
  isCompleted.value = false
  isFlipped.value = false
  highlightedLetterIndex.value = 0
  
  // Auto speak word when card shows
  setTimeout(() => speakWord(), 300)
}

function flipCard() {
  isFlipped.value = !isFlipped.value
  if (isFlipped.value) {
    // Speak definition when flipping to back (Chinese first, then English)
    speakDefinition()
  }
}

function speakWord() {
  if (!currentWord.value) return
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(currentWord.value.word)
  utterance.lang = 'en-US'
  utterance.rate = 0.8
  speechSynthesis.speak(utterance)
}

// 获取最佳中文语音
function getBestChineseVoice() {
  const voices = speechSynthesis.getVoices()
  
  // 优先选择的中文语音（按优先级排序）
  const preferredVoices = [
    'Tingting',           // macOS 优质女声
    'Sinji',              // macOS 粤语
    'Meijia',             // macOS 台湾女声
    'Lili',               // macOS 女声
    'Microsoft Xiaoxiao', // Windows 优质女声
    'Microsoft Yunxi',    // Windows 男声
    'Google 普通话',       // Chrome
    'Google 中文',
  ]
  
  // 按优先级查找
  for (const preferred of preferredVoices) {
    const voice = voices.find(v => v.name.includes(preferred))
    if (voice) return voice
  }
  
  // 回退：查找任何中文语音
  const chineseVoice = voices.find(v => 
    v.lang.startsWith('zh') || 
    v.name.includes('Chinese') || 
    v.name.includes('中文')
  )
  
  return chineseVoice || null
}

function speakDefinition() {
  if (!currentWord.value) return
  speechSynthesis.cancel()
  
  // Speak Chinese definition if available, otherwise English
  if (currentWord.value.definition_cn) {
    const utterance = new SpeechSynthesisUtterance(currentWord.value.definition_cn)
    utterance.lang = 'zh-CN'
    utterance.rate = 1.0
    
    // 选择最佳中文语音
    const chineseVoice = getBestChineseVoice()
    if (chineseVoice) {
      utterance.voice = chineseVoice
    }
    
    speechSynthesis.speak(utterance)
  } else if (currentWord.value.definition) {
    const utterance = new SpeechSynthesisUtterance(currentWord.value.definition)
    utterance.lang = 'en-US'
    utterance.rate = 0.8
    speechSynthesis.speak(utterance)
  }
}

function speakDefinitionForWord(word) {
  if (!word) return
  speechSynthesis.cancel()
  
  // Speak Chinese definition if available, otherwise English
  if (word.definition_cn) {
    const utterance = new SpeechSynthesisUtterance(word.definition_cn)
    utterance.lang = 'zh-CN'
    utterance.rate = 1.0
    
    // 选择最佳中文语音
    const chineseVoice = getBestChineseVoice()
    if (chineseVoice) {
      utterance.voice = chineseVoice
    }
    
    speechSynthesis.speak(utterance)
  } else if (word.definition) {
    const utterance = new SpeechSynthesisUtterance(word.definition)
    utterance.lang = 'en-US'
    utterance.rate = 0.8
    speechSynthesis.speak(utterance)
  }
}

function speakLetters(word, onComplete) {
  if (!word || !isAutoLearning.value) {
    if (onComplete) onComplete()
    return
  }
  
  const letters = word.split('')
  let index = 0
  highlightedLetterIndex.value = 0
  
  function speakNextLetter() {
    if (!isAutoLearning.value) return
    
    if (index >= letters.length) {
      if (onComplete) onComplete()
      return
    }
    
    // 先高亮当前字母
    highlightedLetterIndex.value = index + 1
    
    // 延迟一小段时间后再朗读，让用户看到高亮
    autoLearnTimer.value = setTimeout(() => {
      if (!isAutoLearning.value) return
      
      const letter = letters[index]
      const utterance = new SpeechSynthesisUtterance(letter)
      utterance.lang = 'en-US'
      utterance.rate = 0.7
      
      utterance.onend = () => {
        if (!isAutoLearning.value) return
        index++
        autoLearnTimer.value = setTimeout(speakNextLetter, 200)
      }
      
      utterance.onerror = () => {
        // 出错时继续下一个字母
        if (!isAutoLearning.value) return
        index++
        autoLearnTimer.value = setTimeout(speakNextLetter, 200)
      }
      
      speechSynthesis.speak(utterance)
    }, 150)
  }
  
  speakNextLetter()
}

function markMastered() {
  if (!currentWord.value) return
  stopAutoLearn()
  masteredWords.value.push(currentWord.value)
  nextWord()
}

function markReview() {
  if (!currentWord.value) return
  stopAutoLearn()
  reviewWords.value.push(currentWord.value)
  nextWord()
}

function nextWord() {
  if (currentIndex.value < learnWords.value.length - 1) {
    const wasAutoLearning = isAutoLearning.value
    currentIndex.value++
    isFlipped.value = false
    highlightedLetterIndex.value = 0
    
    // 使用 nextTick 确保 currentWord 已更新
    if (wasAutoLearning) {
      // 自动学习模式：延迟启动下一轮循环
      autoLearnTimer.value = setTimeout(() => {
        if (isAutoLearning.value && currentWord.value) {
          startAutoLearnCycle()
        }
      }, 500)
    } else {
      // 手动模式：自动朗读新单词
      setTimeout(() => speakWord(), 300)
    }
  } else {
    isCompleted.value = true
    isLearning.value = false
    isAutoLearning.value = false
  }
}

function continueLearning() {
  learnWords.value = [...reviewWords.value]
  currentIndex.value = 0
  masteredWords.value = []
  reviewWords.value = []
  isLearning.value = true
  isCompleted.value = false
  isFlipped.value = false
  highlightedLetterIndex.value = 0
  
  setTimeout(() => speakWord(), 300)
}

function startNew() {
  isCompleted.value = false
  startLearning()
}

// Auto Learning Functions
function toggleAutoLearn() {
  if (isAutoLearning.value) {
    stopAutoLearn()
  } else {
    startAutoLearn()
  }
}

function startAutoLearn() {
  isAutoLearning.value = true
  startAutoLearnCycle()
}

function stopAutoLearn() {
  isAutoLearning.value = false
  if (autoLearnTimer.value) {
    clearTimeout(autoLearnTimer.value)
    autoLearnTimer.value = null
  }
  speechSynthesis.cancel()
}

function startAutoLearnCycle() {
  if (!isAutoLearning.value || !currentWord.value) return
  
  // 清除之前的定时器
  if (autoLearnTimer.value) {
    clearTimeout(autoLearnTimer.value)
    autoLearnTimer.value = null
  }
  
  // 保存当前单词引用，防止异步过程中单词变化
  const wordToLearn = currentWord.value
  
  // Step 1: Speak the word
  speechSynthesis.cancel()
  
  // 等待 cancel 生效
  autoLearnTimer.value = setTimeout(() => {
    if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
    
    const wordUtterance = new SpeechSynthesisUtterance(wordToLearn.word)
    wordUtterance.lang = 'en-US'
    wordUtterance.rate = 0.7
    
    wordUtterance.onend = () => {
      if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
      
      // Step 2: Spell out letters with highlighting
      autoLearnTimer.value = setTimeout(() => {
        if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
        
        speakLetters(wordToLearn.word, () => {
          if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
          
          // Step 3: Flip card
          autoLearnTimer.value = setTimeout(() => {
            if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
            isFlipped.value = true
            
            // Step 3.5: Speak definition after flip
            autoLearnTimer.value = setTimeout(() => {
              if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
              speakDefinitionForWord(wordToLearn)
            }, 300)
            
            // Step 4: Wait and move to next word
            autoLearnTimer.value = setTimeout(() => {
              if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
              masteredWords.value.push(wordToLearn)
              nextWord()
            }, 3000)
          }, 500)
        })
      }, 500)
    }
    
    wordUtterance.onerror = () => {
      // 语音出错时，跳过朗读直接进入拼读
      if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
      
      autoLearnTimer.value = setTimeout(() => {
        if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
        
        speakLetters(wordToLearn.word, () => {
          if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
          
          autoLearnTimer.value = setTimeout(() => {
            if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
            isFlipped.value = true
            
            // Speak definition after flip
            autoLearnTimer.value = setTimeout(() => {
              if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
              speakDefinitionForWord(wordToLearn)
            }, 300)
            
            autoLearnTimer.value = setTimeout(() => {
              if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
              masteredWords.value.push(wordToLearn)
              nextWord()
            }, 3000)
          }, 500)
        })
      }, 500)
    }
    
    speechSynthesis.speak(wordUtterance)
  }, 100)
}

// Keyboard shortcuts
function handleKeydown(e) {
  if (!isLearning.value) return
  
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      flipCard()
      break
    case 'ArrowLeft':
      markReview()
      break
    case 'ArrowRight':
      markMastered()
      break
    case 'Enter':
      speakWord()
      break
  }
}

// Watch for word changes to auto-speak
watch(currentWord, (newWord) => {
  if (newWord && isLearning.value && !isAutoLearning.value) {
    highlightedLetterIndex.value = 0
  }
})

onMounted(() => {
  wordsStore.init()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  stopAutoLearn()
  speechSynthesis.cancel()
})
</script>

<style lang="scss" scoped>
.learn-page {
  max-width: 800px;
  margin: 0 auto;

  .page-header {
    text-align: center;
    margin-bottom: 2rem;

    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    p {
      color: var(--text-secondary);
    }
  }

  .settings-bar {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 2rem;
    flex-wrap: wrap;
    padding: 2rem;
    background: var(--bg-card);
    border-radius: 16px;
    margin-bottom: 2rem;

    .setting-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      label {
        font-weight: 500;
        color: var(--text-secondary);
        font-size: 0.9rem;
      }
    }
  }

  .learning-container {
    .progress-bar {
      margin-bottom: 1rem;

      .progress-info {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
        font-size: 0.9rem;
        color: var(--text-secondary);
      }
    }

    .auto-learn-bar {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
      justify-content: center;

      .auto-status {
        color: var(--honey-600);
        font-weight: 500;
        animation: pulse 1.5s ease-in-out infinite;
      }
    }
  }

  .word-card {
    perspective: 1000px;
    margin-bottom: 2rem;
    position: relative;
    height: 400px;

    .card-inner {
      position: relative;
      width: 100%;
      height: 100%;
      transition: transform 0.6s;
      transform-style: preserve-3d;
    }

    &.card-flipped .card-inner {
      transform: rotateY(180deg);
    }

    .card-front,
    .card-back {
      position: absolute;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      border-radius: 24px;
      background: var(--bg-card);
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card-back {
      transform: rotateY(180deg);
    }

    .card-content {
      text-align: center;
      padding: 2rem;
    }

    .card-click-area {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      cursor: pointer;
      z-index: 10;
    }

    .word-display {
      font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
      font-size: 4rem;
      font-weight: 700;
      color: var(--charcoal-900);
      margin-bottom: 1rem;
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.1rem;

      .word-char {
        transition: color 0.3s ease;
        
        &.char-highlighted {
          color: var(--success);
        }
      }

      .speak-btn {
        opacity: 0.5;
        transition: opacity 0.2s;
        margin-left: 0.5rem;

        &:hover {
          opacity: 1;
        }
      }
    }

    .word-display-small {
      font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--charcoal-900);
      margin-bottom: 0.5rem;
    }

    .word-pronunciation {
      font-size: 1.25rem;
      color: var(--honey-600);
      margin-bottom: 1rem;
    }

    .word-pos {
      margin-bottom: 1rem;
    }

    .word-definition {
      font-size: 1.25rem;
      color: var(--charcoal-700);
      line-height: 1.6;
      margin-bottom: 0.5rem;
    }

    .word-definition-cn {
      font-size: 1.1rem;
      color: var(--charcoal-600);
      margin-bottom: 1rem;
    }

    .word-example {
      font-size: 1rem;
      color: var(--charcoal-500);
      font-style: italic;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      justify-content: center;
    }

    .hint-text {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 2rem;
    }
  }

  .card-actions {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .keyboard-hints {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: 0.85rem;

    kbd {
      padding: 0.2rem 0.5rem;
      background: var(--charcoal-100);
      border-radius: 4px;
      font-family: monospace;
    }
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-secondary);

    h3 {
      margin: 1rem 0 0.5rem;
    }

    p {
      margin-bottom: 1.5rem;
    }
  }

  .completion-card {
    text-align: center;
    padding: 3rem;
    background: var(--bg-card);
    border-radius: 24px;
    box-shadow: var(--shadow-lg);

    .completion-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }

    h2 {
      margin-bottom: 2rem;
    }

    .completion-stats {
      display: flex;
      justify-content: center;
      gap: 3rem;
      margin-bottom: 2rem;

      .stat {
        display: flex;
        flex-direction: column;

        .value {
          font-size: 2.5rem;
          font-weight: 700;
          font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;

          &.text-success { color: var(--success); }
          &.text-warning { color: var(--warning); }
        }

        .label {
          color: var(--text-secondary);
        }
      }
    }

    .completion-actions {
      display: flex;
      justify-content: center;
      gap: 1rem;
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (max-width: 768px) {
  .learn-page {
    .word-card {
      height: 350px;

      .word-display {
        font-size: 2.5rem;
      }

      .word-display-small {
        font-size: 2rem;
      }
    }

    .keyboard-hints {
      display: none;
    }

    .completion-card .completion-stats {
      gap: 1.5rem;

      .stat .value {
        font-size: 2rem;
      }
    }
  }
}
</style>
