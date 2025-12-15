<template>
  <div class="challenge-room">
    <!-- 等待/准备阶段 -->
    <div class="room-waiting" v-if="challengeStore.gameStatus === 'waiting' || challengeStore.gameStatus === 'ready'">
      <div class="room-header">
        <div class="room-header-top">
          <t-button variant="text" @click="handleLeave">
            <template #icon><t-icon name="chevron-left" /></template>
            返回列表
          </t-button>
          <div class="room-actions" v-if="challengeStore.isCreator">
            <t-button variant="outline" theme="danger" size="small" @click="handleCancel">
              取消挑战赛
            </t-button>
          </div>
        </div>
        <div class="room-header-main" :class="{ 'has-cover': getCoverUrl(challenge?.image_url) }">
          <!-- 背景图片 -->
          <div class="header-background" v-if="getCoverUrl(challenge?.image_url)">
            <img :src="getCoverUrl(challenge?.image_url)" alt="" />
            <div class="header-overlay"></div>
          </div>
          <div class="header-background placeholder" v-else>
            <div class="header-overlay"></div>
          </div>
          <!-- 内容 -->
          <div class="header-content">
            <h2 class="room-name">{{ challenge?.name }}</h2>
            <div class="header-status-row">
              <t-tag :theme="statusTheme" variant="light">{{ statusText }}</t-tag>
              <div class="connection-status-inline">
                <div class="status-dot" :class="challengeStore.connectionStatus"></div>
                <span>{{ connectionStatusText }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="room-info">
        <div class="info-card">
          <div class="info-label">参赛积分</div>
          <div class="info-value">{{ challenge?.entry_fee }} <t-icon name="star" /></div>
        </div>
        <div class="info-card">
          <div class="info-label">奖池</div>
          <div class="info-value prize">{{ challenge?.prize_pool }} <t-icon name="gift" /></div>
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
          <div class="info-label">难度</div>
          <div class="info-value">{{ getDifficultyText(challenge?.difficulty) }}</div>
        </div>
        <div class="info-card">
          <div class="info-label">出题模式</div>
          <div class="info-value">{{ getWordModeText(challenge?.word_mode) }}</div>
        </div>
        <div class="info-card">
          <div class="info-label">提示选项</div>
          <div class="info-value hints">
            <span v-if="challenge?.show_chinese !== false">中文</span>
            <span v-if="challenge?.show_english !== false">英文</span>
            <span v-if="challenge?.show_chinese === false && challenge?.show_english === false">无</span>
          </div>
        </div>
        <div class="info-card">
          <div class="info-label">辅助输入</div>
          <div class="info-value">{{ challenge?.assisted_input !== false ? '开启' : '关闭' }}</div>
        </div>
      </div>

      <div class="participants-section">
        <h3>参赛选手 ({{ challenge?.participants?.length || 0 }}/{{ challenge?.max_participants }})</h3>
        <div class="participants-grid">
          <div class="participant-card" v-for="p in challenge?.participants" :key="p.user_id"
            :class="{ 'is-me': p.user_id === authStore.user?.id, 'is-creator': p.user_id === challenge?.creator_id }">
            <div class="participant-avatar">
              <t-avatar :image="p.avatar_url" size="large">
                {{ p.nickname?.charAt(0) }}
              </t-avatar>
              <div class="online-status" :class="{ online: isParticipantOnline(p) }"></div>
            </div>
            <div class="participant-info">
              <div class="participant-name">
                {{ p.nickname }}
                <t-tag v-if="p.user_id === challenge?.creator_id" size="small" theme="warning">房主</t-tag>
              </div>
              <div class="participant-status">
                <template v-if="!isParticipantOnline(p)">
                  <t-icon name="wifi-off" class="offline" />
                  <span class="offline-text">离线</span>
                  <!-- 比赛中显示退赛倒计时 -->
                  <span v-if="challengeStore.gameStatus === 'playing' && !p.has_left && (p.exit_countdown !== undefined || p.offline_since)" class="exit-countdown">
                    ({{ getExitCountdown(p) }})
                  </span>
                </template>
                <template v-else>
                  <t-icon :name="isParticipantReady(p) ? 'check-circle' : 'time'"
                    :class="{ ready: isParticipantReady(p) }" />
                  {{ isParticipantReady(p) ? '已准备' : '未准备' }}
                </template>
              </div>
            </div>
          </div>

          <!-- 空位 -->
          <div class="participant-card empty" v-for="i in emptySlots" :key="'empty-' + i">
            <div class="empty-slot">
              <t-icon name="user-add" size="32px" />
              <span>等待加入</span>
            </div>
          </div>
        </div>
      </div>

      <div class="room-actions-bottom">
        <div v-if="!challengeStore.isCreator" class="ready-section">
          <t-button :theme="challengeStore.myParticipant?.is_ready ? 'default' : 'primary'"
            :variant="isConnected ? 'base' : 'outline'" size="large" :disabled="!isConnected"
            @click="handleToggleReady">
            <template #icon>
              <t-icon :name="challengeStore.myParticipant?.is_ready ? 'close' : 'check'" />
            </template>
            {{ challengeStore.myParticipant?.is_ready ? '取消准备' : '准备比赛' }}
          </t-button>
          <div class="ready-hint offline" v-if="!isConnected">
            <t-icon name="wifi-off" />
            网络已断开，检查网络连接！
          </div>
          <div class="ready-hint" v-else-if="challengeStore.myParticipant?.is_ready">
            <t-icon name="time" />
            等待主持人开始比赛...
          </div>
          <div class="ready-hint" v-else>
            <t-icon name="time" />
            点击准备开始比赛！
          </div>
        </div>
        <div v-if="challengeStore.isCreator" class="start-section">
          <t-button :theme="challengeStore.canStart ? 'primary' : 'default'"
            :variant="challengeStore.canStart ? 'base' : 'outline'" size="large" :disabled="!challengeStore.canStart"
            @click="handleStart" :loading="starting">
            <template #icon><t-icon name="play-circle" /></template>
            开始比赛
          </t-button>
          <div class="start-hint" v-if="!challengeStore.canStart">
            <t-icon name="time" />

            <span v-if="challenge?.participants?.length < 2">等待更多玩家加入（至少2人）...</span>
            <span v-else-if="!challengeStore.allReady">等待所有玩家确认参赛...</span>
            <span v-else-if="!challengeStore.allOnline">等待所有玩家上线...</span>
          </div>
          <div class="start-hint" v-else>
            <t-icon name="time" />

            <span>全部玩家就绪，点击开始比赛！</span>
          </div>
        </div>
      </div>

    </div>

    <!-- 比赛进行中 -->
    <div class="room-playing"
      v-else-if="challengeStore.gameStatus === 'playing' || challengeStore.gameStatus === 'round_result'">
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
        <div class="score-item" v-for="(p, index) in challengeStore.sortedParticipants" :key="p.user_id"
          :class="{ 'is-me': p.user_id === authStore.user?.id, 'is-leader': index === 0, 'is-offline': !isParticipantOnline(p) }">
          <div class="score-rank">{{ index + 1 }}</div>
          <div class="score-avatar">
            <t-avatar :image="p.avatar_url" size="small">{{ p.nickname?.charAt(0) }}</t-avatar>
            <div class="online-dot" :class="{ online: isParticipantOnline(p) }"></div>
          </div>
          <span class="score-name">{{ p.nickname }}</span>
          <!-- 离线倒计时 -->
          <span v-if="!isParticipantOnline(p) && !p.has_left && (p.exit_countdown !== undefined || p.offline_since)" class="exit-countdown-badge">
            {{ getExitCountdown(p) }}
          </span>
          <span class="score-value">{{ p.score }}</span>
        </div>
      </div>

      <!-- 房主离线提示 -->
      <t-dialog v-model:visible="showHostOfflineDialog" header="主持人已离线" :close-on-overlay-click="false"
        :close-btn="false" :footer="false">
        <div class="host-offline-content">
          <t-icon name="wifi-off" size="48px" class="offline-icon" />
          <p>主持人（房主）已断开连接，比赛可能无法正常进行。</p>
          <p class="hint">您可以选择继续等待主持人恢复连接，或者退出比赛。</p>
        </div>
        <div class="host-offline-actions">
          <t-button variant="outline" @click="handleContinueWait">
            <template #icon><t-icon name="time" /></template>
            继续等待
          </t-button>
          <t-button theme="danger" @click="handleExitDueToHostOffline">
            <template #icon><t-icon name="logout" /></template>
            退出挑战
          </t-button>
        </div>
      </t-dialog>

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
          <div class="word-definition" v-if="showChinese">
            {{ challengeStore.currentWord?.definition_cn || (showEnglish ? '' : challengeStore.currentWord?.definition)
            }}
          </div>
          <div class="word-definition-en" v-if="showEnglish && challengeStore.currentWord?.definition">
            {{ challengeStore.currentWord?.definition }}
          </div>
          <div class="no-hint-notice" v-if="!showChinese && !showEnglish">
            <t-icon name="info-circle" />
            <span>*****</span>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="input-section">
          <LetterInput ref="letterInputRef" :word="challengeStore.currentWord?.word || ''"
            :disabled="challengeStore.hasSubmitted" :auto-submit="true"
            :assisted-mode="challenge?.assisted_input !== false" @submit="handleSubmit" />

          <div class="submit-section">
            <t-button theme="primary" size="large" :disabled="challengeStore.hasSubmitted" @click="handleManualSubmit">
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
          <div class="result-item" v-for="result in challengeStore.roundResults" :key="result.user_id"
            :class="{ correct: result.is_correct, wrong: !result.is_correct }">
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

      <!-- 退出比赛按钮 -->
      <div class="exit-game-section" v-if="challengeStore.gameStatus === 'playing'">
        <t-button variant="text" theme="danger" @click="handleExitGame">
          <template #icon><t-icon name="logout" /></template>
          退出比赛
        </t-button>
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

      <!-- 胜利庆祝区域 -->
      <div class="victory-celebration" v-if="isWinner">
        <div class="confetti-container">
          <div class="confetti" v-for="i in 50" :key="i" :style="getConfettiStyle(i)"></div>
        </div>
        <div class="trophy-animation">
          <div class="trophy-glow"></div>
          <span class="trophy-icon">🏆</span>
        </div>
        <h1 class="victory-title">恭喜获胜！</h1>
        <p class="victory-subtitle">你在「{{ challenge?.name }}」中取得了胜利</p>
        <div class="prize-display">
          <div class="prize-icon">💰</div>
          <div class="prize-amount">+{{ challenge?.prize_pool || (challenge?.entry_fee *
            challenge?.participants?.length) }}
          </div>
          <div class="prize-label">积分奖励</div>
        </div>
      </div>

      <!-- 比赛取消时显示 -->
      <div class="result-header" v-else-if="challenge?.status === 'cancelled'">
        <div class="result-icon">❌</div>
        <h2 class="result-title">比赛已取消</h2>
      </div>

      <!-- 比赛信息卡片 -->
      <div class="finish-card">
        <div class="finish-card-header" :class="{ 'has-cover': getCoverUrl(challenge?.image_url) }">
          <!-- 背景图片 -->
          <div class="header-background" v-if="getCoverUrl(challenge?.image_url)">
            <img :src="getCoverUrl(challenge?.image_url)" alt="" />
            <div class="header-overlay"></div>
          </div>
          <div class="header-background placeholder" v-else>
            <div class="header-overlay"></div>
          </div>

          <!-- 比赛信息内容 -->
          <div class="header-content">
            <h3 class="challenge-name">{{ challenge?.name }}</h3>
            <div class="challenge-stats">
              <div class="stat-item">
                <t-icon name="layers" />
                <span>{{ challenge?.word_count }} 词</span>
              </div>
              <div class="stat-item">
                <t-icon name="time" />
                <span>{{ challenge?.time_limit }}s/题</span>
              </div>
              <div class="stat-item">
                <t-icon name="chart-bar" />
                <span>{{ getDifficultyText(challenge?.difficulty) }}</span>
              </div>
              <div class="stat-item">
                <t-icon name="setting" />
                <span>{{ getWordModeText(challenge?.word_mode) }}</span>
              </div>
            </div>
            <div class="challenge-config">
              <t-tag size="small" variant="light" theme="warning">
                <t-icon name="star" /> {{ challenge?.entry_fee }} 积分
              </t-tag>
              <t-tag size="small" variant="light" v-if="challenge?.show_chinese !== false">
                中文提示
              </t-tag>
              <t-tag size="small" variant="light" v-if="challenge?.show_english !== false">
                英文提示
              </t-tag>
              <t-tag size="small" variant="light" :theme="challenge?.assisted_input !== false ? 'primary' : 'default'">
                {{ challenge?.assisted_input !== false ? '辅助输入' : '无辅助' }}
              </t-tag>
            </div>
            <div class="challenge-time">
              <span><t-icon name="calendar" /> {{ formatDateTime(challenge?.created_at) }}</span>
              <span v-if="challenge?.finished_at"> → {{ formatDateTime(challenge?.finished_at, true) }}</span>
            </div>
          </div>
        </div>

        <!-- 冠军区域（非胜利者视角） -->
        <div class="winner-banner" v-if="challenge?.winner_id && !isWinner">
          <div class="winner-decoration">🏆</div>
          <div class="winner-content">
            <t-avatar :image="getWinnerAvatar()" size="64px">
              {{ challenge?.winner_name?.charAt(0) }}
            </t-avatar>
            <div class="winner-info">
              <div class="winner-label">🎉 冠军</div>
              <div class="winner-name">{{ challenge?.winner_name }}</div>
              <div class="winner-prize">
                获得 <strong>{{ challenge?.prize_pool || (challenge?.entry_fee * challenge?.participants?.length)
                  }}</strong>
                积分
              </div>
            </div>
          </div>
        </div>

        <!-- 最终排名 -->
        <div class="final-ranking">
          <div class="section-title">最终排名</div>
          <div class="ranking-list">
            <div class="ranking-item" v-for="(p, index) in challengeStore.sortedParticipants" :key="p.user_id" :class="{
              'is-winner': index === 0 && !p.has_left,
              'is-me': p.user_id === authStore.user?.id,
              'has-left': p.has_left
            }">
              <div class="rank-num" :class="'rank-' + (index + 1)">
                <span v-if="p.has_left">-</span>
                <span v-else>{{ index + 1 }}</span>
              </div>
              <t-avatar :image="p.avatar_url" size="36px">{{ p.nickname?.charAt(0) }}</t-avatar>
              <span class="player-name">
                {{ p.nickname }}
                <t-tag v-if="p.has_left" size="small" theme="danger" variant="light" class="left-tag">已退赛</t-tag>
              </span>
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
          <div class="record-item" v-for="(gameWord, index) in paginatedGameWords" :key="gameWord.word.word + index">
            <div class="record-word-row">
              <span class="round-num">{{ (recordsCurrentPage - 1) * recordsPageSize + index + 1 }}</span>
              <span class="word-text">{{ gameWord.word.word }}</span>
              <span class="word-phonetic">{{ gameWord.word.pronunciation }}</span>
              <t-button variant="text" size="small" @click.stop="speakWord(gameWord.word.word)">
                <template #icon><t-icon name="sound" /></template>
              </t-button>
            </div>
            <div class="record-definition">{{ gameWord.word.definition_cn || gameWord.word.definition }}</div>
            <div class="record-answers" v-if="gameWord.results?.length > 0">
              <div class="answer-item" v-for="result in gameWord.results" :key="result.user_id"
                :class="{ correct: result.is_correct, timeout: !result.answer }">
                <t-icon
                  :name="result.is_correct ? 'check-circle-filled' : (result.answer ? 'close-circle-filled' : 'time-filled')" />
                <span class="answer-player">{{ getParticipantName(result.user_id) }}</span>
                <span class="answer-text">{{ result.answer || '未作答' }}</span>
                <span class="answer-time">{{ (result.time_taken / 1000).toFixed(1) }}s</span>
              </div>
            </div>
          </div>
          <!-- 分页控制 -->
          <div class="records-pagination" v-if="recordsTotalPages > 1">
            <t-button variant="outline" size="small" :disabled="recordsCurrentPage <= 1" @click="recordsCurrentPage--">
              <template #icon><t-icon name="chevron-left" /></template>
            </t-button>
            <span class="page-info">{{ recordsCurrentPage }} / {{ recordsTotalPages }}</span>
            <t-button variant="outline" size="small" :disabled="recordsCurrentPage >= recordsTotalPages" @click="recordsCurrentPage++">
              <template #icon><t-icon name="chevron-right" /></template>
            </t-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useChallengeStore } from '@/stores/challenge'
