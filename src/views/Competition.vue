<template>
  <div class="competition-page">
    <!-- Pre-competition setup -->
    <div
      class="setup-container"
      v-if="!competitionStore.isActive && !showResults"
    >
      <div class="setup-card">
        <div class="setup-header">
          <img :src="`${baseUrl}bee.svg`" alt="Bee" class="setup-icon" />
          <h1>Spelling Bee 比赛</h1>
          <p>模拟真实比赛场景，挑战你的拼写能力</p>
        </div>

        <div class="setup-form">
          <div class="form-group">
            <label>单词数量</label>
            <t-slider
              v-model="settings.wordCount"
              :min="5"
              :max="30"
              :step="5"
              :marks="wordCountMarks"
            />
          </div>
          <div class="form-group">
            <label>答题时间（秒）</label>
            <t-slider
              v-model="settings.timeLimit"
              :min="30"
              :max="120"
              :step="15"
              :marks="timeLimitMarks"
            />
          </div>
          <div class="form-group">
            <label>难度选择</label>
            <t-radio-group
              v-model="settings.difficulty"
              variant="default-filled"
            >
              <t-radio-button :value="null">全部</t-radio-button>
              <t-radio-button :value="1">简单</t-radio-button>
              <t-radio-button :value="2">较易</t-radio-button>
              <t-radio-button :value="3">中等</t-radio-button>
              <t-radio-button :value="4">较难</t-radio-button>
              <t-radio-button :value="5">困难</t-radio-button>
            </t-radio-group>
          </div>
          <div class="form-group">
            <label>语音输入</label>
            <t-switch v-model="settings.voiceInput" />
            <span class="setting-hint">开启后可通过语音拼读单词</span>
          </div>
        </div>

        <div class="setup-rules">
          <h3>比赛规则</h3>
          <ul>
            <li>发音官会朗读单词，你需要正确拼写每个字母</li>
            <li>每个单词有 {{ settings.timeLimit }} 秒答题时间</li>
            <li>可以点击按钮询问发音、释义、词性和例句</li>
            <li>直接在字母框中输入，正确显示绿色，错误显示红色</li>
            <li>开启语音输入后，先朗读单词，再逐个拼读字母</li>
          </ul>
        </div>

        <t-button theme="primary" size="large" block @click="startCompetition">
          <template #icon><t-icon name="play-circle" /></template>
          开始比赛
        </t-button>
      </div>
    </div>

    <!-- Competition in progress -->
    <div class="competition-container" v-if="competitionStore.isActive">
      <!-- Header -->
      <div class="competition-header">
        <div class="score-display">
          <t-icon name="star" />
          <span>{{ competitionStore.score }}</span>
        </div>
        <div class="progress-display">
          {{ competitionStore.progress.current }} /
          {{ competitionStore.progress.total }}
        </div>
        <div class="timer-display" :class="timerClass">
          <t-icon name="time" />
          <span>{{ competitionStore.timeRemaining }}s</span>
        </div>
      </div>

      <!-- Announcer -->
      <div class="announcer-section">
        <div class="announcer-avatar">
          <img :src="`${baseUrl}bee.svg`" alt="Announcer" />
        </div>
        <div class="announcer-bubble">
          <p class="announcer-text">{{ announcerMessage }}</p>
        </div>
      </div>

      <!-- Word display with letter inputs -->
      <div class="word-section">
        <div class="word-badge">
          <t-tag theme="warning" variant="light">
            难度: {{ '⭐'.repeat(currentWord?.difficulty || 1) }}
          </t-tag>
        </div>
        
        <!-- Letter input boxes -->
        <div class="word-mystery">
          <div 
            v-for="(slot, i) in letterSlots" 
            :key="i" 
            class="letter-slot"
            :class="{
              'slot-correct': slot.status === 'correct',
              'slot-wrong': slot.status === 'wrong',
              'slot-active': i === currentLetterIndex,
              'slot-filled': slot.value
            }"
            @click="focusLetterInput(i)"
          >
            <input
              :ref="el => letterInputRefs[i] = el"
              type="text"
              maxlength="1"
              class="letter-input"
              :value="slot.value"
              @input="handleLetterInput($event, i)"
              @keydown="handleLetterKeydown($event, i)"
              @compositionstart="handleCompositionStart"
              @compositionend="handleCompositionEnd($event, i)"
              @focus="handleInputFocus($event, i)"
              @beforeinput="handleBeforeInput"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              enterkeyhint="next"
              inputmode="text"
              x-webkit-speech
            />
            <span class="letter-hint" v-if="i === 0 && !slot.value">{{ currentWord?.word[0]?.toUpperCase() }}</span>
          </div>
        </div>

        <!-- Voice input toggle and status -->
        <div class="voice-status">
          <div class="voice-toggle">
            <span>语音输入</span>
            <t-switch v-model="settings.voiceInput" @change="handleVoiceToggle" :disabled="voiceNotSupported" />
          </div>
          <template v-if="voiceNotSupported">
            <div class="voice-not-supported">
              <t-icon name="error-circle" />
              <span>当前环境不支持语音识别</span>
              <t-button size="small" theme="primary" @click="openInSystemBrowser">
                在浏览器中打开
              </t-button>
            </div>
          </template>
          <template v-else-if="settings.voiceInput">
            <div class="voice-indicator" :class="{ 'voice-active': isListening, 'voice-spelling': voicePhase === 'spelling' }">
              <t-icon :name="isListening ? 'sound' : 'microphone'" />
              <span>{{ voiceStatusText }}</span>
              <span v-if="similarityScore !== null" class="similarity-badge" :class="getSimilarityClass(similarityScore)">
                {{ similarityScore }}%
              </span>
            </div>
          </template>
        </div>
      </div>

      <!-- Question buttons -->
      <div class="question-buttons">
        <t-button
          variant="outline"
          @click="askQuestion('pronunciation')"
          :disabled="askedQuestions.pronunciation"
        >
          <template #icon><t-icon name="sound" /></template>
          发音
        </t-button>
        <t-button
          variant="outline"
          @click="askQuestion('definition')"
          :disabled="askedQuestions.definition"
        >
          <template #icon><t-icon name="book" /></template>
          释义
        </t-button>
        <t-button
          variant="outline"
          @click="askQuestion('partOfSpeech')"
          :disabled="askedQuestions.partOfSpeech"
        >
          <template #icon><t-icon name="layers" /></template>
          词性
        </t-button>
        <t-button
          variant="outline"
          @click="askQuestion('example')"
          :disabled="askedQuestions.example"
        >
          <template #icon><t-icon name="chat" /></template>
          例句
        </t-button>
        <t-button variant="outline" @click="repeatWord">
          <template #icon><t-icon name="refresh" /></template>
          重复
        </t-button>
      </div>

      <!-- Action buttons -->
      <div class="answer-section">
        <div class="action-buttons">
          <t-button variant="outline" size="large" theme="danger" @click="exitCompetition">
            退出比赛
          </t-button>
          <t-button variant="outline" size="large" @click="skipWord">
            跳过
          </t-button>
          <t-button
            theme="primary"
            size="large"
            @click="submitAnswer"
            :disabled="!isAllLettersFilled"
          >
            提交答案
          </t-button>
        </div>
      </div>

      <!-- Keyboard hint -->
      <div class="keyboard-hint">
        直接输入字母，按 <kbd>Backspace</kbd> 删除，<kbd>Enter</kbd> 提交
      </div>
    </div>

    <!-- Results -->
    <div class="results-container" v-if="showResults && lastResult">
      <div class="results-card">
        <div class="results-header">
          <div class="results-icon">{{ resultEmoji }}</div>
          <h1>比赛结束</h1>
        </div>

        <div class="results-score">
          <div class="score-circle">
            <span class="score-value">{{ lastResult.score }}</span>
            <span class="score-label">总分</span>
          </div>
        </div>

        <div class="results-stats">
          <div class="stat-item">
            <t-icon name="check-circle" class="text-success" />
            <span class="stat-value">{{ lastResult.correct_words }}</span>
            <span class="stat-label">正确</span>
          </div>
          <div class="stat-item">
            <t-icon name="close-circle" class="text-error" />
            <span class="stat-value">{{
              lastResult.total_words - lastResult.correct_words
            }}</span>
            <span class="stat-label">错误</span>
          </div>
          <div class="stat-item">
            <t-icon name="chart-pie" />
            <span class="stat-value">{{ lastResult.accuracy }}%</span>
            <span class="stat-label">正确率</span>
          </div>
          <div class="stat-item">
            <t-icon name="time" />
            <span class="stat-value">{{
              formatDuration(lastResult.duration)
            }}</span>
            <span class="stat-label">用时</span>
          </div>
        </div>

        <!-- Incorrect words review -->
        <div
          class="incorrect-words"
          v-if="competitionStore.incorrectWords.length > 0"
        >
          <h3>需要复习的单词</h3>
          <div class="word-list">
            <div
              class="word-item"
              v-for="item in competitionStore.incorrectWords"
              :key="item.id"
            >
              <div class="word-main">
                <span class="correct-word">{{ item.word }}</span>
                <t-button
                  variant="text"
                  size="small"
                  @click="speakWord(item.word)"
                >
                  <t-icon name="sound" />
                </t-button>
              </div>
              <div
                class="word-user"
                v-if="
                  item.userAnswer !== '[超时]' && item.userAnswer !== '[跳过]'
                "
              >
                你的答案: <span class="wrong">{{ item.userAnswer }}</span>
              </div>
              <div class="word-user" v-else>
                <span class="skip">{{ item.userAnswer }}</span>
              </div>
              <div class="word-def">{{ item.definition }}</div>
              <div class="word-def-cn" v-if="item.definition_cn">{{ item.definition_cn }}</div>
            </div>
          </div>
        </div>

        <div class="results-actions">
          <t-button
            variant="outline"
            size="large"
            @click="$router.push('/stats')"
          >
            查看历史
          </t-button>
          <t-button theme="primary" size="large" @click="restartCompetition">
            再来一局
          </t-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ref,
  reactive,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
} from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { useWordsStore } from '@/stores/words';
import { useCompetitionStore } from '@/stores/competition';

