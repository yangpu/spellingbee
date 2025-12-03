<template>
  <div class="competition-page">
    <!-- Pre-competition setup -->
    <div
      class="setup-container"
      v-if="!competitionStore.isActive && !showResults"
    >
      <div class="setup-card">
        <div class="setup-header">
          <img src="/bee.svg" alt="Bee" class="setup-icon" />
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
        </div>

        <div class="setup-rules">
          <h3>比赛规则</h3>
          <ul>
            <li>发音官会朗读单词，你需要在界面上正确拼写</li>
            <li>每个单词有 {{ settings.timeLimit }} 秒答题时间</li>
            <li>可以点击按钮询问发音、释义、词性和例句</li>
            <li>拼写错误或超时即淘汰（本轮结束）</li>
            <li>正确拼写得分，根据难度和剩余时间有加成</li>
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
          <img src="/bee.svg" alt="Announcer" />
        </div>
        <div class="announcer-bubble">
          <p class="announcer-text">{{ announcerMessage }}</p>
        </div>
      </div>

      <!-- Word display (hidden) -->
      <div class="word-section">
        <div class="word-badge">
          <t-tag theme="warning" variant="light">
            难度: {{ '⭐'.repeat(currentWord?.difficulty || 1) }}
          </t-tag>
        </div>
        <div class="word-mystery">
          <span v-for="(char, i) in wordHint" :key="i" class="letter-slot">
            {{ char }}
          </span>
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
          <template #icon><t-icon name="books" /></template>
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

      <!-- Answer input -->
      <div class="answer-section">
        <div class="input-wrapper">
          <t-input
            ref="answerInput"
            v-model="userAnswer"
            placeholder="请输入单词拼写..."
            size="large"
            :status="inputStatus"
            :tips="inputTips"
            @keyup.enter="submitAnswer"
            autofocus
          />
        </div>
        <div class="action-buttons">
          <t-button variant="outline" size="large" @click="skipWord">
            跳过
          </t-button>
          <t-button
            theme="primary"
            size="large"
            @click="submitAnswer"
            :disabled="!userAnswer.trim()"
          >
            提交答案
          </t-button>
        </div>
      </div>

      <!-- Keyboard hint -->
      <div class="keyboard-hint">按 <kbd>Enter</kbd> 提交答案</div>
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

const wordsStore = useWordsStore();
const competitionStore = useCompetitionStore();

// Settings
const settings = reactive({
  wordCount: 10,
  timeLimit: 60,
  difficulty: null,
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
const userAnswer = ref('');
const answerInput = ref(null);
const timerInterval = ref(null);
const announcerMessage = ref('准备好了吗？让我们开始吧！');
const inputStatus = ref('default');
const inputTips = ref('');

const askedQuestions = reactive({
  pronunciation: false,
  definition: false,
  partOfSpeech: false,
  example: false,
});

// Computed
const currentWord = computed(() => competitionStore.currentWord);

const wordHint = computed(() => {
  if (!currentWord.value) return [];
  // Show first letter and underscores for the rest
  const word = currentWord.value.word;
  return word.split('').map((char, i) => (i === 0 ? char.toUpperCase() : '_'));
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
  userAnswer.value = '';
  inputStatus.value = 'default';
  inputTips.value = '';
  resetAskedQuestions();

  // Start with word announcement
  announceWord();

  // Start timer
  startTimer();

  // Focus input
  await nextTick();
  answerInput.value?.focus();
}

function announceWord() {
  if (!currentWord.value) return;

  announcerMessage.value = `请拼写单词...`;

  // Speak the word
  setTimeout(() => {
    speakWord(currentWord.value.word);
  }, 500);
}

function speakWord(word) {
  speechSynthesis.cancel(); // Cancel any ongoing speech
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.7;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

function repeatWord() {
  if (currentWord.value) {
    speakWord(currentWord.value.word);
    announcerMessage.value = `我再说一遍...`;
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
      break;
    case 'definition':
      announcerMessage.value = `释义: ${currentWord.value.definition}`;
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
      // Time's up
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
  competitionStore.timeOut();

  inputStatus.value = 'error';
  inputTips.value = `时间到！正确答案是: ${currentWord.value?.word}`;
  announcerMessage.value = `很遗憾，时间到了。正确答案是 "${currentWord.value?.word}"`;

  // Show correct answer briefly, then move on or end
  setTimeout(() => {
    moveToNextOrEnd();
  }, 2000);
}

async function submitAnswer() {
  if (!userAnswer.value.trim() || !currentWord.value) return;

  const isCorrect = competitionStore.checkAnswer(userAnswer.value);

  if (isCorrect) {
    inputStatus.value = 'success';
    inputTips.value = '回答正确！';
    announcerMessage.value = `太棒了！"${currentWord.value.word}" 拼写正确！`;

    // Play success sound (using speech)
    const congrats = new SpeechSynthesisUtterance('Correct!');
    congrats.lang = 'en-US';
    congrats.rate = 1;
    speechSynthesis.speak(congrats);
  } else {
    inputStatus.value = 'error';
    inputTips.value = `错误！正确答案是: ${currentWord.value.word}`;
    announcerMessage.value = `很遗憾，正确答案是 "${currentWord.value.word}"`;
  }

  stopTimer();

  // Move to next word or end
  setTimeout(() => {
    moveToNextOrEnd();
  }, 2000);
}

function skipWord() {
  stopTimer();
  competitionStore.skipWord();
  announcerMessage.value = `跳过了这个单词。正确答案是 "${currentWord.value?.word}"`;

  setTimeout(() => {
    moveToNextOrEnd();
  }, 1500);
}

async function moveToNextOrEnd() {
  if (competitionStore.nextWord()) {
    // Reset for next word
    userAnswer.value = '';
    inputStatus.value = 'default';
    inputTips.value = '';
    resetAskedQuestions();

    // Announce new word
    announceWord();
    startTimer();

    await nextTick();
    answerInput.value?.focus();
  } else {
    // Competition ended
    await endCompetition();
  }
}

async function endCompetition() {
  stopTimer();
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

// Lifecycle
onMounted(() => {
  wordsStore.init();
});

onUnmounted(() => {
  stopTimer();
  speechSynthesis.cancel();
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

      .letter-slot {
        width: 40px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        font-weight: 700;
        font-family: 'Courier New', Courier, monospace;
        background: var(--honey-100);
        border: 2px solid var(--honey-300);
        border-radius: 8px;
        text-transform: uppercase;
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

    .input-wrapper {
      margin-bottom: 1rem;
    }

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
      width: 32px;
      height: 40px;
      font-size: 1.25rem;
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
