<template>
  <div class="learn-page">
    <div class="page-header">
      <h1>单词学习</h1>
      <p>通过卡片学习单词，掌握拼写、发音和释义</p>
      <div class="header-actions">
        <t-button variant="outline" @click="showSpeechSettings = true" class="speech-btn">
          <template #icon><t-icon name="sound" /></template>
          语音配置
        </t-button>
        <t-button variant="outline" @click="$router.push('/learn/manager')" class="manager-btn">
          <template #icon><t-icon name="chart-bar" /></template>
          学习管理
        </t-button>
      </div>
    </div>

    <!-- Settings -->
    <div class="settings-bar" v-if="!isLearning">
      <!-- 恢复未完成学习提示 -->
      <div class="resume-banner" v-if="learningStore.hasUnfinishedSession">
        <div class="resume-info">
          <t-icon name="history" />
          <span>您有一次未完成的学习</span>
        </div>
        <div class="resume-actions">
          <t-button size="small" variant="outline" @click="learningStore.clearSession()">
            放弃
          </t-button>
          <t-button size="small" theme="primary" @click="resumeLearning">
            继续学习
          </t-button>
        </div>
      </div>
      
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
      <div class="setting-item">
        <label>学习模式</label>
        <t-select v-model="settings.mode" style="width: 150px">
          <t-option value="natural" label="自然" />
          <t-option value="sequential" label="顺序" />
          <t-option value="reverse" label="倒序" />
          <t-option value="random" label="随机" />
          <t-option value="review" label="备考" />
        </t-select>
      </div>
      <div class="setting-hint mode-hint">{{ learningModeHint }}</div>
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
        <t-progress :percentage="Math.round(((currentIndex + 1) / learnWords.length) * 100)" theme="plump" />
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
        <t-button variant="outline" theme="default" @click="exitLearning" class="exit-btn">
          <template #icon><t-icon name="close" /></template>
          退出
        </t-button>
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
          已经掌握
        </t-button>
      </div>

      <!-- Keyboard hints -->
      <div class="keyboard-hints">
        <span><kbd>Space</kbd> 翻转卡片</span>
        <span><kbd>←</kbd> 需要复习</span>
        <span><kbd>→</kbd> 已经掌握</span>
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

    <!-- 语音配置弹窗 -->
    <SpeechSettings v-model="showSpeechSettings" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useWordsStore } from '@/stores/words'
import { useLearningStore } from '@/stores/learning'
import { useSpeechStore } from '@/stores/speech'
import SpeechSettings from '@/components/SpeechSettings.vue'

const wordsStore = useWordsStore()
const learningStore = useLearningStore()
const speechStore = useSpeechStore()

// 语音配置弹窗
const showSpeechSettings = ref(false)

// Settings
const settings = reactive({
  count: 10,
  difficulty: null,
  mode: 'natural', // natural, sequential, reverse, random, review
  autoLearn: false // 自动学习模式
})

// 设置存储键
const SETTINGS_KEY = 'spellingbee_learn_settings'

// 加载保存的设置
function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      Object.assign(settings, parsed)
    }
  } catch (e) {
    console.error('Error loading learn settings:', e)
  }
}

// 保存设置
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      count: settings.count,
      difficulty: settings.difficulty,
      mode: settings.mode,
      autoLearn: settings.autoLearn
    }))
  } catch (e) {
    console.error('Error saving learn settings:', e)
  }
}

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

// Card flip state - track definition reading alternation
const flipCount = ref(0) // 0: first flip (Chinese), 1: second flip (English), etc.

// Computed
const currentWord = computed(() => learnWords.value[currentIndex.value] || null)
const masteredCount = computed(() => masteredWords.value.length)
const reviewCount = computed(() => reviewWords.value.length)

// 学习模式提示
const learningModeHint = computed(() => {
  switch (settings.mode) {
    case 'natural':
      return '按最佳记忆曲线设置学习单词列表'
    case 'sequential':
      return '按当前词库顺序进行学习'
    case 'reverse':
      return '按当前词库倒序进行学习'
    case 'random':
      return '随机选取单词进行学习'
    case 'review':
      return '结合比赛记录，重点复习容易出错的单词'
    default:
      return ''
  }
})