const baseUrl = import.meta.env.BASE_URL;
const wordsStore = useWordsStore();
const competitionStore = useCompetitionStore();

// Settings
const settings = reactive({
  wordCount: 10,
  timeLimit: 60,
  difficulty: null,
  voiceInput: false,
});

const wordCountMarks = {
  5: '5',
  10: '10',
  15: '15',
  20: '20',
  25: '25',
  30: '30',
};
const timeLimitMarks = {
  30: '30s',
  45: '45s',
  60: '60s',
  90: '90s',
  120: '120s',
};

// State
const showResults = ref(false);
const lastResult = ref(null);
const timerInterval = ref(null);
const announcerMessage = ref('准备好了吗？让我们开始吧！');

// Letter input state
const letterSlots = ref([]);
const letterInputRefs = ref([]);
const currentLetterIndex = ref(0);

// Voice input state
const isListening = ref(false);
const voiceStatusText = ref('点击开始语音输入');
const recognition = ref(null);
const voicePhase = ref('idle'); // idle, word, spelling
const lastProcessedTranscript = ref('');
const similarityScore = ref(null);
const lastWordAttempt = ref(''); // 记录上次尝试的单词，避免重复显示
const wordAttemptCount = ref(0); // 单词朗读尝试次数
const wordPhaseStartTime = ref(0); // 单词阶段开始时间
const isSpeaking = ref(false); // 页面是否正在朗读
const isComposing = ref(false); // 是否正在进行IME组合输入

// 防抖相关状态
const lastInputTime = ref({}); // 记录每个输入框最后输入时间
const lastInputValue = ref({}); // 记录每个输入框最后输入的值
const inputDebounceDelay = 100; // 防抖延迟（毫秒）
const pendingMoveToNext = ref(null); // 待执行的移动到下一个框的操作
const isProcessingInput = ref(false); // 是否正在处理输入（防止多重触发）
const lastProcessedIndex = ref(-1); // 上次处理的输入框索引
const lastProcessedTime = ref(0); // 上次处理的时间戳
const inputLockDuration = 150; // 输入锁定时间（毫秒）- 防止跨框重复

const askedQuestions = reactive({
  pronunciation: false,
  definition: false,
  partOfSpeech: false,
  example: false,
});

// Computed
const currentWord = computed(() => competitionStore.currentWord);

const isAllLettersFilled = computed(() => {
  return letterSlots.value.every(slot => slot.value);
});

const timerClass = computed(() => {
  const time = competitionStore.timeRemaining;
  if (time <= 10) return 'timer--danger';
  if (time <= 20) return 'timer--warning';
  return '';
});

const resultEmoji = computed(() => {
  if (!lastResult.value) return '🎯';
  const accuracy = lastResult.value.accuracy;
  if (accuracy >= 90) return '🏆';
  if (accuracy >= 70) return '🎉';
  if (accuracy >= 50) return '👍';
  return '💪';
});

// Initialize letter slots when word changes
watch(currentWord, (word) => {
  if (word) {
    letterSlots.value = word.word.split('').map(() => ({
      value: '',
      status: 'empty' // empty, correct, wrong
    }));
    currentLetterIndex.value = 0;
    nextTick(() => {
      if (letterInputRefs.value[0]) {
        letterInputRefs.value[0].focus();
      }
    });
  }
}, { immediate: true });

// Methods
async function startCompetition() {
  await wordsStore.init();
  const words = wordsStore.getRandomWords(
    settings.wordCount,
    settings.difficulty
  );

  if (words.length === 0) {
    MessagePlugin.warning('词库中没有符合条件的单词');
    return;
  }

  showResults.value = false;
  lastResult.value = null;
  competitionStore.startCompetition(words, settings.timeLimit);

  // Reset state
  resetAskedQuestions();

  // Start with word announcement
  announceWord();

  // Start timer
  startTimer();

  // Initialize voice recognition if enabled
  if (settings.voiceInput) {
    initVoiceRecognition();
  }
}

function initLetterSlots() {
  if (!currentWord.value) return;
  letterSlots.value = currentWord.value.word.split('').map(() => ({
    value: '',
    status: 'empty'
  }));
  currentLetterIndex.value = 0;
  // 清除所有输入缓存
  lastInputTime.value = {};
  lastInputValue.value = {};
  // 重置处理标记
  isProcessingInput.value = false;
  // 取消待执行的移动操作
  if (pendingMoveToNext.value) {
    clearTimeout(pendingMoveToNext.value);
    pendingMoveToNext.value = null;
  }
}

function handleLetterInput(event, index) {
  // 如果正在进行IME组合输入，不处理（等待compositionend）
  if (isComposing.value) {
    return;
  }
  
  const now = Date.now();
  
  // 全局输入锁检查：防止跨框重复输入
  // 如果在锁定时间内，且是相邻的下一个框，很可能是重复触发
  if (isProcessingInput.value || 
      (lastProcessedTime.value && now - lastProcessedTime.value < inputLockDuration && index === lastProcessedIndex.value + 1)) {
    // 只同步显示值，不处理
    event.target.value = letterSlots.value[index].value || '';
    return;
  }
  
  const inputValue = event.target.value || '';
  
  // 提取所有英文字母
  const letters = inputValue.replace(/[^a-zA-Z]/g, '').toLowerCase();
  
  // 如果没有有效字母，清空输入框并恢复原值
  if (!letters) {
    event.target.value = letterSlots.value[index].value || '';
    return;
  }
  
  // 只取第一个有效字母
  const value = letters.charAt(0);
  
  // 如果当前格已经有值且值相同，说明是重复触发，只更新显示
  if (letterSlots.value[index].value === value) {
    event.target.value = value;
    return;
  }
  
  // 防抖检查：如果同一个框在短时间内收到相同的值，忽略
  if (lastInputValue.value[index] === value && 
      lastInputTime.value[index] && 
      now - lastInputTime.value[index] < inputDebounceDelay) {
    event.target.value = value;
    return;
  }
  
  // 记录本次输入
  lastInputTime.value[index] = now;
  lastInputValue.value[index] = value;
  
  // 标记正在处理，记录处理的索引和时间
  isProcessingInput.value = true;
  lastProcessedIndex.value = index;
  lastProcessedTime.value = now;
  
  // 更新当前框的字母
  letterSlots.value[index].value = value;
  event.target.value = value;
  
  // Check if correct
  const correctLetter = currentWord.value.word[index].toLowerCase();
  if (value === correctLetter) {
    letterSlots.value[index].status = 'correct';
  } else {
    letterSlots.value[index].status = 'wrong';
  }
  
  // 取消之前的待执行移动操作
  if (pendingMoveToNext.value) {
    clearTimeout(pendingMoveToNext.value);
    pendingMoveToNext.value = null;
  }
  
  // 为下一个框预设防抖保护
  const nextIndex = index + 1;
  if (nextIndex < letterSlots.value.length) {
    lastInputTime.value[nextIndex] = now;
    lastInputValue.value[nextIndex] = value; // 防止相同字母被重复输入到下一个框
  }
  
  // 使用防抖延迟移动到下一个框，避免重复字母问题
  if (index < letterSlots.value.length - 1) {
    pendingMoveToNext.value = setTimeout(() => {
      currentLetterIndex.value = index + 1;
      const nextInput = letterInputRefs.value[index + 1];
      if (nextInput) {
        // 清空下一个框的输入缓存，确保不会带入残留
        nextInput.value = letterSlots.value[index + 1].value || '';
        nextInput.focus();
      }
      pendingMoveToNext.value = null;
      // 延迟重置处理标记，给手机端更多缓冲时间
      setTimeout(() => { isProcessingInput.value = false; }, 50);
    }, inputDebounceDelay);
  } else {
    // 输入最后一个字母后自动提交
    pendingMoveToNext.value = setTimeout(() => {
      if (isAllLettersFilled.value) {
        submitAnswer();
      }
      pendingMoveToNext.value = null;
      isProcessingInput.value = false;
    }, inputDebounceDelay);
  }
}

