<template>
  <div class="challenge-room">
    <!-- 等待/准备阶段 -->
    <div class="room-waiting" v-if="challengeStore.gameStatus === 'waiting' || challengeStore.gameStatus === 'ready'">
      <div class="room-header">
        <t-button variant="text" @click="handleLeave">
          <template #icon><t-icon name="chevron-left" /></template>
          返回列表
        </t-button>
        <div class="room-title">
          <h2>{{ challenge?.name }}</h2>
          <t-tag :theme="statusTheme" variant="light">{{ statusText }}</t-tag>
        </div>
        <div class="room-actions" v-if="challengeStore.isCreator">
          <t-button variant="outline" theme="danger" size="small" @click="handleCancel">
            取消挑战赛
          </t-button>
        </div>
      </div>

      <div class="room-info">
        <div class="info-card">
          <div class="info-label">参赛积分</div>
          <div class="info-value">{{ challenge?.entry_fee }} <t-icon name="star" /></div>
        </div>
        <div class="info-card">
          <div class="info-label">单词数量</div>
          <div class="info-value">{{ challenge?.word_count }} 词</div>
        </div>
        <div class="info-card">
          <div class="info-label">答题时间</div>
          <div class="info-value">{{ challenge?.time_limit }}s</div>
        </div>
        <div class="info-card">
          <div class="info-label">奖池</div>
          <div class="info-value prize">{{ challenge?.prize_pool }} <t-icon name="gift" /></div>
        </div>
      </div>

      <div class="participants-section">
        <h3>参赛选手 ({{ challenge?.participants?.length || 0 }}/{{ challenge?.max_participants }})</h3>
        <div class="participants-grid">
          <div 
            class="participant-card"
            v-for="p in challenge?.participants"
            :key="p.user_id"
            :class="{ 'is-me': p.user_id === authStore.user?.id, 'is-creator': p.user_id === challenge?.creator_id }"
          >
            <div class="participant-avatar">
              <t-avatar :image="p.avatar_url" size="large">
                {{ p.nickname?.charAt(0) }}
              </t-avatar>
              <div class="online-status" :class="{ online: p.is_online }"></div>
            </div>
            <div class="participant-info">
              <div class="participant-name">
                {{ p.nickname }}
                <t-tag v-if="p.user_id === challenge?.creator_id" size="small" theme="warning">房主</t-tag>
              </div>
              <div class="participant-status">
                <t-icon :name="p.is_ready ? 'check-circle' : 'time'" :class="{ ready: p.is_ready }" />
                {{ p.is_ready ? '已准备' : '未准备' }}
              </div>
            </div>
          </div>

          <!-- 空位 -->
          <div 
            class="participant-card empty"
            v-for="i in emptySlots"
            :key="'empty-' + i"
          >
            <div class="empty-slot">
              <t-icon name="user-add" size="32px" />
              <span>等待加入</span>
            </div>
          </div>
        </div>
      </div>

      <div class="room-actions-bottom">
        <div v-if="!challengeStore.isCreator" class="ready-section">
          <t-button 
            :theme="challengeStore.myParticipant?.is_ready ? 'default' : 'primary'"
            size="large"
            @click="handleToggleReady"
          >
            <template #icon>
              <t-icon :name="challengeStore.myParticipant?.is_ready ? 'close' : 'check'" />
            </template>
            {{ challengeStore.myParticipant?.is_ready ? '取消准备' : '准备比赛' }}
          </t-button>
          <div class="ready-hint" v-if="challengeStore.myParticipant?.is_ready">
            <t-icon name="time" />
            等待主持人开始比赛...
          </div>
        </div>
        <div v-if="challengeStore.isCreator" class="start-section">
          <t-button
            theme="primary"
            size="large"
            :disabled="!challengeStore.canStart"
            @click="handleStart"
            :loading="starting"
          >
            <template #icon><t-icon name="play-circle" /></template>
            开始比赛
          </t-button>
          <div class="start-hint" v-if="!challengeStore.canStart">
            <span v-if="challenge?.participants?.length < 2">等待更多玩家加入（至少2人）</span>
            <span v-else-if="!challengeStore.allReady">等待所有玩家确认参赛</span>
            <span v-else-if="!challengeStore.allOnline">等待所有玩家上线</span>
          </div>
        </div>
      </div>

      <div class="connection-status">
        <div class="status-dot" :class="challengeStore.connectionStatus"></div>
        <span>{{ connectionStatusText }}</span>
      </div>
    </div>

    <!-- 比赛进行中 -->
    <div class="room-playing" v-else-if="challengeStore.gameStatus === 'playing' || challengeStore.gameStatus === 'round_result'">
      <!-- 顶部信息栏 -->
      <div class="game-header">
        <div class="game-title">{{ challenge?.name }}</div>
        <div class="round-info">
          第 {{ challengeStore.currentRound }} / {{ challenge?.word_count }} 轮
        </div>
        <div class="timer" :class="{ warning: challengeStore.roundTimeRemaining <= 10 }">
          <t-icon name="time" />
          {{ challengeStore.roundTimeRemaining }}s
        </div>
      </div>

      <!-- 参赛者得分 -->
      <div class="scoreboard">
        <div 
          class="score-item"
          v-for="(p, index) in challengeStore.sortedParticipants"
          :key="p.user_id"
          :class="{ 'is-me': p.user_id === authStore.user?.id, 'is-leader': index === 0 }"
        >
          <div class="score-rank">{{ index + 1 }}</div>
          <t-avatar :image="p.avatar_url" size="small">{{ p.nickname?.charAt(0) }}</t-avatar>
          <span class="score-name">{{ p.nickname }}</span>
          <span class="score-value">{{ p.score }}</span>
        </div>
      </div>

      <!-- 单词区域 -->
      <div class="word-section" v-if="challengeStore.gameStatus === 'playing'">
        <div class="word-prompt">
          <div class="word-badge">
            <t-tag theme="warning" variant="light">
              难度: {{ '⭐'.repeat(challengeStore.currentWord?.difficulty || 1) }}
            </t-tag>
            <t-tag v-if="challengeStore.currentWord?.pos" variant="light">
              {{ challengeStore.currentWord?.pos }}
            </t-tag>
            <t-button variant="text" size="small" @click="repeatWord">
              <template #icon><t-icon name="sound" /></template>
              重复
            </t-button>
          </div>
          <div class="word-definition">
            {{ challengeStore.currentWord?.definition_cn || challengeStore.currentWord?.definition }}
          </div>
          <div class="word-definition-en" v-if="challengeStore.currentWord?.definition">
            {{ challengeStore.currentWord?.definition }}
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="input-section">
          <div class="letter-slots">
            <div
              v-for="(slot, i) in letterSlots"
              :key="i"
              class="letter-slot"
              :class="{
                'slot-active': i === currentLetterIndex,
                'slot-filled': slot.value,
                'slot-correct': slot.status === 'correct',
                'slot-wrong': slot.status === 'wrong'
              }"
              @click="focusInput(i)"
            >
              <input
                :ref="el => letterInputRefs[i] = el"
                type="text"
                maxlength="1"
                :value="slot.value"
                @input="handleInput($event, i)"
                @keydown="handleKeydown($event, i)"
                autocomplete="off"
                autocapitalize="off"
              />
              <span class="letter-hint" v-if="i === 0 && !slot.value">
                {{ challengeStore.currentWord?.word[0]?.toUpperCase() }}
              </span>
            </div>
          </div>

          <div class="submit-section">
            <t-button
              theme="primary"
              size="large"
              :disabled="!canSubmit || challengeStore.hasSubmitted"
              @click="handleSubmit"
            >
              <template #icon><t-icon :name="challengeStore.hasSubmitted ? 'check' : 'send'" /></template>
              {{ challengeStore.hasSubmitted ? '已提交' : '提交答案' }}
            </t-button>
          </div>
        </div>
      </div>

      <!-- 轮次结果 -->
      <div class="round-result" v-else-if="challengeStore.gameStatus === 'round_result'">
        <div class="result-word">
          <span class="correct-word">{{ challengeStore.currentWord?.word }}</span>
          <span class="word-pronunciation">{{ challengeStore.currentWord?.pronunciation }}</span>
        </div>
        <div class="result-list">
          <div 
            class="result-item"
            v-for="result in challengeStore.roundResults"
            :key="result.user_id"
            :class="{ correct: result.is_correct, wrong: !result.is_correct }"
          >
            <t-icon :name="result.is_correct ? 'check-circle' : 'close-circle'" />
            <span class="result-user">{{ getParticipantName(result.user_id) }}</span>
            <span class="result-answer">{{ result.answer || '未作答' }}</span>
            <span class="result-time">{{ (result.time_taken / 1000).toFixed(1) }}s</span>
          </div>
        </div>
        <div class="next-round-hint">
          下一轮即将开始...
        </div>
      </div>
    </div>

    <!-- 比赛结束 -->
    <div class="room-finished" v-else-if="challengeStore.gameStatus === 'finished'">
      <!-- 返回按钮 -->
      <div class="finish-nav">
        <t-button variant="text" @click="handleLeaveFinished">
          <template #icon><t-icon name="chevron-left" /></template>
          返回列表
        </t-button>
      </div>

      <!-- 比赛信息卡片 -->
      <div class="finish-card">
        <div class="finish-card-header">
          <div class="challenge-cover" v-if="challenge?.image_url">
            <img :src="challenge.image_url" alt="" />
          </div>
          <div class="challenge-cover placeholder" v-else>
            <t-icon name="trophy" size="40px" />
          </div>
          <div class="challenge-info">
            <h1 class="challenge-name">{{ challenge?.name }}</h1>
            <div class="challenge-tags">
              <t-tag size="small" variant="light">{{ challenge?.word_count }} 词</t-tag>
              <t-tag size="small" variant="light">{{ challenge?.time_limit }}s/题</t-tag>
              <t-tag size="small" variant="light" v-if="challenge?.difficulty">难度 {{ getDifficultyText(challenge?.difficulty) }}</t-tag>
              <t-tag size="small" variant="light" theme="warning">{{ challenge?.entry_fee }} 积分</t-tag>
            </div>
            <div class="challenge-time">
              <span><t-icon name="time" /> {{ formatDateTime(challenge?.created_at) }} 创建</span>
              <span v-if="challenge?.finished_at"><t-icon name="check-circle" /> {{ formatDateTime(challenge?.finished_at) }} 结束</span>
            </div>
          </div>
        </div>

        <!-- 冠军区域 -->
        <div class="winner-banner" v-if="challenge?.winner_id">
          <div class="winner-decoration">🏆</div>
          <div class="winner-content">
            <t-avatar :image="getWinnerAvatar()" size="64px">
              {{ challenge?.winner_name?.charAt(0) }}
            </t-avatar>
            <div class="winner-info">
              <div class="winner-label">🎉 冠军</div>
              <div class="winner-name">{{ challenge?.winner_name }}</div>
              <div class="winner-prize">
                获得 <strong>{{ challenge?.prize_pool || (challenge?.entry_fee * challenge?.participants?.length) }}</strong> 积分
              </div>
            </div>
          </div>
        </div>

        <!-- 最终排名 -->
        <div class="final-ranking">
          <div class="section-title">最终排名</div>
          <div class="ranking-list">
            <div 
              class="ranking-item"
              v-for="(p, index) in challengeStore.sortedParticipants"
              :key="p.user_id"
              :class="{ 'is-winner': index === 0, 'is-me': p.user_id === authStore.user?.id }"
            >
              <div class="rank-num" :class="'rank-' + (index + 1)">{{ index + 1 }}</div>
              <t-avatar :image="p.avatar_url" size="36px">{{ p.nickname?.charAt(0) }}</t-avatar>
              <span class="player-name">{{ p.nickname }}</span>
              <span class="player-score">{{ p.score }} 分</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 比赛记录详情 -->
      <div class="records-card" v-if="challengeStore.gameWords.length > 0">
        <div class="records-toggle" @click="showRecords = !showRecords">
          <span class="section-title">
            <t-icon name="file-paste" />
            比赛记录 ({{ challengeStore.gameWords.length }} 轮)
          </span>
          <t-icon :name="showRecords ? 'chevron-up' : 'chevron-down'" />
        </div>
        <div class="records-content" v-if="showRecords">
          <div 
            class="record-item"
            v-for="(gameWord, index) in challengeStore.gameWords"
            :key="index"
          >
            <div class="record-word-row">
              <span class="round-num">{{ index + 1 }}</span>
              <span class="word-text">{{ gameWord.word.word }}</span>
              <span class="word-phonetic">{{ gameWord.word.pronunciation }}</span>
              <t-button variant="text" size="small" @click.stop="speakWord(gameWord.word.word)">
                <template #icon><t-icon name="sound" /></template>
              </t-button>
            </div>
            <div class="record-definition">{{ gameWord.word.definition_cn || gameWord.word.definition }}</div>
            <div class="record-answers" v-if="gameWord.results?.length > 0">
              <div 
                class="answer-item"
                v-for="result in gameWord.results"
                :key="result.user_id"
                :class="{ correct: result.is_correct, timeout: !result.answer }"
              >
                <t-icon :name="result.is_correct ? 'check-circle-filled' : (result.answer ? 'close-circle-filled' : 'time-filled')" />
                <span class="answer-player">{{ getParticipantName(result.user_id) }}</span>
                <span class="answer-text">{{ result.answer || '未作答' }}</span>
                <span class="answer-time">{{ (result.time_taken / 1000).toFixed(1) }}s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useChallengeStore } from '@/stores/challenge'