// Methods
function startLearning() {
  // 保存设置
  saveSettings()
  
  let words = []
  
  // 根据学习模式获取单词
  switch (settings.mode) {
    case 'natural':
      words = getWordsNaturalMode(settings.count, settings.difficulty)
      break
    case 'sequential':
      words = getWordsSequentialMode(settings.count, settings.difficulty)
      break
    case 'reverse':
      words = getWordsReverseMode(settings.count, settings.difficulty)
      break
    case 'random':
      words = wordsStore.getRandomWords(settings.count, settings.difficulty)
      break
    case 'review':
      words = getWordsReviewMode(settings.count, settings.difficulty)
      break
    default:
      words = wordsStore.getRandomWords(settings.count, settings.difficulty)
  }
  
  if (words.length === 0) return
  
  learnWords.value = words
  currentIndex.value = 0
  masteredWords.value = []
  reviewWords.value = []
  isLearning.value = true
  isCompleted.value = false
  isFlipped.value = false
  highlightedLetterIndex.value = 0
  flipCount.value = 0 // Reset flip count
  
  // 保存学习会话
  saveCurrentSession()
  
  // 根据设置决定是否开启自动学习
  setTimeout(() => {
    if (settings.autoLearn) {
      startAutoLearn()
    } else {
      speakWord()
    }
  }, 300)
}

// 自然模式：按最佳记忆曲线
function getWordsNaturalMode(count, difficulty) {
  let filtered = [...wordsStore.words]
  
  if (difficulty !== null) {
    filtered = filtered.filter(w => w.difficulty === difficulty)
  }
  
  if (filtered.length === 0) return []
  
  // 优先选择：1. 需要复习的单词 2. 未学过的单词 3. 已掌握但需巩固的单词
  const needReview = []
  const notLearned = []
  const mastered = []
  
  filtered.forEach(word => {
    const progress = learningStore.getWordProgress(word.word)
    if (!progress) {
      notLearned.push(word)
    } else if (progress.mastery_level < 2) {
      needReview.push(word)
    } else {
      mastered.push(word)
    }
  })
  
  // 按优先级组合
  const result = []
  
  // 先添加需要复习的
  const shuffledReview = shuffleArray([...needReview])
  result.push(...shuffledReview.slice(0, Math.ceil(count * 0.4)))
  
  // 再添加未学过的
  const shuffledNew = shuffleArray([...notLearned])
  result.push(...shuffledNew.slice(0, Math.ceil(count * 0.4)))
  
  // 最后补充已掌握的
  if (result.length < count) {
    const shuffledMastered = shuffleArray([...mastered])
    result.push(...shuffledMastered.slice(0, count - result.length))
  }
  
  return result.slice(0, count)
}

// 顺序模式
function getWordsSequentialMode(count, difficulty) {
  let filtered = [...wordsStore.words]
  
  if (difficulty !== null) {
    filtered = filtered.filter(w => w.difficulty === difficulty)
  }
  
  if (filtered.length === 0) return []
  
  // 获取上次位置
  const storageKey = `spellingbee_learn_sequential_pos_${difficulty || 'all'}`
  let startPos = parseInt(localStorage.getItem(storageKey) || '0', 10)
  
  if (startPos >= filtered.length) {
    startPos = 0
  }
  
  const result = []
  for (let i = 0; i < count && i < filtered.length; i++) {
    const idx = (startPos + i) % filtered.length
    result.push(filtered[idx])
  }
  
  // 保存下次位置
  const nextPos = (startPos + count) % filtered.length
  localStorage.setItem(storageKey, nextPos.toString())
  
  return result
}

// 倒序模式
function getWordsReverseMode(count, difficulty) {
  let filtered = [...wordsStore.words].reverse()
  
  if (difficulty !== null) {
    filtered = filtered.filter(w => w.difficulty === difficulty)
  }
  
  if (filtered.length === 0) return []
  
  // 获取上次位置
  const storageKey = `spellingbee_learn_reverse_pos_${difficulty || 'all'}`
  let startPos = parseInt(localStorage.getItem(storageKey) || '0', 10)
  
  if (startPos >= filtered.length) {
    startPos = 0
  }
  
  const result = []
  for (let i = 0; i < count && i < filtered.length; i++) {
    const idx = (startPos + i) % filtered.length
    result.push(filtered[idx])
  }
  
  // 保存下次位置
  const nextPos = (startPos + count) % filtered.length
  localStorage.setItem(storageKey, nextPos.toString())
  
  return result
}