// IME 组合输入开始
function handleCompositionStart() {
  isComposing.value = true;
}

// IME 组合输入结束
function handleCompositionEnd(event, index) {
  isComposing.value = false;
  
  const now = Date.now();
  const inputValue = event.target.value || '';
  
  // 提取所有英文字母
  const letters = inputValue.replace(/[^a-zA-Z]/g, '').toLowerCase();
  
  // 如果没有有效字母，恢复原值
  if (!letters) {
    event.target.value = letterSlots.value[index].value || '';
    return;
  }
  
  // 只取第一个字母
  const value = letters.charAt(0);
  
  // 防抖检查
  if (lastInputValue.value[index] === value && 
      lastInputTime.value[index] && 
      now - lastInputTime.value[index] < inputDebounceDelay) {
    event.target.value = value;
    return;
  }
  
  // 记录本次输入
  lastInputTime.value[index] = now;
  lastInputValue.value[index] = value;
  
  // 如果值相同，不重复处理
  if (letterSlots.value[index].value === value) {
    event.target.value = value;
    return;
  }
  
  // 更新当前框的字母
  letterSlots.value[index].value = value;
  event.target.value = value;
  
  // Check if correct
  const correctLetter = currentWord.value.word[index].toLowerCase();
  if (value === correctLetter) {
    letterSlots.value[index].status = 'correct';
  } else {
    letterSlots.value[index].status = 'wrong';
  }
  
  // 取消之前的待执行移动操作
  if (pendingMoveToNext.value) {
    clearTimeout(pendingMoveToNext.value);
    pendingMoveToNext.value = null;
  }
  
  // 使用防抖延迟移动到下一个框
  if (index < letterSlots.value.length - 1) {
    pendingMoveToNext.value = setTimeout(() => {
      currentLetterIndex.value = index + 1;
      const nextInput = letterInputRefs.value[index + 1];
      if (nextInput) {
        nextInput.value = letterSlots.value[index + 1].value || '';
        nextInput.focus();
      }
      pendingMoveToNext.value = null;
    }, inputDebounceDelay);
  } else {
    // 输入最后一个字母后自动提交
    pendingMoveToNext.value = setTimeout(() => {
      if (isAllLettersFilled.value) {
        submitAnswer();
      }
      pendingMoveToNext.value = null;
    }, inputDebounceDelay);
  }
}

// 处理输入框获得焦点
function handleInputFocus(event, index) {
  currentLetterIndex.value = index;
  // 注意：不在这里重置 isProcessingInput，因为焦点转移可能是由输入触发的
  // 只有在用户主动点击时才清除缓存
  const now = Date.now();
  // 如果距离上次处理时间超过锁定时间，才清除缓存
  if (!lastProcessedTime.value || now - lastProcessedTime.value > inputLockDuration) {
    delete lastInputTime.value[index];
    delete lastInputValue.value[index];
    isProcessingInput.value = false;
  }
  // 确保输入框显示正确的值，防止残留
  event.target.value = letterSlots.value[index].value || '';
}

// 处理 beforeinput 事件，过滤非字母输入
function handleBeforeInput(event) {
  // 如果是组合输入，允许继续
  if (event.isComposing || isComposing.value) {
    return;
  }
  
  // 获取即将输入的数据
  const data = event.data;
  if (data) {
    // 检查是否包含字母
    const hasLetter = /[a-zA-Z]/.test(data);
    if (!hasLetter) {
      // 如果不包含字母，阻止输入
      event.preventDefault();
    }
  }
}

function handleLetterKeydown(event, index) {
  if (event.key === 'Backspace') {
    event.preventDefault();
    isProcessingInput.value = true;
    
    if (letterSlots.value[index].value) {
      letterSlots.value[index].value = '';
      letterSlots.value[index].status = 'empty';
      // 同步输入框显示
      if (letterInputRefs.value[index]) {
        letterInputRefs.value[index].value = '';
      }
    } else if (index > 0) {
      currentLetterIndex.value = index - 1;
      letterSlots.value[index - 1].value = '';
      letterSlots.value[index - 1].status = 'empty';
      nextTick(() => {
        const prevInput = letterInputRefs.value[index - 1];
        if (prevInput) {
          prevInput.value = '';
          prevInput.focus();
        }
        isProcessingInput.value = false;
      });
      return;
    }
    
    setTimeout(() => { isProcessingInput.value = false; }, 50);
  } else if (event.key === 'Enter') {
    if (isAllLettersFilled.value) {
      submitAnswer();
    }
  } else if (event.key === 'ArrowLeft' && index > 0) {
    currentLetterIndex.value = index - 1;
    letterInputRefs.value[index - 1]?.focus();
  } else if (event.key === 'ArrowRight' && index < letterSlots.value.length - 1) {
    currentLetterIndex.value = index + 1;
    letterInputRefs.value[index + 1]?.focus();
  } else if (/^[a-zA-Z]$/.test(event.key)) {
    // 直接处理字母键输入，实现替换功能
    event.preventDefault();
    
    // 标记正在处理，防止 input 事件重复触发
    isProcessingInput.value = true;
    
    const value = event.key.toLowerCase();
    const now = Date.now();
    
    // 记录输入时间和值
    lastInputTime.value[index] = now;
    lastInputValue.value[index] = value;
    
    letterSlots.value[index].value = value;
    
    // 同步输入框显示
    if (letterInputRefs.value[index]) {
      letterInputRefs.value[index].value = value;
    }
    
    // Check if correct
    const correctLetter = currentWord.value.word[index].toLowerCase();
    if (value === correctLetter) {
      letterSlots.value[index].status = 'correct';
    } else {
      letterSlots.value[index].status = 'wrong';
    }
    
    // Move to next slot or auto submit if last letter
    if (index < letterSlots.value.length - 1) {
      currentLetterIndex.value = index + 1;
      nextTick(() => {
        const nextInput = letterInputRefs.value[index + 1];
        if (nextInput) {
          nextInput.value = letterSlots.value[index + 1].value || '';
          nextInput.focus();
        }
        // 延迟重置处理标记
        setTimeout(() => { isProcessingInput.value = false; }, 50);
      });
    } else {
      // 输入最后一个字母后自动提交
      nextTick(() => {
        if (isAllLettersFilled.value) {
          submitAnswer();
        }
        isProcessingInput.value = false;
      });
    }
  }
}

function focusLetterInput(index) {
  currentLetterIndex.value = index;
  const input = letterInputRefs.value[index];
  if (input) {
    // 确保输入框显示正确的值
    input.value = letterSlots.value[index].value || '';
    input.focus();
    // 选中内容，方便直接替换
    if (input.value) {
      input.select();
    }
  }
}

// Voice Recognition
const voiceNotSupported = ref(false);

function checkVoiceSupport() {
  // 检查是否支持语音识别
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    return false;
  }
  return true;
}

function openInSystemBrowser() {
  const currentUrl = window.location.href;
  const ua = navigator.userAgent.toLowerCase();
  
  // 检测环境
  const isWechat = /micromessenger/i.test(ua);
  const isWeibo = /weibo/i.test(ua);
  const isQQ = /qq\//i.test(ua);
  const isAlipay = /alipayclient/i.test(ua);
  
  // 微信环境：显示引导蒙层提示用户点击右上角"在浏览器中打开"
  if (isWechat) {
    showOpenBrowserGuide('wechat');
    return;
  }
  
  // QQ环境
  if (isQQ) {
    showOpenBrowserGuide('qq');
    return;
  }
  
  // 微博环境
  if (isWeibo) {
    showOpenBrowserGuide('weibo');
    return;
  }
  
  // 支付宝环境
  if (isAlipay) {
    showOpenBrowserGuide('alipay');
    return;
  }
  
  // 其他环境：尝试复制链接
  copyUrlToClipboard(currentUrl);
}

// 显示引导用户在浏览器中打开的提示
function showOpenBrowserGuide(platform) {
  const currentUrl = window.location.href;
  
  let message = '';
  switch (platform) {
    case 'wechat':
      message = '请点击右上角 ··· 菜单，选择「在浏览器中打开」';
      break;
    case 'qq':
      message = '请点击右上角 ··· 菜单，选择「在浏览器中打开」';
      break;
    case 'weibo':
      message = '请点击右上角 ··· 菜单，选择「在浏览器中打开」';
      break;
    case 'alipay':
      message = '请点击右上角 ··· 菜单，选择「在浏览器中打开」';
      break;
    default:
      message = '请在系统浏览器中打开此页面';
  }
  
  // 同时复制链接到剪贴板
  copyUrlToClipboard(currentUrl, false);
  
  // 使用 TDesign 的 Dialog 显示引导
  MessagePlugin.info({
    content: message,
    duration: 5000,
    closeBtn: true,
  });
}