import { useSpeechStore } from '@/stores/speech'
import LetterInput from '@/components/LetterInput.vue'

const baseUrl = import.meta.env.BASE_URL
const defaultCoverUrl = `${baseUrl}challenge-default.svg`

const router = useRouter()
const authStore = useAuthStore()
const challengeStore = useChallengeStore()
const speechStore = useSpeechStore()

// 获取封面图片URL（处理默认封面和旧数据兼容）
function getCoverUrl(imageUrl) {
  if (!imageUrl) return ''
  // 如果是默认封面标识或包含 challenge-default.svg，使用当前环境的默认封面路径
  if (imageUrl === 'default' || imageUrl.includes('challenge-default.svg')) {
    return defaultCoverUrl
  }
  // 否则直接返回存储的URL（自定义封面）
  return imageUrl
}

const starting = ref(false)
const letterInputRef = ref(null)
const showRecords = ref(true) // 是否显示比赛记录（默认展开）
const showHostOfflineDialog = ref(false) // 房主离线提示对话框
const hostOfflineDialogDismissed = ref(false) // 用户是否已关闭过对话框

// 比赛记录分页
const recordsPageSize = 5 // 每页显示5条记录
const recordsCurrentPage = ref(1)

const recordsTotalPages = computed(() => {
  return Math.ceil(challengeStore.gameWords.length / recordsPageSize)
})