import { useSpeechStore } from '@/stores/speech'

const authStore = useAuthStore()
const challengeStore = useChallengeStore()
const speechStore = useSpeechStore()

const starting = ref(false)
const letterSlots = ref([])
const letterInputRefs = ref([])
const currentLetterIndex = ref(0)
const showRecords = ref(false) // 是否显示比赛记录

const challenge = computed(() => challengeStore.currentChallenge)

const statusTheme = computed(() => {
  const map = {
    waiting: 'warning',
    ready: 'success',
    in_progress: 'primary',
    finished: 'default',
    cancelled: 'danger'
  }
  return map[challenge.value?.status] || 'default'
})

const statusText = computed(() => {
  const map = {
    waiting: '等待中',
    ready: '准备就绪',
    in_progress: '进行中',
    finished: '已结束',
    cancelled: '已取消'
  }
  return map[challenge.value?.status] || ''
})

const emptySlots = computed(() => {
  if (!challenge.value) return 0
  return Math.max(0, challenge.value.max_participants - (challenge.value.participants?.length || 0))
})

const connectionStatusText = computed(() => {
  const map = {
    disconnected: '未连接',
    connecting: '连接中...',
    connected: '已连接'
  }
  return map[challengeStore.connectionStatus] || ''
})

const canSubmit = computed(() => {
  return letterSlots.value.every(slot => slot.value)
})