// 复制URL到剪贴板
function copyUrlToClipboard(url, showToast = true) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      if (showToast) {
        MessagePlugin.success('链接已复制，请在系统浏览器中粘贴打开');
      }
    }).catch(() => {
      fallbackCopyToClipboard(url, showToast);
    });
  } else {
    fallbackCopyToClipboard(url, showToast);
  }
}

// 兼容性复制方法
function fallbackCopyToClipboard(text, showToast = true) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful && showToast) {
      MessagePlugin.success('链接已复制，请在系统浏览器中粘贴打开');
    } else if (!successful && showToast) {
      MessagePlugin.info(`请手动复制链接: ${text}`);
    }
  } catch (err) {
    if (showToast) {
      MessagePlugin.info(`请手动复制链接: ${text}`);
    }
  }
  
  document.body.removeChild(textArea);
}

function initVoiceRecognition() {
  if (!checkVoiceSupport()) {
    voiceNotSupported.value = true;
    settings.voiceInput = false;
    return false;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition.value = new SpeechRecognition();
  recognition.value.continuous = true;
  recognition.value.interimResults = true;
  recognition.value.lang = 'en-US';
  recognition.value.maxAlternatives = 3;

  recognition.value.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript.toLowerCase().trim();
      
      if (voicePhase.value === 'spelling') {
        processSpellingInput(transcript, result.isFinal);
      } else if (voicePhase.value === 'word') {
        processWordInput(transcript, result.isFinal);
      }
    }
  };

  recognition.value.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    
    // 检测是否是不支持的错误
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      voiceNotSupported.value = true;
      settings.voiceInput = false;
      voiceStatusText.value = '语音识别不可用';
      return;
    }
    
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      voiceStatusText.value = '识别错误，请重试';
    }
    
    if (event.error === 'no-speech' && isListening.value && competitionStore.isActive) {
      setTimeout(() => {
        if (isListening.value && competitionStore.isActive && !isSpeaking.value) {
          try {
            recognition.value.start();
          } catch (e) {}
        }
      }, 100);
    }
  };

  recognition.value.onend = () => {
    if (isListening.value && competitionStore.isActive && !isSpeaking.value) {
      lastProcessedTranscript.value = '';
      setTimeout(() => {
        if (isListening.value && competitionStore.isActive && !isSpeaking.value) {
          try {
            recognition.value.start();
          } catch (e) {
            console.error('Failed to restart recognition:', e);
          }
        }
      }, 50);
    }
  };
  
  return true;
}

// 计算字符串相似度 (Levenshtein distance based)
function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 100;
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  if (len1 === 0 || len2 === 0) return 0;
  
  const matrix = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return Math.round((1 - distance / maxLen) * 100);
}

// 获取相似度评价
function getSimilarityFeedback(score) {
  if (score === 100) return { text: '完美发音！', class: 'perfect' };
  if (score >= 80) return { text: '发音很好！', class: 'good' };
  if (score >= 60) return { text: '发音尚可', class: 'fair' };
  if (score >= 40) return { text: '请再试试', class: 'poor' };
  return { text: '未识别到单词', class: 'none' };
}

// 获取相似度CSS类
function getSimilarityClass(score) {
  if (score === 100) return 'similarity-perfect';
  if (score >= 80) return 'similarity-good';
  if (score >= 60) return 'similarity-fair';
  return 'similarity-poor';
}

// 处理单词识别 - 简化逻辑：有识别结果就处理，isFinal 时直接进入拼读阶段
function processWordInput(transcript, isFinal = false) {
  if (!currentWord.value || isSpeaking.value) return;
  
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;
  
  // 避免对相同内容重复处理
  if (cleanTranscript === lastWordAttempt.value && !isFinal) return;
  lastWordAttempt.value = cleanTranscript;
  
  // 计算相似度（直接用原始 transcript，不过滤）
  const targetWord = currentWord.value.word.toLowerCase();
  const similarity = calculateSimilarity(cleanTranscript, targetWord);
  similarityScore.value = similarity;
  
  // isFinal 时直接进入拼读阶段，不管相似度多少
  if (isFinal) {
    // 清除5秒超时定时器
    clearWordPhaseTimer();
    
    // 进入拼读阶段
    const message = similarity >= 80 ? `发音很好 ${similarity}%` : `相似度 ${similarity}%`;
    
    voiceStatusText.value = message;
    voicePhase.value = 'spelling';
    lastWordAttempt.value = '';
    sessionLetterCount = 0;
    
    pauseVoiceRecognition();
    
    const confirmText = similarity >= 80 ? 'Good! Now spell it.' : 'Now spell it.';
    speakWithCallback(confirmText, () => {
      lastProcessedTranscript.value = '';
      resumeVoiceRecognition();
    });
  } else {
    voiceStatusText.value = `识别中... ${similarity}%`;
  }
}

// 处理字母拼读 - 智能识别字母发音
// 记录当前识别会话中已处理的字母数
let sessionLetterCount = 0;
let lastRecognizedLetters = '';

// 从语音识别结果中提取字母
function extractLettersFromTranscript(transcript) {
  const lower = transcript.toLowerCase().trim();
  const letters = [];
  
  // 字母发音映射表（按长度排序，优先匹配长的）
  const phoneticPatterns = [
    // 长发音（优先匹配）
    { pattern: /double\s*u|double\s*you|doubleyou/g, letter: 'w' },
    { pattern: /\bwhiskey\b/g, letter: 'w' },
    { pattern: /\bnovember\b/g, letter: 'n' },
    { pattern: /\bfoxtrot\b/g, letter: 'f' },
    { pattern: /\bcharlie\b/g, letter: 'c' },
    { pattern: /\buniform\b/g, letter: 'u' },
    { pattern: /\bvictor\b/g, letter: 'v' },
    { pattern: /\bsierra\b/g, letter: 's' },
    { pattern: /\bjuliet\b/g, letter: 'j' },
    { pattern: /\balpha\b/g, letter: 'a' },
    { pattern: /\bbravo\b/g, letter: 'b' },
    { pattern: /\bdelta\b/g, letter: 'd' },
    { pattern: /\bhotel\b/g, letter: 'h' },
    { pattern: /\bindia\b/g, letter: 'i' },
    { pattern: /\boscar\b/g, letter: 'o' },
    { pattern: /\bquebec\b/g, letter: 'q' },
    { pattern: /\bromeo\b/g, letter: 'r' },
    { pattern: /\btango\b/g, letter: 't' },
    { pattern: /\byankee\b/g, letter: 'y' },
    { pattern: /\bx-ray|xray\b/g, letter: 'x' },
    { pattern: /\becho\b/g, letter: 'e' },
    { pattern: /\bgolf\b/g, letter: 'g' },
    { pattern: /\bkilo\b/g, letter: 'k' },
    { pattern: /\blima\b/g, letter: 'l' },
    { pattern: /\bmike\b/g, letter: 'm' },
    { pattern: /\bpapa\b/g, letter: 'p' },
    { pattern: /\bzulu\b/g, letter: 'z' },
    // 常见字母发音
    { pattern: /\baitch\b/g, letter: 'h' },
    { pattern: /\bqueue\b/g, letter: 'q' },
  ];
  
  // 先用长模式替换，避免被短模式误匹配
  let processed = lower;
  const foundLetters = [];
  
  for (const { pattern, letter } of phoneticPatterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      foundLetters.push({ index: match.index, letter });
    }
    processed = processed.replace(pattern, ' ');
  }
  
  // 处理剩余的单词/字母
  const words = processed.split(/[\s,.-]+/).filter(w => w.length > 0);
  
  for (const word of words) {
    const letter = mapWordToLetter(word);
    if (letter) {
      // 找到这个词在原始字符串中的位置
      const idx = lower.indexOf(word);
      foundLetters.push({ index: idx >= 0 ? idx : foundLetters.length * 100, letter });
    }
  }
  
  // 按位置排序
  foundLetters.sort((a, b) => a.index - b.index);
  
  return foundLetters.map(f => f.letter).join('');
}