// 备考模式：重点复习容易出错的单词
function getWordsReviewMode(count, difficulty) {
  let filtered = [...wordsStore.words]
  
  if (difficulty !== null) {
    filtered = filtered.filter(w => w.difficulty === difficulty)
  }
  
  if (filtered.length === 0) return []
  
  // 获取比赛中出错的单词
  const competitionStore = useCompetitionStore()
  const errorWords = new Map() // word -> error count
  
  competitionStore.records.forEach(record => {
    if (record.incorrect_words) {
      record.incorrect_words.forEach(word => {
        const lower = word.toLowerCase()
        errorWords.set(lower, (errorWords.get(lower) || 0) + 1)
      })
    }
  })
  
  // 按错误次数排序
  const sortedWords = filtered.sort((a, b) => {
    const aErrors = errorWords.get(a.word.toLowerCase()) || 0
    const bErrors = errorWords.get(b.word.toLowerCase()) || 0
    return bErrors - aErrors // 错误多的排前面
  })
  
  // 优先选择出错过的单词
  const result = []
  const errorWordsList = sortedWords.filter(w => errorWords.has(w.word.toLowerCase()))
  const otherWords = sortedWords.filter(w => !errorWords.has(w.word.toLowerCase()))
  
  result.push(...errorWordsList.slice(0, Math.ceil(count * 0.7)))
  
  if (result.length < count) {
    const shuffledOther = shuffleArray([...otherWords])
    result.push(...shuffledOther.slice(0, count - result.length))
  }
  
  return result.slice(0, count)
}

// 辅助函数：打乱数组
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 保存当前学习会话
function saveCurrentSession() {
  learningStore.saveSession({
    learnWords: learnWords.value,
    currentIndex: currentIndex.value,
    masteredWords: masteredWords.value,
    reviewWords: reviewWords.value,
    isFlipped: isFlipped.value,
    flipCount: flipCount.value,
    isAutoLearning: isAutoLearning.value // 保存自动学习状态
  })
}

// 恢复学习
function resumeLearning() {
  const session = learningStore.restoreSession()
  if (!session || !session.learnWords || session.learnWords.length === 0) {
    // 会话无效，清除
    learningStore.clearSession()
    return
  }
  
  learnWords.value = session.learnWords
  currentIndex.value = session.currentIndex
  masteredWords.value = session.masteredWords || []
  reviewWords.value = session.reviewWords || []
  isFlipped.value = session.isFlipped || false
  flipCount.value = session.flipCount || 0
  isLearning.value = true
  isCompleted.value = false
  highlightedLetterIndex.value = 0
  
  // 根据设置决定是否开启自动学习
  setTimeout(() => {
    if (settings.autoLearn) {
      startAutoLearn()
    } else {
      speakWord()
    }
  }, 300)
}

function flipCard() {
  isFlipped.value = !isFlipped.value
  if (isFlipped.value) {
    // Flipping to back (definition side)
    // Alternate between Chinese and English definition
    if (flipCount.value % 2 === 0) {
      // Even flip count: speak Chinese definition
      speakChineseDefinition()
    } else {
      // Odd flip count: speak English definition
      speakEnglishDefinition()
    }
    flipCount.value++
  } else {
    // Flipping to front (word side) - always speak the word
    speakWord()
  }
}

function speakWord() {
  if (!currentWord.value) return
  speechStore.speakWord(currentWord.value.word)
}

// 朗读中文释义
function speakChineseDefinition() {
  if (!currentWord.value) return
  
  if (currentWord.value.definition_cn) {
    speechStore.speakChinese(currentWord.value.definition_cn)
  } else {
    // 没有中文释义时朗读英文
    speakEnglishDefinition()
  }
}

// 朗读英文释义
function speakEnglishDefinition() {
  if (!currentWord.value) return
  
  if (currentWord.value.definition) {
    speechStore.speakEnglish(currentWord.value.definition, { rate: 0.85 })
  }
}

function speakDefinitionForWord(word) {
  if (!word) return
  
  // Speak Chinese definition if available, otherwise English
  if (word.definition_cn) {
    speechStore.speakChinese(word.definition_cn)
  } else if (word.definition) {
    speechStore.speakEnglish(word.definition, { rate: 0.8 })
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
      
      // 使用 speechStore 朗读字母
      speechStore.speakLetter(letter).then(() => {
        if (!isAutoLearning.value) return
        index++
        autoLearnTimer.value = setTimeout(speakNextLetter, 120)
      }).catch(() => {
        // 出错时继续下一个字母
        if (!isAutoLearning.value) return
        index++
        autoLearnTimer.value = setTimeout(speakNextLetter, 120)
      })
    }, 100)
  }
  
  speakNextLetter()
}