const paginatedGameWords = computed(() => {
  const start = (recordsCurrentPage.value - 1) * recordsPageSize
  const end = start + recordsPageSize
  return challengeStore.gameWords.slice(start, end)
})

const challenge = computed(() => challengeStore.currentChallenge)

// 判断参与者是否在线
function isParticipantOnline(participant) {
  // 如果是当前用户自己，使用本地网络状态和 Realtime 连接状态
  if (participant.user_id === authStore.user?.id) {
    // 当前用户在线 = 网络在线 + Realtime 已连接
    return challengeStore.isNetworkOnline && challengeStore.realtimeStatus === 'connected'
  }
  // 其他用户使用 Presence 同步的状态
  return participant.is_online === true
}

// 判断参与者是否已准备
function isParticipantReady(participant) {
  // 直接使用数据库中的 is_ready 状态，确保所有人看到的状态一致
  // 注意：房主的 is_ready 在进入房间时会自动设置为 true
  return participant.is_ready === true
}

// 用于强制更新倒计时显示的响应式变量
const countdownTick = ref(0)
let countdownTimer = null

// 启动倒计时更新定时器
function startCountdownTimer() {
  if (countdownTimer) return
  countdownTimer = setInterval(() => {
    countdownTick.value++
  }, 1000)
}