// 单词到字母的映射
function mapWordToLetter(word) {
  const lower = word.toLowerCase().trim();
  
  // 单字母直接返回
  if (lower.length === 1 && /[a-z]/.test(lower)) return lower;
  
  const map = {
    // 标准字母名称发音
    'a': 'a', 'ay': 'a', 'eh': 'a', 'hey': 'a', 'aye': 'a',
    'b': 'b', 'be': 'b', 'bee': 'b', 'beat': 'b',
    'c': 'c', 'see': 'c', 'sea': 'c', 'si': 'c', 'ce': 'c',
    'd': 'd', 'de': 'd', 'dee': 'd', 'the': 'd',
    'e': 'e', 'ee': 'e', 'he': 'e',
    'f': 'f', 'ef': 'f', 'eff': 'f', 'if': 'f', 'of': 'f',
    'g': 'g', 'ge': 'g', 'gee': 'g', 'ji': 'g', 'jee': 'g',
    'h': 'h', 'age': 'h', 'ach': 'h', 'each': 'h', 'aitch': 'h',
    'i': 'i', 'eye': 'i', 'ai': 'i',
    'j': 'j', 'jay': 'j', 'je': 'j',
    'k': 'k', 'kay': 'k', 'ke': 'k', 'ok': 'k', 'okay': 'k', 'cake': 'k',
    'l': 'l', 'el': 'l', 'ell': 'l', 'elle': 'l', 'all': 'l', 'ill': 'l', 'ale': 'l',
    'm': 'm', 'em': 'm', 'am': 'm', 'im': 'm',
    'n': 'n', 'en': 'n', 'an': 'n', 'in': 'n', 'and': 'n', 'end': 'n',
    'o': 'o', 'oh': 'o', 'owe': 'o',
    'p': 'p', 'pe': 'p', 'pee': 'p',
    'q': 'q', 'cue': 'q', 'queue': 'q', 'cu': 'q', 'cute': 'q', 'que': 'q',
    'r': 'r', 'ar': 'r', 'are': 'r', 'our': 'r', 'or': 'r', 'err': 'r',
    's': 's', 'es': 's', 'ess': 's', 'as': 's', 'is': 's', 'us': 's', 'yes': 's', 'ass': 's',
    't': 't', 'te': 't', 'tee': 't', 'tea': 't', 'it': 't', 'at': 't', 'ti': 't',
    'u': 'u', 'you': 'u', 'ewe': 'u', 'yu': 'u', 'new': 'u', 'ew': 'u',
    'v': 'v', 've': 'v', 'vee': 'v', 'we': 'v', 'vie': 'v',
    'w': 'w', 'double': 'w',
    'x': 'x', 'ex': 'x', 'eggs': 'x', 'axe': 'x', 'ax': 'x', 'ecks': 'x',
    'y': 'y', 'why': 'y', 'wye': 'y', 'wie': 'y', 'wise': 'y',
    'z': 'z', 'ze': 'z', 'zee': 'z', 'zed': 'z', 'said': 'z', 'zeal': 'z'
  };
  
  if (map[lower]) return map[lower];
  
  // 尝试去掉常见后缀
  const withoutSuffix = lower.replace(/(ing|ed|s|er|ly)$/, '');
  if (withoutSuffix !== lower && map[withoutSuffix]) {
    return map[withoutSuffix];
  }
  
  return null;
}

function processSpellingInput(transcript, isFinal) {
  if (!currentWord.value || isSpeaking.value) return;
  
  // 如果所有字母已填满，不再处理
  if (isAllLettersFilled.value) return;
  
  const cleanTranscript = transcript.toLowerCase().trim();
  if (cleanTranscript.length === 0) return;
  
  // 使用智能提取
  const letters = extractLettersFromTranscript(cleanTranscript);
  if (letters.length === 0) return;
  
  // 只有当本次识别会话中字母数量增加时才填入
  if (letters.length > sessionLetterCount) {
    const newLetters = letters.slice(sessionLetterCount);
    
    for (const letter of newLetters) {
      // 找到第一个空位
      const emptyIndex = letterSlots.value.findIndex(slot => !slot.value);
      if (emptyIndex === -1) break;
      
      letterSlots.value[emptyIndex].value = letter;
      
      // 检查是否正确，设置对应状态（与键盘输入一致）
      const correctLetter = currentWord.value.word[emptyIndex].toLowerCase();
      if (letter === correctLetter) {
        letterSlots.value[emptyIndex].status = 'correct';
      } else {
        letterSlots.value[emptyIndex].status = 'wrong';
      }
      
      // 移动光标
      if (emptyIndex + 1 < letterSlots.value.length) {
        currentLetterIndex.value = emptyIndex + 1;
      } else {
        currentLetterIndex.value = emptyIndex;
      }
    }
    
    // 更新会话计数
    sessionLetterCount = letters.length;
    
    voiceStatusText.value = `已输入: ${newLetters.toUpperCase()}`;
    
    // 检查是否填满，自动提交
    nextTick(() => {
      if (isAllLettersFilled.value) {
        submitAnswer();
      } else {
        // 聚焦到当前光标位置
        letterInputRefs.value[currentLetterIndex.value]?.focus();
      }
    });
  }
  
  // isFinal 时重置会话计数，准备接收下一轮识别
  if (isFinal) {
    sessionLetterCount = 0;
  }
}

// 填充指定位置的字母框（保留给其他地方调用）
function fillCurrentSlot(letter) {
  const targetIndex = currentLetterIndex.value;
  
  if (targetIndex >= 0 && targetIndex < letterSlots.value.length) {
    letterSlots.value[targetIndex].value = letter;
    letterSlots.value[targetIndex].status = 'filled';
    
    // 移动光标到下一个位置
    if (targetIndex + 1 < letterSlots.value.length) {
      currentLetterIndex.value = targetIndex + 1;
      nextTick(() => {
        letterInputRefs.value[targetIndex + 1]?.focus();
      });
    }
  }
}

// 严格模式的字母映射 - 匹配字母发音
function mapPhoneticToLetterStrict(input) {
  const lower = input.toLowerCase().trim();
  
  // 单字母直接返回
  if (lower.length === 1 && /[a-z]/.test(lower)) return lower;
  
  // 综合匹配表 - 包含各种可能的发音和误识别
  const phoneticMap = {
    // NATO phonetic alphabet
    'alpha': 'a', 'bravo': 'b', 'charlie': 'c', 'delta': 'd', 'echo': 'e',
    'foxtrot': 'f', 'golf': 'g', 'hotel': 'h', 'india': 'i', 'juliet': 'j',
    'kilo': 'k', 'lima': 'l', 'mike': 'm', 'november': 'n', 'oscar': 'o',
    'papa': 'p', 'quebec': 'q', 'romeo': 'r', 'sierra': 's', 'tango': 't',
    'uniform': 'u', 'victor': 'v', 'whiskey': 'w', 'xray': 'x', 'yankee': 'y',
    'zulu': 'z',
    
    // 标准字母发音
    'ay': 'a', 'a': 'a', 'eh': 'a',
    'bee': 'b', 'be': 'b',
    'see': 'c', 'sea': 'c', 'si': 'c',
    'dee': 'd', 'de': 'd', 'the': 'd',
    'ee': 'e', 'he': 'e',
    'eff': 'f', 'ef': 'f', 'if': 'f', 'of': 'f',
    'gee': 'g', 'ge': 'g', 'ji': 'g',
    'aitch': 'h', 'ach': 'h', 'age': 'h', 'h': 'h', 'each': 'h',
    'eye': 'i', 'i': 'i', 'aye': 'i', 'ai': 'i',
    'jay': 'j', 'je': 'j', 'j': 'j',
    'kay': 'k', 'ke': 'k', 'k': 'k', 'ok': 'k', 'okay': 'k',
    'el': 'l', 'ell': 'l', 'elle': 'l', 'l': 'l', 'all': 'l', 'ill': 'l',
    'em': 'm', 'm': 'm', 'am': 'm', 'im': 'm',
    'en': 'n', 'n': 'n', 'and': 'n', 'in': 'n', 'an': 'n', 'end': 'n',
    'oh': 'o', 'o': 'o', 'owe': 'o',
    'pee': 'p', 'pe': 'p', 'p': 'p',
    'cue': 'q', 'queue': 'q', 'q': 'q', 'cute': 'q', 'cu': 'q',
    'ar': 'r', 'are': 'r', 'r': 'r', 'our': 'r', 'or': 'r', 'err': 'r',
    'ess': 's', 'es': 's', 's': 's', 'as': 's', 'is': 's', 'us': 's', 'yes': 's',
    'tee': 't', 'tea': 't', 't': 't', 'it': 't', 'at': 't', 'ti': 't',
    'you': 'u', 'u': 'u', 'ewe': 'u', 'yu': 'u', 'new': 'u',
    'vee': 'v', 've': 'v', 'v': 'v', 'we': 'v',
    'doubleu': 'w', 'doubleyou': 'w', 'double': 'w', 'w': 'w',
    'ex': 'x', 'x': 'x', 'eggs': 'x', 'axe': 'x', 'ax': 'x',
    'why': 'y', 'wye': 'y', 'y': 'y', 'wie': 'y',
    'zee': 'z', 'zed': 'z', 'z': 'z', 'ze': 'z', 'said': 'z'
  };
  
  // 直接匹配
  if (phoneticMap[lower]) return phoneticMap[lower];
  
  // 尝试去掉末尾的常见后缀再匹配
  const withoutSuffix = lower.replace(/(ing|ed|s|er)$/, '');
  if (withoutSuffix !== lower && phoneticMap[withoutSuffix]) {
    return phoneticMap[withoutSuffix];
  }
  
  // 尝试匹配开头的字母发音
  for (const [key, letter] of Object.entries(phoneticMap)) {
    if (key.length >= 2 && lower.startsWith(key)) {
      return letter;
    }
  }
  
  return null;
}