// 监听当前单词变化，初始化输入框并播放语音
watch(() => challengeStore.currentWord, (word) => {
  if (word) {
    letterSlots.value = word.word.split('').map(() => ({
      value: '',
      status: 'empty'
    }))
    currentLetterIndex.value = 0
    nextTick(() => {
      if (letterInputRefs.value[0]) {
        letterInputRefs.value[0].focus()
      }
      // 播放单词发音
      speakWord(word.word)
    })
  }
}, { immediate: true })

// 播放单词发音
function speakWord(word) {
  speechStore.speakWord(word)
}

// 重复播放当前单词
function repeatWord() {
  if (challengeStore.currentWord) {
    speakWord(challengeStore.currentWord.word)
  }
}

function getParticipantName(userId) {
  const p = challenge.value?.participants?.find(p => p.user_id === userId)
  return p?.nickname || '未知'
}

function getWinnerAvatar() {
  const winner = challenge.value?.participants?.find(p => p.user_id === challenge.value?.winner_id)
  return winner?.avatar_url
}

// 获取难度文本
function getDifficultyText(difficulty) {
  if (!difficulty) return '全部'
  const map = { 1: '简单', 2: '较易', 3: '中等', 4: '较难', 5: '困难' }
  return map[difficulty] || '全部'
}