// 停止倒计时更新定时器
function stopCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

// 计算退赛倒计时显示文本
function getExitCountdown(participant) {
  // 触发响应式更新
  void countdownTick.value
  
  // 优先使用房主广播的 exit_countdown（确保所有客户端同步）
  if (participant.exit_countdown !== undefined && participant.exit_countdown !== null) {
    if (participant.exit_countdown <= 0) {
      return '即将退赛'
    }
    return `${participant.exit_countdown}秒后退赛`
  }
  
  // 本地计算（房主自己不会收到广播，或者房主离线时其他客户端需要自己计算）
  if (participant.offline_since) {
    const now = Date.now()
    const elapsed = now - participant.offline_since
    const remaining = challengeStore.OFFLINE_PROTECTION_TIME - elapsed
    
    if (remaining <= 0) {
      return '即将退赛'
    }
    
    const seconds = Math.ceil(remaining / 1000)
    return `${seconds}秒后退赛`
  }
  
  return ''
}

// 监听游戏状态，在比赛中启动倒计时定时器
watch(() => challengeStore.gameStatus, (status) => {
  if (status === 'playing') {
    startCountdownTimer()
  } else {
    stopCountdownTimer()
  }
}, { immediate: true })

// 组件卸载时清理
onUnmounted(() => {
  stopCountdownTimer()
})