function mapPhoneticToLetter(input) {
  const phoneticMap = {
    // NATO phonetic alphabet
    'alpha': 'a', 'bravo': 'b', 'charlie': 'c', 'delta': 'd', 'echo': 'e',
    'foxtrot': 'f', 'golf': 'g', 'hotel': 'h', 'india': 'i', 'juliet': 'j',
    'kilo': 'k', 'lima': 'l', 'mike': 'm', 'november': 'n', 'oscar': 'o',
    'papa': 'p', 'quebec': 'q', 'romeo': 'r', 'sierra': 's', 'tango': 't',
    'uniform': 'u', 'victor': 'v', 'whiskey': 'w', 'xray': 'x', 'yankee': 'y',
    'zulu': 'z',
    // Letter names (how letters sound)
    'ay': 'a', 'a': 'a', 'bee': 'b', 'b': 'b', 'see': 'c', 'sea': 'c', 'c': 'c',
    'dee': 'd', 'd': 'd', 'ee': 'e', 'e': 'e', 'eff': 'f', 'f': 'f',
    'gee': 'g', 'g': 'g', 'aitch': 'h', 'h': 'h', 'eye': 'i', 'i': 'i',
    'jay': 'j', 'j': 'j', 'kay': 'k', 'k': 'k', 'el': 'l', 'l': 'l',
    'em': 'm', 'm': 'm', 'en': 'n', 'n': 'n', 'oh': 'o', 'o': 'o',
    'pee': 'p', 'p': 'p', 'cue': 'q', 'queue': 'q', 'q': 'q',
    'ar': 'r', 'are': 'r', 'r': 'r', 'ess': 's', 's': 's',
    'tee': 't', 'tea': 't', 't': 't', 'you': 'u', 'u': 'u',
    'vee': 'v', 'v': 'v', 'double': 'w', 'w': 'w',
    'ex': 'x', 'x': 'x', 'why': 'y', 'wye': 'y', 'y': 'y',
    'zee': 'z', 'zed': 'z', 'z': 'z',
    // Common misrecognitions
    'be': 'b', 'ce': 'c', 'de': 'd', 'ge': 'g', 'pe': 'p', 've': 'v',
    'aye': 'i', 'ai': 'i', 'hey': 'a', 'hey': 'a',
    'are you': 'r', 'you are': 'r', 'our': 'r',
    'queue you': 'q', 'cute': 'q',
    'double you': 'w', 'doubleyou': 'w',
    'eggs': 'x', 'axe': 'x',
    'and': 'n', 'in': 'n', 'end': 'n',
    'am': 'm', 'im': 'm',
    'as': 's', 'is': 's', 'us': 's',
    'it': 't', 'at': 't',
    'if': 'f', 'of': 'f',
    'all': 'l', 'ill': 'l', 'elle': 'l'
  };
  
  const lower = input.toLowerCase().trim();
  
  // 直接匹配
  if (phoneticMap[lower]) return phoneticMap[lower];
  
  // 单字母直接返回
  if (lower.length === 1 && /[a-z]/.test(lower)) return lower;
  
  return null;
}

// 5秒无输入自动进入字母阶段的定时器
const wordPhaseTimer = ref(null);

function startVoiceInput() {
  // 如果已经在监听，不重复启动
  if (isListening.value) {
    return;
  }
  
  if (isSpeaking.value) {
    // 如果正在朗读，等待朗读完成后自动开始
    voiceStatusText.value = '等待朗读完成...';
    return;
  }
  
  if (!recognition.value) {
    initVoiceRecognition();
  }
  
  if (recognition.value) {
    try {
      recognition.value.start();
      isListening.value = true;
      voicePhase.value = 'word';
      lastProcessedTranscript.value = '';
      lastWordAttempt.value = '';
      similarityScore.value = null;
      wordAttemptCount.value = 0;
      wordPhaseStartTime.value = Date.now();
      voiceStatusText.value = '请朗读单词...';
      
      // 设置5秒超时自动进入字母阶段
      clearWordPhaseTimer();
      wordPhaseTimer.value = setTimeout(() => {
        if (voicePhase.value === 'word' && isListening.value) {
          autoAdvanceToSpelling();
        }
      }, 5000);
    } catch (e) {
      console.error('Failed to start recognition:', e);
      // 如果启动失败，可能是已经在运行
      isListening.value = true;
    }
  }
}

function clearWordPhaseTimer() {
  if (wordPhaseTimer.value) {
    clearTimeout(wordPhaseTimer.value);
    wordPhaseTimer.value = null;
  }
}

// 5秒无输入自动进入字母拼读阶段
function autoAdvanceToSpelling() {
  if (voicePhase.value !== 'word') return;
  
  voiceStatusText.value = '5秒无输入，请拼读字母';
  voicePhase.value = 'spelling';
  lastWordAttempt.value = '';
  sessionLetterCount = 0; // 重置会话计数
  
  // 暂停识别
  pauseVoiceRecognition();
  
  // 播放提示音，完成后重新开始识别
  speakWithCallback('Now spell it.', () => {
    lastProcessedTranscript.value = '';
    resumeVoiceRecognition();
  });
}

function stopVoiceInput() {
  clearWordPhaseTimer();
  if (recognition.value) {
    try {
      recognition.value.stop();
    } catch (e) {
      console.error('Failed to stop recognition:', e);
    }
  }
  isListening.value = false;
  voicePhase.value = 'idle';
  lastProcessedTranscript.value = '';
  lastWordAttempt.value = '';
  similarityScore.value = null;
  wordAttemptCount.value = 0;
  wordPhaseStartTime.value = 0;
  voiceStatusText.value = '点击开始语音输入';
}

function handleVoiceToggle(value) {
  if (value) {
    initVoiceRecognition();
    // 开启语音输入后自动开始识别
    if (competitionStore.isActive && !isSpeaking.value) {
      startVoiceInput();
    }
  } else {
    stopVoiceInput();
  }
}

function exitCompetition() {
  stopTimer();
  stopVoiceInput();
  speechSynthesis.cancel();
  competitionStore.resetCompetition();
  showResults.value = false;
  lastResult.value = null;
}

function announceWord() {
  if (!currentWord.value) return;

  announcerMessage.value = `请拼写单词...`;

  // 重置语音识别状态
  voicePhase.value = 'word';
  wordAttemptCount.value = 0;
  wordPhaseStartTime.value = Date.now();
  lastWordAttempt.value = '';
  similarityScore.value = null;

  // Speak the word
  setTimeout(() => {
    speakWord(currentWord.value.word);
  }, 500);
}

function speakWord(word, callback = null) {
  speechSynthesis.cancel();
  isSpeaking.value = true;
  
  // 朗读时暂停语音识别
  pauseVoiceRecognition();
  
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.7;
  utterance.pitch = 1;
  
  utterance.onend = () => {
    isSpeaking.value = false;
    if (callback) {
      callback();
    } else if (settings.voiceInput && competitionStore.isActive) {
      // 朗读完成后恢复语音识别
      resumeVoiceRecognition();
    }
  };
  
  utterance.onerror = () => {
    isSpeaking.value = false;
    if (callback) callback();
  };
  
  speechSynthesis.speak(utterance);
}

function speakWithCallback(text, callback) {
  speechSynthesis.cancel();
  isSpeaking.value = true;
  
  // 朗读时暂停语音识别
  pauseVoiceRecognition();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1.2;
  
  utterance.onend = () => {
    isSpeaking.value = false;
    if (callback) callback();
  };
  
  utterance.onerror = () => {
    isSpeaking.value = false;
    if (callback) callback();
  };
  
  speechSynthesis.speak(utterance);
}

// 暂停语音识别（用于页面朗读时）
function pauseVoiceRecognition() {
  if (recognition.value && isListening.value) {
    try {
      recognition.value.stop();
    } catch (e) {}
  }
  isListening.value = false;
}

// 恢复语音识别
function resumeVoiceRecognition() {
  if (!settings.voiceInput || !competitionStore.isActive || isSpeaking.value) return;
  
  // 如果已经在监听，不重复启动
  if (isListening.value) return;
  
  if (!recognition.value) {
    initVoiceRecognition();
  }
  
  if (recognition.value) {
    try {
      recognition.value.start();
      isListening.value = true;
      voiceStatusText.value = voicePhase.value === 'word' ? '请朗读单词...' : '请拼读字母...';
    } catch (e) {
      console.error('Failed to resume recognition:', e);
      // 如果启动失败，可能是已经在运行，设置状态为 true
      isListening.value = true;
    }
  }
}

function repeatWord() {
  if (currentWord.value) {
    // 清除已输入的字母
    letterSlots.value.forEach(slot => {
      slot.value = '';
      slot.status = 'empty';
    });
    currentLetterIndex.value = 0;
    nextTick(() => {
      letterInputRefs.value[0]?.focus();
    });
    
    // 重置语音识别状态
    voicePhase.value = 'word';
    wordAttemptCount.value = 0;
    wordPhaseStartTime.value = Date.now();
    lastWordAttempt.value = '';
    similarityScore.value = null;
    
    announcerMessage.value = `我再说一遍...`;
    // 朗读单词（会自动暂停识别，朗读完后恢复）
    speakWord(currentWord.value.word);
  }
}