function markMastered() {
  if (!currentWord.value) return
  stopAutoLearn()
  masteredWords.value.push(currentWord.value)
  // Record learning progress
  learningStore.recordLearning(currentWord.value.word, true, '', 'learn')
  // 保存会话
  saveCurrentSession()
  nextWord()
}

function markReview() {
  if (!currentWord.value) return
  stopAutoLearn()
  reviewWords.value.push(currentWord.value)
  // Record as needs review (not mastered yet)
  learningStore.recordLearning(currentWord.value.word, false, '', 'learn')
  // 保存会话
  saveCurrentSession()
  nextWord()
}

function nextWord() {
  if (currentIndex.value < learnWords.value.length - 1) {
    const wasAutoLearning = isAutoLearning.value
    currentIndex.value++
    isFlipped.value = false
    highlightedLetterIndex.value = 0
    flipCount.value = 0 // Reset flip count for new word
    
    // 保存会话
    saveCurrentSession()
    
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
    // 学习完成，清除会话
    learningStore.clearSession()
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
  flipCount.value = 0 // Reset flip count
  
  setTimeout(() => speakWord(), 300)
}

function startNew() {
  isCompleted.value = false
  startLearning()
}

// 退出学习
function exitLearning() {
  stopAutoLearn()
  speechSynthesis.cancel()
  isLearning.value = false
  isCompleted.value = false
  isFlipped.value = false
  highlightedLetterIndex.value = 0
  // 保存当前会话以便恢复
  if (currentIndex.value < learnWords.value.length) {
    saveCurrentSession()
  }
}

// Auto Learning Functions
function toggleAutoLearn() {
  if (isAutoLearning.value) {
    stopAutoLearn()
    settings.autoLearn = false
  } else {
    startAutoLearn()
    settings.autoLearn = true
  }
  // 保存设置
  saveSettings()
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
    
    // 使用 speechStore 朗读单词
    speechStore.speakWord(wordToLearn.word).then(() => {
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
          }, 400)
        })
      }, 400)
    }).catch(() => {
      // 语音出错时，跳过朗读直接进入拼读
      if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
      
      autoLearnTimer.value = setTimeout(() => {
        if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
        
        speakLetters(wordToLearn.word, () => {
          if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
          
          autoLearnTimer.value = setTimeout(() => {
            if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
            isFlipped.value = true
            
            autoLearnTimer.value = setTimeout(() => {
              if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
              speakDefinitionForWord(wordToLearn)
            }, 300)
            
            autoLearnTimer.value = setTimeout(() => {
              if (!isAutoLearning.value || currentWord.value !== wordToLearn) return
              masteredWords.value.push(wordToLearn)
              nextWord()
            }, 3000)
          }, 400)
        })
      }, 400)
    })
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

onMounted(async () => {
  wordsStore.init()
  await learningStore.init()
  speechStore.init() // 初始化语音配置
  loadSettings() // 加载保存的设置
  window.addEventListener('keydown', handleKeydown)
  
  // 自动恢复未完成的学习
  if (learningStore.hasUnfinishedSession) {
    resumeLearning()
  }
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
    position: relative;

    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    p {
      color: var(--text-secondary);
    }

    .header-actions {
      position: absolute;
      right: 0;
      top: 0;
      display: flex;
      gap: 0.5rem;
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

    .resume-banner {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
      background: linear-gradient(135deg, var(--honey-50) 0%, var(--honey-100) 100%);
      border: 1px solid var(--honey-300);
      border-radius: 12px;
      margin-bottom: 0.5rem;

      .resume-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--honey-700);
        font-weight: 500;

        .t-icon {
          font-size: 1.25rem;
        }
      }

      .resume-actions {
        display: flex;
        gap: 0.5rem;
      }
    }

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

    .setting-hint {
      color: var(--text-secondary);
      font-size: 0.85rem;
    }

    .mode-hint {
      width: 100%;
      text-align: center;
      padding: 0.5rem;
      background: var(--hover-bg);
      border-radius: 8px;
      margin-top: -0.5rem;
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

      .exit-btn {
        margin-left: auto;
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
    .page-header {
      .header-actions {
        position: static;
        margin-top: 1rem;
        justify-content: center;
      }
    }

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