// 判断房主是否在线
const isHostOnline = computed(() => {
  if (!challenge.value) return true
  const host = challenge.value.participants?.find(p => p.user_id === challenge.value.creator_id)
  // 如果房主是当前用户，使用本地状态
  if (host?.user_id === authStore.user?.id) {
    return challengeStore.isNetworkOnline && challengeStore.realtimeStatus === 'connected'
  }
  return host?.is_online === true
})

// 判断当前用户是否是房主
const isCurrentUserHost = computed(() => {
  if (!challenge.value || !authStore.user) return false
  return challenge.value.creator_id === authStore.user.id
})

// 当前用户是否已连接（网络在线 + Realtime 已连接）
const isConnected = computed(() => {
  return challengeStore.connectionStatus === 'connected'
})

// 监听连接状态变化，离线时自动取消准备，在线时房主自动准备
watch(() => challengeStore.connectionStatus, (status, oldStatus) => {
  // 从已连接变为未连接，自动取消准备（包括房主）
  if (oldStatus === 'connected' && status === 'disconnected') {
    if (challengeStore.myParticipant?.is_ready) {
      // 本地立即更新状态（不依赖网络）
      if (challengeStore.myParticipant) {
        challengeStore.myParticipant.is_ready = false
      }
      MessagePlugin.warning('网络已断开，已自动取消准备状态')
    }
  }
  // 从未连接变为已连接，房主自动设置为已准备
  else if (oldStatus !== 'connected' && status === 'connected') {
    if (challengeStore.isCreator && challengeStore.myParticipant) {
      challengeStore.myParticipant.is_ready = true
      // 同步到服务器
      challengeStore.toggleReady()
    }
  }
})

// 监听房主在线状态变化（仅在比赛进行中时生效）
watch([isHostOnline, () => challengeStore.gameStatus], ([hostOnline, gameStatus]) => {
  // 只在比赛进行中且当前用户不是房主时检测
  if (gameStatus === 'playing' || gameStatus === 'round_result') {
    if (!isCurrentUserHost.value) {
      if (!hostOnline && !hostOfflineDialogDismissed.value) {
        // 房主离线，显示提示
        showHostOfflineDialog.value = true
      } else if (hostOnline && showHostOfflineDialog.value) {
        // 房主恢复在线，自动关闭提示
        showHostOfflineDialog.value = false
        hostOfflineDialogDismissed.value = false
        MessagePlugin.success('主持人已恢复连接')
      }
    }
  } else {
    // 比赛结束或其他状态，重置对话框状态
    showHostOfflineDialog.value = false
    hostOfflineDialogDismissed.value = false
  }
}, { immediate: true })

// 继续等待房主
function handleContinueWait() {
  showHostOfflineDialog.value = false
  hostOfflineDialogDismissed.value = true
  MessagePlugin.info('正在等待主持人恢复连接...')
}

// 因房主离线退出比赛
async function handleExitDueToHostOffline() {
  showHostOfflineDialog.value = false
  await handleExitGame()
}

// 判断当前用户是否是胜利者
const isWinner = computed(() => {
  if (!challenge.value || !authStore.user) return false
  return challenge.value.winner_id === authStore.user.id
})