// 格式化日期时间
function formatDateTime(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${month}月${day}日 ${hours}:${minutes}`
}

function focusInput(index) {
  currentLetterIndex.value = index
  letterInputRefs.value[index]?.focus()
}

function handleInput(event, index) {
  const value = event.target.value.toLowerCase().replace(/[^a-z]/g, '')
  
  if (value) {
    letterSlots.value[index].value = value
    
    // 检查是否正确
    const correctLetter = challengeStore.currentWord?.word[index]?.toLowerCase()
    letterSlots.value[index].status = value === correctLetter ? 'correct' : 'wrong'
    
    // 移动到下一个
    if (index < letterSlots.value.length - 1) {
      currentLetterIndex.value = index + 1
      nextTick(() => {
        letterInputRefs.value[index + 1]?.focus()
      })
    } else {
      // 最后一个，检查是否自动提交
      nextTick(() => {
        if (canSubmit.value && !challengeStore.hasSubmitted) {
          handleSubmit()
        }
      })
    }
  }
  
  event.target.value = letterSlots.value[index].value
}

function handleKeydown(event, index) {
  if (event.key === 'Backspace') {
    event.preventDefault()
    
    if (letterSlots.value[index].value) {
      letterSlots.value[index].value = ''
      letterSlots.value[index].status = 'empty'
    } else if (index > 0) {
      currentLetterIndex.value = index - 1
      letterSlots.value[index - 1].value = ''
      letterSlots.value[index - 1].status = 'empty'
      nextTick(() => {
        letterInputRefs.value[index - 1]?.focus()
      })
    }
  } else if (event.key === 'Enter' && canSubmit.value) {
    handleSubmit()
  } else if (event.key === 'ArrowLeft' && index > 0) {
    currentLetterIndex.value = index - 1
    letterInputRefs.value[index - 1]?.focus()
  } else if (event.key === 'ArrowRight' && index < letterSlots.value.length - 1) {
    currentLetterIndex.value = index + 1
    letterInputRefs.value[index + 1]?.focus()
  }
}

function handleSubmit() {
  if (!canSubmit.value || challengeStore.hasSubmitted) return
  
  const answer = letterSlots.value.map(s => s.value).join('')
  challengeStore.submitAnswer(answer)
}

async function handleStart() {
  starting.value = true
  try {
    await challengeStore.startGame()
  } catch (error) {
    MessagePlugin.error(error.message || '开始失败')
  } finally {
    starting.value = false
  }
}

function handleLeave() {
  const dialog = DialogPlugin.confirm({
    header: '确认离开',
    body: '确定要离开挑战赛吗？',
    confirmBtn: { content: '确认', theme: 'danger' },
    onConfirm: async () => {
      await challengeStore.leaveChallenge()
      dialog.destroy()
    },
    onClose: () => dialog.destroy()
  })
}

// 比赛结束后直接离开，不需要确认
async function handleLeaveFinished() {
  await challengeStore.leaveChallenge(true)
}

function handleCancel() {
  const dialog = DialogPlugin.confirm({
    header: '确认取消',
    body: '确定要取消这场挑战赛吗？所有参与者都将被移出。',
    confirmBtn: { content: '确认取消', theme: 'danger' },
    onConfirm: async () => {
      await challengeStore.cancelChallenge()
      dialog.destroy()
    },
    onClose: () => dialog.destroy()
  })
}

function handleToggleReady() {
  console.log('handleToggleReady called')
  challengeStore.toggleReady()
}

onUnmounted(() => {
  // 组件卸载时不自动离开，保持连接
})
</script>

<style lang="scss" scoped>
.challenge-room {
  max-width: 800px;
  margin: 0 auto;
}

// 等待阶段
.room-waiting {
  .room-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;

    .room-title {
      display: flex;
      align-items: center;
      gap: 1rem;

      h2 {
        margin: 0;
      }
    }
  }

  .room-info {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;

    .info-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1rem;
      text-align: center;

      .info-label {
        font-size: 0.85rem;
        color: var(--text-secondary);
        margin-bottom: 0.5rem;
      }

      .info-value {
        font-size: 1.25rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;

        &.prize {
          color: var(--honey-600);
        }
      }
    }
  }

  .participants-section {
    background: var(--bg-card);
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 2rem;

    h3 {
      margin: 0 0 1rem;
    }

    .participants-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }

    .participant-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      background: var(--hover-bg);
      border-radius: 12px;
      border: 2px solid transparent;

      &.is-me {
        border-color: var(--honey-400);
        background: var(--honey-50);
      }

      .participant-avatar {
        position: relative;

        .online-status {
          position: absolute;
          bottom: 2px;
          right: 2px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--charcoal-300);
          border: 2px solid white;

          &.online {
            background: var(--success);
          }
        }
      }

      .participant-info {
        flex: 1;

        .participant-name {
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .participant-status {
          font-size: 0.85rem;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 0.25rem;

          .ready {
            color: var(--success);
          }
        }
      }

      &.empty {
        .empty-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          color: var(--text-muted);
        }
      }
    }
  }

  .room-actions-bottom {
    display: flex;
    justify-content: center;
    margin-bottom: 1rem;

    .ready-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;

      .ready-hint {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: var(--honey-600);
        animation: pulse 1.5s ease-in-out infinite;
      }
    }

    .start-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;

      .start-hint {
        font-size: 0.85rem;
        color: var(--text-secondary);
      }
    }
  }

  .connection-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-secondary);

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--charcoal-300);

      &.connecting {
        background: var(--warning);
        animation: pulse 1s infinite;
      }

      &.connected {
        background: var(--success);
      }
    }
  }
}

// 比赛进行中
.room-playing {
  .game-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: var(--bg-card);
    border-radius: 12px;
    margin-bottom: 1.5rem;

    .game-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .round-info {
      font-size: 1.1rem;
      font-weight: 500;
    }

    .timer {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.5rem;
      font-weight: 700;
      font-family: monospace;

      &.warning {
        color: var(--error);
        animation: pulse 0.5s infinite;
      }
    }
  }

  .scoreboard {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 2rem;

    .score-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--bg-card);
      border-radius: 20px;
      border: 2px solid transparent;

      &.is-me {
        border-color: var(--honey-400);
      }

      &.is-leader {
        background: linear-gradient(135deg, var(--honey-100) 0%, var(--honey-200) 100%);
      }

      .score-rank {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--charcoal-200);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .score-name {
        font-weight: 500;
      }

      .score-value {
        font-weight: 700;
        color: var(--honey-600);
      }
    }
  }

  .word-section {
    background: var(--bg-card);
    border-radius: 16px;
    padding: 2rem;

    .word-prompt {
      text-align: center;
      margin-bottom: 2rem;

      .word-badge {
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
      }

      .word-definition {
        font-size: 1.25rem;
        color: var(--text-primary);
        margin-bottom: 0.5rem;
      }

      .word-definition-en {
        font-size: 0.95rem;
        color: var(--text-secondary);
        font-style: italic;
      }
    }

    .input-section {
      .letter-slots {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-bottom: 2rem;

        .letter-slot {
          width: 48px;
          height: 60px;
          position: relative;
          background: var(--hover-bg);
          border: 2px solid var(--charcoal-200);
          border-radius: 8px;
          transition: all 0.2s;

          &.slot-active {
            border-color: var(--honey-500);
            box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
          }

          &.slot-filled {
            background: var(--honey-50);
            border-color: var(--honey-400);
          }

          &.slot-correct {
            background: var(--success-light, #d1fae5);
            border-color: var(--success);

            input {
              color: var(--success);
            }
          }

          &.slot-wrong {
            background: var(--error-light, #fee2e2);
            border-color: var(--error);

            input {
              color: var(--error);
            }
          }

          input {
            width: 100%;
            height: 100%;
            border: none;
            background: transparent;
            text-align: center;
            font-size: 1.75rem;
            font-weight: 700;
            text-transform: uppercase;
            outline: none;
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

      .submit-section {
        display: flex;
        justify-content: center;
      }
    }
  }

  .round-result {
    background: var(--bg-card);
    border-radius: 16px;
    padding: 2rem;
    text-align: center;

    .result-word {
      margin-bottom: 1.5rem;

      .correct-word {
        font-size: 2rem;
        font-weight: 700;
        color: var(--success);
      }

      .word-pronunciation {
        display: block;
        color: var(--text-secondary);
        margin-top: 0.25rem;
      }
    }

    .result-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1.5rem;

      .result-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background: var(--hover-bg);
        border-radius: 8px;

        &.correct {
          background: var(--success-light, #d1fae5);
          color: var(--success);
        }

        &.wrong {
          color: var(--error);
        }

        .result-user {
          flex: 1;
          text-align: left;
          font-weight: 500;
        }

        .result-answer {
          font-family: monospace;
        }

        .result-time {
          color: var(--text-secondary);
          font-size: 0.85rem;
        }
      }
    }

    .next-round-hint {
      color: var(--text-secondary);
      animation: pulse 1s infinite;
    }
  }
}

// 比赛结束
.room-finished {
  padding: 1rem 0;

  .finish-nav {
    margin-bottom: 1rem;
  }

  .section-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .finish-card {
    background: var(--bg-card);
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 1rem;

    .finish-card-header {
      display: flex;
      gap: 1rem;
      padding: 1.25rem;
      border-bottom: 1px solid var(--charcoal-100);

      .challenge-cover {
        width: 100px;
        height: 70px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        background: linear-gradient(135deg, var(--honey-400) 0%, var(--honey-500) 100%);

        &.placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }

      .challenge-info {
        flex: 1;
        min-width: 0;

        .challenge-name {
          margin: 0 0 0.5rem;
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .challenge-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .challenge-time {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          font-size: 0.8rem;
          color: var(--text-muted);

          span {
            display: flex;
            align-items: center;
            gap: 0.25rem;
          }
        }
      }
    }

    .winner-banner {
      background: linear-gradient(135deg, var(--honey-100) 0%, var(--honey-200) 100%);
      padding: 1.25rem;
      position: relative;
      overflow: hidden;

      .winner-decoration {
        position: absolute;
        right: 1rem;
        top: 50%;
        transform: translateY(-50%);
        font-size: 3rem;
        opacity: 0.3;
      }

      .winner-content {
        display: flex;
        align-items: center;
        gap: 1rem;
        position: relative;
        z-index: 1;

        .winner-info {
          .winner-label {
            font-size: 0.85rem;
            color: var(--honey-700);
            margin-bottom: 0.25rem;
          }

          .winner-name {
            font-size: 1.1rem;
            font-weight: 700;
            color: var(--text-primary);
          }

          .winner-prize {
            font-size: 0.9rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;

            strong {
              color: var(--honey-600);
              font-size: 1rem;
            }
          }
        }
      }
    }

    .final-ranking {
      padding: 1.25rem;

      .section-title {
        margin-bottom: 0.75rem;
      }

      .ranking-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;

        .ranking-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.6rem 0.75rem;
          background: var(--hover-bg);
          border-radius: 8px;
          border: 2px solid transparent;

          &.is-winner {
            background: linear-gradient(135deg, var(--honey-50) 0%, var(--honey-100) 100%);
          }

          &.is-me {
            border-color: var(--honey-400);
          }

          .rank-num {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            font-weight: 700;
            background: var(--charcoal-200);
            color: var(--text-primary);

            &.rank-1 {
              background: linear-gradient(135deg, #ffd700 0%, #ffb800 100%);
              color: white;
            }

            &.rank-2 {
              background: linear-gradient(135deg, #c0c0c0 0%, #a0a0a0 100%);
              color: white;
            }

            &.rank-3 {
              background: linear-gradient(135deg, #cd7f32 0%, #b87333 100%);
              color: white;
            }
          }

          .player-name {
            flex: 1;
            font-size: 0.9rem;
            font-weight: 500;
          }

          .player-score {
            font-size: 0.9rem;
            font-weight: 700;
            color: var(--honey-600);
          }
        }
      }
    }
  }

  .records-card {
    background: var(--bg-card);
    border-radius: 16px;
    overflow: hidden;

    .records-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      cursor: pointer;
      transition: background 0.2s;

      &:hover {
        background: var(--hover-bg);
      }
    }

    .records-content {
      border-top: 1px solid var(--charcoal-100);
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;

      .record-item {
        padding: 0.75rem;
        background: var(--hover-bg);
        border-radius: 8px;

        .record-word-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;

          .round-num {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: var(--charcoal-200);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 600;
            flex-shrink: 0;
          }

          .word-text {
            font-size: 1.1rem;
            font-weight: 700;
            color: var(--text-primary);
          }

          .word-phonetic {
            font-size: 0.85rem;
            color: var(--text-secondary);
          }
        }

        .record-definition {
          font-size: 0.85rem;
          color: var(--text-secondary);
          margin-bottom: 0.75rem;
          padding-left: 30px;
        }

        .record-answers {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding-left: 30px;

          .answer-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0.6rem;
            border-radius: 4px;
            font-size: 0.85rem;
            background: white;

            &.correct {
              background: var(--success-light, #d1fae5);
              color: var(--success);
            }

            &.timeout {
              background: var(--warning-light, #fef3c7);
              color: var(--warning, #d97706);
            }

            &:not(.correct):not(.timeout) {
              background: var(--error-light, #fee2e2);
              color: var(--error);
            }

            .answer-player {
              font-weight: 500;
              min-width: 60px;
              color: var(--text-primary);
            }

            .answer-text {
              flex: 1;
              font-family: monospace;
            }

            .answer-time {
              font-family: monospace;
              font-size: 0.8rem;
              opacity: 0.8;
            }
          }
        }
      }
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (max-width: 768px) {
  .room-waiting {
    .room-info {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .room-playing {
    .word-section .input-section .letter-slots .letter-slot {
      width: 36px;
      height: 48px;

      input {
        font-size: 1.25rem;
      }
    }
  }
}
</style>