function askQuestion(type) {
  if (!currentWord.value) return;

  askedQuestions[type] = true;

  switch (type) {
    case 'pronunciation':
      announcerMessage.value = `音标是: ${
        currentWord.value.pronunciation || '暂无音标'
      }`;
      // 朗读单词
      speakWord(currentWord.value.word);
      break;
    case 'definition':
      const defCn = currentWord.value.definition_cn ? ` (${currentWord.value.definition_cn})` : '';
      announcerMessage.value = `释义: ${currentWord.value.definition}${defCn}`;
      break;
    case 'partOfSpeech':
      announcerMessage.value = `词性: ${
        currentWord.value.part_of_speech || '未知'
      }`;
      break;
    case 'example':
      announcerMessage.value = `例句: ${
        currentWord.value.example_sentence || '暂无例句'
      }`;
      break;
  }
}

function resetAskedQuestions() {
  askedQuestions.pronunciation = false;
  askedQuestions.definition = false;
  askedQuestions.partOfSpeech = false;
  askedQuestions.example = false;
}

function startTimer() {
  stopTimer();
  timerInterval.value = setInterval(() => {
    if (!competitionStore.updateTimer()) {
      handleTimeout();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval.value) {
    clearInterval(timerInterval.value);
    timerInterval.value = null;
  }
}

function handleTimeout() {
  stopTimer();
  stopVoiceInput();
  competitionStore.timeOut();

  announcerMessage.value = `很遗憾，时间到了。正确答案是 "${currentWord.value?.word}"`;
  
  // Show correct answer in slots with error styling
  if (currentWord.value) {
    currentWord.value.word.split('').forEach((char, i) => {
      if (letterSlots.value[i]) {
        // 如果用户没有输入或输入错误，显示正确答案并标记为错误
        if (!letterSlots.value[i].value || letterSlots.value[i].value.toLowerCase() !== char.toLowerCase()) {
          letterSlots.value[i].value = char;
          letterSlots.value[i].status = 'wrong';
        }
      }
    });
  }

  setTimeout(() => {
    moveToNextOrEnd();
  }, 2000);
}

async function submitAnswer() {
  if (!isAllLettersFilled.value || !currentWord.value) return;

  const userAnswer = letterSlots.value.map(s => s.value).join('');
  const isCorrect = competitionStore.checkAnswer(userAnswer);

  stopTimer();
  stopVoiceInput();

  if (isCorrect) {
    announcerMessage.value = `太棒了！"${currentWord.value.word}" 拼写正确！`;

    // 暂停识别后播放
    pauseVoiceRecognition();
    const congrats = new SpeechSynthesisUtterance('Correct!');
    congrats.lang = 'en-US';
    congrats.rate = 1;
    speechSynthesis.speak(congrats);
  } else {
    announcerMessage.value = `很遗憾，正确答案是 "${currentWord.value.word}"`;
    
    // Show all letters with correct/wrong status
    currentWord.value.word.split('').forEach((char, i) => {
      if (letterSlots.value[i]) {
        if (letterSlots.value[i].value.toLowerCase() !== char.toLowerCase()) {
          // 错误的字母显示正确答案，标记为红色
          letterSlots.value[i].value = char;
          letterSlots.value[i].status = 'wrong';
        }
      }
    });
  }

  setTimeout(() => {
    moveToNextOrEnd();
  }, 2000);
}

function skipWord() {
  stopTimer();
  stopVoiceInput();
  
  // 先保存当前单词信息用于显示
  const skippedWord = currentWord.value?.word;
  
  // 显示正确答案，标记为红色错误
  if (currentWord.value) {
    currentWord.value.word.split('').forEach((char, i) => {
      if (letterSlots.value[i]) {
        letterSlots.value[i].value = char;
        letterSlots.value[i].status = 'wrong';
      }
    });
  }
  
  // 调用 skipWord 会记录跳过并移动到下一个单词
  competitionStore.skipWord();
  
  announcerMessage.value = `跳过了这个单词。正确答案是 "${skippedWord}"`;

  setTimeout(() => {
    // skipWord 已经移动了索引，直接检查是否还有下一个单词
    if (competitionStore.currentWord) {
      resetAskedQuestions();
      initLetterSlots();
      announceWord();
      startTimer();
      
      if (settings.voiceInput) {
        // 等待朗读完成后自动开始语音识别
        voicePhase.value = 'word';
        wordAttemptCount.value = 0;
        wordPhaseStartTime.value = Date.now();
      }
      
      nextTick(() => {
        letterInputRefs.value[0]?.focus();
      });
    } else {
      endCompetition();
    }
  }, 1500);
}

async function moveToNextOrEnd() {
  if (competitionStore.nextWord()) {
    resetAskedQuestions();
    initLetterSlots();

    announceWord();
    startTimer();

    // 语音识别会在 announceWord -> speakWord 完成后自动启动

    await nextTick();
    letterInputRefs.value[0]?.focus();
  } else {
    await endCompetition();
  }
}

async function endCompetition() {
  stopTimer();
  stopVoiceInput();
  lastResult.value = await competitionStore.endCompetition();
  showResults.value = true;
}

function restartCompetition() {
  showResults.value = false;
  lastResult.value = null;
  competitionStore.resetCompetition();
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
}

// 全局键盘事件处理 - 当输入框失去焦点时，按字母键自动恢复焦点并输入
function handleGlobalKeydown(event) {
  // 只在比赛进行中处理
  if (!competitionStore.isActive) return;
  
  // 如果正在处理输入，跳过
  if (isProcessingInput.value) return;
  
  // 检查当前焦点是否在字母输入框内
  const activeElement = document.activeElement;
  const isInputFocused = letterInputRefs.value.some(ref => ref === activeElement);
  
  // 如果已经在输入框内，不处理（让原有逻辑处理）
  if (isInputFocused) return;
  
  // 检查是否按下了字母键
  if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault();
    
    // 标记正在处理
    isProcessingInput.value = true;
    
    // 找到当前应该聚焦的输入框索引
    let targetIndex = currentLetterIndex.value;
    
    // 如果当前索引的框已有值，找第一个空框
    if (letterSlots.value[targetIndex]?.value) {
      const emptyIndex = letterSlots.value.findIndex(slot => !slot.value);
      if (emptyIndex !== -1) {
        targetIndex = emptyIndex;
      }
    }
    
    // 确保索引有效
    if (targetIndex >= 0 && targetIndex < letterSlots.value.length) {
      const value = event.key.toLowerCase();
      const now = Date.now();
      
      // 记录输入时间和值
      lastInputTime.value[targetIndex] = now;
      lastInputValue.value[targetIndex] = value;
      
      // 更新字母
      letterSlots.value[targetIndex].value = value;
      
      // 同步输入框显示
      if (letterInputRefs.value[targetIndex]) {
        letterInputRefs.value[targetIndex].value = value;
      }
      
      // 检查是否正确
      const correctLetter = currentWord.value.word[targetIndex].toLowerCase();
      if (value === correctLetter) {
        letterSlots.value[targetIndex].status = 'correct';
      } else {
        letterSlots.value[targetIndex].status = 'wrong';
      }
      
      // 移动到下一个框或自动提交
      if (targetIndex < letterSlots.value.length - 1) {
        currentLetterIndex.value = targetIndex + 1;
        nextTick(() => {
          const nextInput = letterInputRefs.value[targetIndex + 1];
          if (nextInput) {
            nextInput.value = letterSlots.value[targetIndex + 1].value || '';
            nextInput.focus();
          }
          setTimeout(() => { isProcessingInput.value = false; }, 50);
        });
      } else {
        // 最后一个字母，检查是否自动提交
        nextTick(() => {
          if (isAllLettersFilled.value) {
            submitAnswer();
          } else {
            // 聚焦到当前框
            const input = letterInputRefs.value[targetIndex];
            if (input) {
              input.value = value;
              input.focus();
            }
          }
          isProcessingInput.value = false;
        });
      }
    } else {
      isProcessingInput.value = false;
    }
  } else if (event.key === 'Backspace') {
    // 处理退格键
    event.preventDefault();
    isProcessingInput.value = true;
    
    let targetIndex = currentLetterIndex.value;
    
    // 如果当前框有值，清空它
    if (letterSlots.value[targetIndex]?.value) {
      letterSlots.value[targetIndex].value = '';
      letterSlots.value[targetIndex].status = 'empty';
      nextTick(() => {
        const input = letterInputRefs.value[targetIndex];
        if (input) {
          input.value = '';
          input.focus();
        }
        isProcessingInput.value = false;
      });
    } else if (targetIndex > 0) {
      // 如果当前框为空，移动到上一个框并清空
      targetIndex = targetIndex - 1;
      letterSlots.value[targetIndex].value = '';
      letterSlots.value[targetIndex].status = 'empty';
      currentLetterIndex.value = targetIndex;
      nextTick(() => {
        const input = letterInputRefs.value[targetIndex];
        if (input) {
          input.value = '';
          input.focus();
        }
        isProcessingInput.value = false;
      });
    } else {
      isProcessingInput.value = false;
    }
  } else if (event.key === 'Enter') {
    // 处理回车键提交
    if (isAllLettersFilled.value) {
      event.preventDefault();
      submitAnswer();
    }
  }
}

// Lifecycle
onMounted(() => {
  wordsStore.init();
  // 添加全局键盘事件监听
  document.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  stopTimer();
  stopVoiceInput();
  clearWordPhaseTimer();
  speechSynthesis.cancel();
  // 移除全局键盘事件监听
  document.removeEventListener('keydown', handleGlobalKeydown);
});

// Watch for competition end
watch(
  () => competitionStore.isFinished,
  (finished) => {
    if (finished && competitionStore.isActive) {
      endCompetition();
    }
  }
);
</script>

<style lang="scss" scoped>
.competition-page {
  max-width: 800px;
  margin: 0 auto;
}

.setup-container {
  .setup-card {
    background: var(--bg-card);
    border-radius: 24px;
    padding: 3rem;
    box-shadow: var(--shadow-lg);

    .setup-header {
      text-align: center;
      margin-bottom: 2rem;

      .setup-icon {
        width: 80px;
        height: 80px;
        margin-bottom: 1rem;
        animation: float 3s ease-in-out infinite;
      }

      h1 {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }

      p {
        color: var(--text-secondary);
      }
    }

    .setup-form {
      margin-bottom: 2rem;

      .form-group {
        margin-bottom: 2rem;

        label {
          display: block;
          font-weight: 500;
          margin-bottom: 0.75rem;
        }

        .setting-hint {
          margin-left: 1rem;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
      }
    }

    .setup-rules {
      background: var(--hover-bg);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;

      h3 {
        font-size: 1rem;
        margin-bottom: 0.75rem;
        color: var(--honey-700);
      }

      ul {
        margin: 0;
        padding-left: 1.25rem;
        color: var(--text-secondary);

        li {
          margin-bottom: 0.5rem;
          line-height: 1.5;
        }
      }
    }
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

.competition-container {
  .competition-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: var(--bg-card);
    border-radius: 16px;
    margin-bottom: 2rem;

    .score-display {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--honey-600);
    }

    .progress-display {
      font-size: 1rem;
      color: var(--text-secondary);
    }

    .timer-display {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.5rem;
      font-weight: 700;
      font-family: 'Courier New', Courier, monospace;

      &.timer--warning {
        color: var(--warning);
      }

      &.timer--danger {
        color: var(--error);
        animation: pulse 0.5s ease-in-out infinite;
      }
    }
  }

  .announcer-section {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 2rem;

    .announcer-avatar {
      width: 60px;
      height: 60px;
      flex-shrink: 0;

      img {
        width: 100%;
        height: 100%;
      }
    }

    .announcer-bubble {
      flex: 1;
      background: var(--bg-card);
      border-radius: 16px;
      border-top-left-radius: 4px;
      padding: 1rem 1.5rem;
      position: relative;

      .announcer-text {
        font-size: 1.1rem;
        color: var(--text-primary);
        margin: 0;
      }
    }
  }

  .word-section {
    text-align: center;
    margin-bottom: 2rem;

    .word-badge {
      margin-bottom: 1rem;
    }

    .word-mystery {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;

      .letter-slot {
        width: 48px;
        height: 60px;
        position: relative;
        background: var(--bg-card);
        border: 2px solid var(--charcoal-200);
        border-radius: 8px;
        transition: all 0.2s;

        &.slot-active {
          border-color: var(--honey-500);
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
        }

        &.slot-filled {
          background: var(--honey-50, #fffbeb);
          border-color: var(--honey-400);
          
          .letter-input {
            color: var(--charcoal-800);
          }
        }

        &.slot-correct {
          background: var(--success-light, #d1fae5);
          border-color: var(--success);
          
          .letter-input {
            color: var(--success);
          }
        }

        &.slot-wrong {
          background: var(--error-light, #fee2e2);
          border-color: var(--error);
          
          .letter-input {
            color: var(--error);
          }
        }

        .letter-input {
          width: 100%;
          height: 100%;
          border: none;
          background: transparent;
          text-align: center;
          font-size: 1.75rem;
          font-weight: 700;
          font-family: 'Courier New', Courier, monospace;
          text-transform: uppercase;
          outline: none;
          color: var(--charcoal-900);
        }

        .letter-hint {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--charcoal-300);
          pointer-events: none;
        }
      }
    }

    .voice-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;

      .voice-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: var(--text-secondary);
      }

      .voice-not-supported {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: var(--error-light, #fee2e2);
        border-radius: 20px;
        font-size: 0.85rem;
        color: var(--error);

        .t-icon {
          font-size: 1rem;
        }
      }

      .voice-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: var(--charcoal-100);
        border-radius: 20px;
        font-size: 0.9rem;
        color: var(--text-secondary);
        transition: background 0.3s, color 0.3s;
        width: 240px;

        &.voice-active {
          background: var(--honey-100);
          color: var(--honey-700);
          animation: pulse 1.5s ease-in-out infinite;
        }

        &.voice-spelling {
          background: var(--success-light, #d1fae5);
          color: var(--success);
        }

        .similarity-badge {
          padding: 0.15rem 0.5rem;
          border-radius: 10px;
          font-size: 0.8rem;
          font-weight: 600;
          min-width: 45px;
          text-align: center;

          &.similarity-perfect {
            background: var(--success);
            color: white;
          }

          &.similarity-good {
            background: var(--honey-500);
            color: white;
          }

          &.similarity-fair {
            background: var(--warning);
            color: white;
          }

          &.similarity-poor {
            background: var(--error);
            color: white;
          }
        }
      }
    }
  }

  .question-buttons {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 2rem;
  }

  .answer-section {
    background: var(--bg-card);
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 1rem;

    .action-buttons {
      display: flex;
      gap: 1rem;
      justify-content: center;
    }
  }

  .keyboard-hint {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;

    kbd {
      padding: 0.2rem 0.5rem;
      background: var(--charcoal-100);
      border-radius: 4px;
      font-family: monospace;
    }
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.results-container {
  .results-card {
    background: var(--bg-card);
    border-radius: 24px;
    padding: 3rem;
    box-shadow: var(--shadow-lg);

    .results-header {
      text-align: center;
      margin-bottom: 2rem;

      .results-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
      }

      h1 {
        font-size: 2rem;
      }
    }

    .results-score {
      display: flex;
      justify-content: center;
      margin-bottom: 2rem;

      .score-circle {
        width: 150px;
        height: 150px;
        border-radius: 50%;
        background: linear-gradient(
          135deg,
          var(--honey-400) 0%,
          var(--honey-500) 100%
        );
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: white;
        box-shadow: var(--shadow-glow);

        .score-value {
          font-size: 3rem;
          font-weight: 700;
          font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
        }

        .score-label {
          font-size: 0.9rem;
          opacity: 0.9;
        }
      }
    }

    .results-stats {
      display: flex;
      justify-content: center;
      gap: 2rem;
      flex-wrap: wrap;
      margin-bottom: 2rem;

      .stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;

        .t-icon {
          font-size: 1.5rem;
        }

        .text-success {
          color: var(--success);
        }
        .text-error {
          color: var(--error);
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
        }

        .stat-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
      }
    }

    .incorrect-words {
      background: var(--hover-bg);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;

      h3 {
        font-size: 1rem;
        margin-bottom: 1rem;
        color: var(--honey-700);
      }

      .word-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;

        .word-item {
          padding: 1rem;
          background: white;
          border-radius: 8px;
          border-left: 3px solid var(--error);

          .word-main {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.25rem;

            .correct-word {
              font-weight: 700;
              font-size: 1.1rem;
              color: var(--charcoal-900);
            }
          }

          .word-user {
            font-size: 0.9rem;
            color: var(--text-secondary);
            margin-bottom: 0.25rem;

            .wrong {
              color: var(--error);
              text-decoration: line-through;
            }

            .skip {
              color: var(--warning);
              font-style: italic;
            }
          }

          .word-def {
            font-size: 0.85rem;
            color: var(--text-muted);
          }

          .word-def-cn {
            font-size: 0.85rem;
            color: var(--charcoal-600);
            margin-top: 0.25rem;
          }
        }
      }
    }

    .results-actions {
      display: flex;
      justify-content: center;
      gap: 1rem;
    }
  }
}

@media (max-width: 768px) {
  .setup-container .setup-card {
    padding: 1.5rem;
  }

  .competition-container {
    .competition-header {
      flex-wrap: wrap;
      gap: 1rem;
      justify-content: center;
    }

    .word-section .word-mystery .letter-slot {
      width: 36px;
      height: 48px;
      
      .letter-input {
        font-size: 1.25rem;
      }
    }

    .question-buttons {
      gap: 0.5rem;

      .t-button {
        padding: 0.5rem 0.75rem;
        font-size: 0.85rem;
      }
    }
  }

  .results-container .results-card {
    padding: 1.5rem;

    .results-stats {
      gap: 1rem;
    }
  }
}
</style>