// 生成彩带样式
function getConfettiStyle(index) {
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8']
  const color = colors[index % colors.length]
  const left = Math.random() * 100
  const delay = Math.random() * 3
  const duration = 2 + Math.random() * 2
  const size = 8 + Math.random() * 8

  return {
    left: `${left}%`,
    backgroundColor: color,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`
  }
}

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

// 是否显示中文词义
const showChinese = computed(() => {
  return challenge.value?.show_chinese !== false
})

// 是否显示英文释义
const showEnglish = computed(() => {
  return challenge.value?.show_english !== false
})

// 监听当前单词变化，播放语音
watch(() => challengeStore.currentWord, (word) => {
  if (word) {
    nextTick(() => {
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

// 获取出题模式文本
function getWordModeText(mode) {
  const map = {
    simulate: '模拟',
    new: '新题',
    random: '随机',
    sequential: '顺序',
    reverse: '倒序'
  }
  return map[mode] || '模拟'
}

// 格式化日期时间
function formatDateTime(dateStr, timeOnly = false) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  if (timeOnly) {
    return `${hours}:${minutes}`
  }
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}月${day}日 ${hours}:${minutes}`
}

function handleSubmit(answer) {
  if (challengeStore.hasSubmitted) return
  challengeStore.submitAnswer(answer)
}

function handleManualSubmit() {
  if (challengeStore.hasSubmitted) return
  const answer = letterInputRef.value?.getAnswer() || ''
  if (answer && letterInputRef.value?.isFilled()) {
    challengeStore.submitAnswer(answer)
  }
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
  let dialogInstance = null;
  dialogInstance = DialogPlugin.confirm({
    header: '确认离开',
    body: '确定要离开挑战赛吗？',
    confirmBtn: { content: '确认' },
    onConfirm: async () => {
      // 先关闭对话框，避免操作卡住时对话框不消失
      if (dialogInstance) {
        dialogInstance.destroy()
        dialogInstance = null
      }

      try {
        // 添加超时保护，避免 leaveChallenge 卡住
        await Promise.race([
          challengeStore.leaveChallenge(),
          new Promise(resolve => setTimeout(resolve, 3000)) // 3秒超时
        ])
      } catch (e) {
        console.error('[ChallengeRoom] Leave failed:', e)
      }

      // 无论成功失败，都强制清理状态
      try {
        await Promise.race([
          challengeStore.cleanup(),
          new Promise(resolve => setTimeout(resolve, 2000)) // 2秒超时
        ])
      } catch { }

      // 强制跳转到列表页（不依赖 watch）
      router.replace({ name: 'Challenge' })
    },
    onClose: () => {
      if (dialogInstance) {
        dialogInstance.destroy()
        dialogInstance = null
      }
    }
  })
}

// 比赛结束后直接离开，不需要确认
async function handleLeaveFinished() {
  try {
    // 添加超时保护
    await Promise.race([
      challengeStore.leaveChallenge(true),
      new Promise(resolve => setTimeout(resolve, 3000)) // 3秒超时
    ])
  } catch (e) {
    console.error('[ChallengeRoom] Leave finished failed:', e)
  }

  // 无论成功失败，都强制清理状态
  try {
    await Promise.race([
      challengeStore.cleanup(),
      new Promise(resolve => setTimeout(resolve, 2000))
    ])
  } catch { }

  // 强制跳转到列表页
  router.replace({ name: 'Challenge' })
}

function handleCancel() {
  let dialogInstance = null;
  dialogInstance = DialogPlugin.confirm({
    header: '确认取消',
    body: '确定要取消这场挑战赛吗？所有参与者都将被移出。',
    confirmBtn: { content: '确认取消', theme: 'danger' },
    onConfirm: async () => {
      if (dialogInstance) {
        dialogInstance.destroy()
        dialogInstance = null
      }
      try {
        await Promise.race([
          challengeStore.cancelChallenge(),
          new Promise(resolve => setTimeout(resolve, 3000))
        ])
      } catch (e) {
        console.error('[ChallengeRoom] Cancel failed:', e)
      }
      // 强制清理并跳转
      try {
        await Promise.race([
          challengeStore.cleanup(),
          new Promise(resolve => setTimeout(resolve, 2000))
        ])
      } catch { }
      router.replace({ name: 'Challenge' })
    },
    onClose: () => {
      if (dialogInstance) {
        dialogInstance.destroy()
        dialogInstance = null
      }
    }
  })
}

// 比赛进行中退出
function handleExitGame() {
  let dialogInstance = null;
  dialogInstance = DialogPlugin.confirm({
    header: '确认退出比赛',
    body: '退出比赛后，您将无法获得冠军奖励。确定要退出吗？',
    confirmBtn: { content: '确认退出', theme: 'danger' },
    onConfirm: async () => {
      if (dialogInstance) {
        dialogInstance.destroy()
        dialogInstance = null
      }
      try {
        await Promise.race([
          challengeStore.exitGame(),
          new Promise(resolve => setTimeout(resolve, 3000))
        ])
      } catch (e) {
        console.error('[ChallengeRoom] Exit game failed:', e)
      }
      // 强制清理并跳转
      try {
        await Promise.race([
          challengeStore.cleanup(),
          new Promise(resolve => setTimeout(resolve, 2000))
        ])
      } catch { }
      router.replace({ name: 'Challenge' })
    },
    onClose: () => {
      if (dialogInstance) {
        dialogInstance.destroy()
        dialogInstance = null
      }
    }
  })
}

function handleToggleReady() {
  // console.log('handleToggleReady called')
  challengeStore.toggleReady()
}

onMounted(() => {
  // 进入房间时立即滚动到顶部（使用 instant 避免看到滚动过程）
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
})

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
    margin-bottom: 2rem;

    .room-header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .room-header-main {
      position: relative;
      min-height: 120px;
      border-radius: 16px;
      overflow: hidden;

      .header-background {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        &.placeholder {
          background: linear-gradient(135deg, var(--honey-400) 0%, var(--honey-600) 100%);
        }

        .header-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg,
              rgba(0, 0, 0, 0.5) 0%,
              rgba(0, 0, 0, 0.6) 100%);
        }
      }

      .header-content {
        position: relative;
        z-index: 1;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        color: white;
        text-align: center;

        .room-name {
          margin: 0 0 0.5rem;
          font-size: 1.35rem;
          font-weight: 700;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
          color: white;
        }

        .header-status-row {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
          justify-content: center;

          .connection-status-inline {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            font-size: 0.8rem;
            color: rgba(255, 255, 255, 0.85);
            background: rgba(0, 0, 0, 0.3);
            padding: 0.25rem 0.6rem;
            border-radius: 12px;

            .status-dot {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: var(--charcoal-400);

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
      }
    }
  }

  .room-info {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
    margin-bottom: 2rem;

    .info-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 0.75rem;
      text-align: center;

      .info-label {
        font-size: 0.75rem;
        color: var(--text-secondary);
        margin-bottom: 0.25rem;
      }

      .info-value {
        font-size: 1rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;

        &.prize {
          color: var(--honey-600);
        }

        &.hints {
          font-size: 0.85rem;
          gap: 0.5rem;

          span {
            padding: 0.125rem 0.5rem;
            background: var(--honey-100);
            border-radius: 4px;
            color: var(--honey-700);
          }
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
      font-size: 1.25rem;
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
          z-index: 100;

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
          
          .offline {
            color: var(--error);
          }
          
          .offline-text {
            color: var(--error);
          }
          
          .exit-countdown {
            color: var(--warning);
            font-weight: 500;
            font-size: 0.8rem;
            min-width: 6em;
            display: inline-block;
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

        &.offline {
          color: var(--error);
          animation: none;
        }
      }
    }

    .start-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;

      .start-hint {
        // font-size: 0.85rem;
        // color: var(--text-secondary);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: var(--honey-600);
        animation: pulse 1.5s ease-in-out infinite;
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

      .score-avatar {
        position: relative;

        .online-dot {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--charcoal-300);
          border: 2px solid white;

          &.online {
            background: var(--success);
          }
        }
      }

      .score-name {
        font-weight: 500;
      }

      .score-value {
        font-weight: 700;
        color: var(--honey-600);
      }
      
      .exit-countdown-badge {
        font-size: 0.7rem;
        color: var(--warning);
        background: rgba(var(--warning-rgb), 0.1);
        padding: 0.1rem 0.4rem;
        border-radius: 10px;
        font-weight: 500;
        min-width: 5.5em;
        text-align: center;
        white-space: nowrap;
      }
      
      &.is-offline {
        opacity: 0.7;
        
        .score-name {
          color: var(--text-muted);
        }
      }
    }
  }

  // 房主离线提示对话框
  .host-offline-content {
    text-align: center;
    padding: 1rem 0;

    .offline-icon {
      color: var(--charcoal-400);
      margin-bottom: 1rem;
    }

    p {
      margin: 0.5rem 0;
      color: var(--text-primary);

      &.hint {
        color: var(--text-secondary);
        font-size: 0.9rem;
      }
    }
  }

  .host-offline-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 1.5rem;
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

      .no-hint-notice {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 1rem;
        background: var(--warning-light, #fef3c7);
        border-radius: 8px;
        color: var(--warning, #d97706);
        font-size: 0.95rem;
      }
    }

    .input-section {
      .submit-section {
        display: flex;
        justify-content: center;
        margin-top: 2rem;
      }
    }
  }

  .exit-game-section {
    display: flex;
    justify-content: center;
    margin-top: 2.5rem;
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
          color: var(--success-text, #059669);
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
  padding: 0 0 1rem 0;

  .finish-nav {
    margin-bottom: 1rem;
  }

  // 胜利庆祝区域
  .victory-celebration {
    text-align: center;
    padding: 2rem 1rem;
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, #fff9e6 0%, #ffe066 50%, #ffd700 100%);
    border-radius: 20px;
    margin-bottom: 1.5rem;

    .confetti-container {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      overflow: hidden;

      .confetti {
        position: absolute;
        top: -20px;
        border-radius: 2px;
        animation: confetti-fall linear infinite;
      }
    }

    .trophy-animation {
      position: relative;
      display: inline-block;
      margin-bottom: 1rem;

      .trophy-glow {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 120px;
        height: 120px;
        background: radial-gradient(circle, rgba(255, 215, 0, 0.6) 0%, transparent 70%);
        animation: trophy-pulse 2s ease-in-out infinite;
      }

      .trophy-icon {
        position: relative;
        font-size: 5rem;
        animation: trophy-bounce 1s ease-in-out infinite;
        display: block;
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
      }
    }

    .victory-title {
      font-size: 2rem;
      font-weight: 800;
      color: #b8860b;
      margin: 0 0 0.5rem;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1);
      animation: title-appear 0.5s ease-out;
    }

    .victory-subtitle {
      font-size: 1rem;
      color: #8b7355;
      margin: 0 0 1.5rem;
    }

    .prize-display {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      padding: 1rem 2rem;
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      animation: prize-pop 0.5s ease-out 0.3s both;

      .prize-icon {
        font-size: 2rem;
        margin-bottom: 0.25rem;
      }

      .prize-amount {
        font-size: 2.5rem;
        font-weight: 800;
        color: #d4af37;
        font-family: Georgia, 'Times New Roman', serif;
      }

      .prize-label {
        font-size: 0.85rem;
        color: var(--text-secondary);
      }
    }
  }

  // 非胜利者结果头部
  .result-header {
    text-align: center;
    padding: 2rem 1rem;
    background: var(--bg-card);
    border-radius: 16px;
    margin-bottom: 1.5rem;

    .result-icon {
      font-size: 3rem;
      margin-bottom: 0.5rem;
    }

    .result-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
      color: var(--text-primary);
    }

    .result-subtitle {
      font-size: 1rem;
      color: var(--text-secondary);
      margin: 0;

      strong {
        color: var(--honey-600);
      }
    }
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
      position: relative;
      min-height: 160px;
      overflow: hidden;

      .header-background {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        &.placeholder {
          background: linear-gradient(135deg, var(--honey-400) 0%, var(--honey-600) 100%);
        }

        .header-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(to bottom,
              rgba(0, 0, 0, 0.2) 0%,
              rgba(0, 0, 0, 0.6) 100%);
        }
      }

      .header-content {
        position: relative;
        z-index: 1;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-height: 160px;
        color: white;

        .challenge-name {
          margin: 0 0 0.75rem;
          font-size: 1.25rem;
          font-weight: 700;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .challenge-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 0.75rem;

          .stat-item {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            font-size: 0.9rem;
            opacity: 0.95;

            .t-icon {
              font-size: 1rem;
            }
          }
        }

        .challenge-config {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .challenge-time {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          font-size: 0.8rem;
          opacity: 0.85;

          span {
            display: flex;
            align-items: center;
            gap: 0.25rem;
          }
        }
      }

      &.has-cover {
        .header-content {
          .challenge-name {
            color: white;
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
            display: flex;
            align-items: center;
            gap: 0.5rem;

            .left-tag {
              font-size: 0.7rem;
            }
          }

          .player-score {
            font-size: 0.9rem;
            font-weight: 700;
            color: var(--honey-600);
          }

          &.has-left {
            opacity: 0.6;
            background: var(--charcoal-100);

            .rank-num {
              background: var(--charcoal-300);
              color: var(--charcoal-500);
            }

            .player-name {
              color: var(--text-muted);
              text-decoration: line-through;
            }

            .player-score {
              color: var(--text-muted);
            }
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
              color: var(--success-text, #059669);
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
              font-weight: 600;
              min-width: 60px;
              color: inherit;
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

      .records-pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        padding-top: 0.5rem;
        border-top: 1px solid var(--charcoal-100);
        margin-top: 0.5rem;

        .page-info {
          font-size: 0.9rem;
          color: var(--text-secondary);
          min-width: 60px;
          text-align: center;
        }
      }
    }
  }
}

// 大屏幕样式
@media (min-width: 1024px) {
  .room-waiting {
    .room-header {
      .room-header-main {
        min-height: 160px;

        .header-content {
          min-height: 160px;
          padding: 1.5rem;

          .room-name {
            font-size: 1.5rem;
            color: white;
          }
        }
      }
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

@keyframes confetti-fall {
  0% {
    transform: translateY(-20px) rotate(0deg);
    opacity: 1;
  }

  100% {
    transform: translateY(400px) rotate(720deg);
    opacity: 0;
  }
}

@keyframes trophy-bounce {

  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-10px);
  }
}

@keyframes trophy-pulse {

  0%,
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.6;
  }

  50% {
    transform: translate(-50%, -50%) scale(1.2);
    opacity: 0.3;
  }
}

@keyframes title-appear {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes prize-pop {
  0% {
    transform: scale(0);
    opacity: 0;
  }

  50% {
    transform: scale(1.1);
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .room-waiting {
    .room-header {
      .room-header-main {
        flex-direction: column;
        align-items: flex-start;

        .room-cover {
          width: 100%;
          height: 120px;
        }
      }
    }

    .room-info {
      grid-template-columns: repeat(2, 1fr);
    }
  }
}
</style>
