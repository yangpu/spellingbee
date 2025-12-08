<template>
  <div class="challenge-page">
    <!-- 挑战赛列表 -->
    <div class="challenge-list" v-if="!challengeStore.currentChallenge">
      <div class="page-header">
        <div class="header-info">
          <img :src="`${baseUrl}bee.svg`" alt="Bee" class="header-icon" />
          <div>
            <h1>多人挑战赛</h1>
            <p>创建或加入挑战赛，与其他玩家实时对战</p>
          </div>
        </div>
        <div class="header-actions">
          <t-button variant="outline" @click="refreshList" :loading="challengeStore.loading">
            <template #icon><t-icon name="refresh" /></template>
            刷新
          </t-button>
          <t-button theme="primary" @click="openCreateDialog" :disabled="!authStore.user">
            <template #icon><t-icon name="add" /></template>
            创建挑战赛
          </t-button>
        </div>
      </div>

      <!-- 未登录提示 -->
      <div class="login-hint" v-if="!authStore.user">
        <t-icon name="info-circle" />
        <span>请先登录后再参与挑战赛</span>
      </div>

      <!-- 状态统计和搜索 -->
      <div class="filter-section" v-if="challengeStore.challenges.length > 0">
        <div class="status-tabs">
          <div 
            class="status-tab" 
            :class="{ active: statusFilter === 'all' }"
            @click="statusFilter = 'all'"
          >
            <span class="tab-label">全部</span>
            <span class="tab-count">{{ statusCounts.all }}</span>
          </div>
          <div 
            class="status-tab" 
            :class="{ active: statusFilter === 'waiting' }"
            @click="statusFilter = 'waiting'"
          >
            <span class="tab-label">等待中</span>
            <span class="tab-count waiting">{{ statusCounts.waiting }}</span>
          </div>
          <div 
            class="status-tab" 
            :class="{ active: statusFilter === 'in_progress' }"
            @click="statusFilter = 'in_progress'"
          >
            <span class="tab-label">进行中</span>
            <span class="tab-count in_progress">{{ statusCounts.in_progress }}</span>
          </div>
          <div 
            class="status-tab" 
            :class="{ active: statusFilter === 'finished' }"
            @click="statusFilter = 'finished'"
          >
            <span class="tab-label">已结束</span>
            <span class="tab-count finished">{{ statusCounts.finished }}</span>
          </div>
          <div 
            v-if="authStore.user"
            class="status-tab" 
            :class="{ active: statusFilter === 'mine' }"
            @click="statusFilter = 'mine'"
          >
            <span class="tab-label">我的比赛</span>
            <span class="tab-count mine">{{ statusCounts.mine }}</span>
          </div>
        </div>
        <div class="search-box">
          <t-input 
            v-model="searchKeyword" 
            placeholder="搜索挑战赛名称..." 
            clearable
            :prefix-icon="() => h(SearchIcon)"
          />
        </div>
      </div>

      <!-- 加载中 -->
      <div class="loading-container" v-if="challengeStore.loading">
        <t-loading />
        <span>加载挑战赛列表...</span>
      </div>

      <!-- 空状态 -->
      <div class="empty-state" v-else-if="challengeStore.challenges.length === 0">
        <t-icon name="calendar" size="64px" />
        <h3>暂无挑战赛</h3>
        <p>成为第一个创建挑战赛的人吧！</p>
      </div>

      <!-- 过滤后无结果 -->
      <div class="empty-state" v-else-if="paginatedChallenges.length === 0">
        <t-icon name="search" size="64px" />
        <h3>没有找到匹配的挑战赛</h3>
        <p>尝试更换筛选条件或搜索关键词</p>
        <t-button variant="outline" @click="resetFilters">重置筛选</t-button>
      </div>

      <!-- 挑战赛卡片列表 -->
      <div class="challenge-cards" v-else>
        <div 
          class="challenge-card" 
          v-for="challenge in paginatedChallenges" 
          :key="challenge.id"
          :class="{ connecting: connectingId === challenge.id, finished: challenge.status === 'finished', cancelled: challenge.status === 'cancelled' }"
          @click="viewChallenge(challenge)"
        >
          <!-- 连接中遮罩 -->
          <div class="connecting-overlay" v-if="connectingId === challenge.id">
            <t-loading size="medium" />
            <span>正在建立连接...</span>
          </div>
          <div class="card-image">
            <img v-if="getCoverUrl(challenge)" :src="getCoverUrl(challenge)" alt="" />
            <div v-else class="card-image-placeholder">
              <t-icon name="trophy" size="48px" />
            </div>
            <div class="card-status" :class="challenge.status">
              {{ getStatusText(challenge.status) }}
            </div>
            <!-- 管理员删除按钮 -->
            <t-button
              v-if="isAdmin(challenge)"
              class="delete-btn"
              variant="text"
              theme="danger"
              size="small"
              @click.stop="handleDelete(challenge)"
            >
              <template #icon><t-icon name="delete" /></template>
            </t-button>
          </div>
          <div class="card-content">
            <h3 class="card-title">{{ challenge.name }}</h3>
            <div class="card-meta">
              <div class="meta-item">
                <t-icon name="star" />
                <span>{{ challenge.entry_fee }} 积分</span>
              </div>
              <div class="meta-item">
                <t-icon name="layers" />
                <span>{{ challenge.word_count }} 词</span>
              </div>
              <div class="meta-item">
                <t-icon name="time-filled" />
                <span>{{ challenge.time_limit }}s</span>
              </div>
            </div>
            <!-- 时间和参赛人数同行 -->
            <div class="card-info-row">
              <div class="card-time">
                <t-icon name="time" />
                <span v-if="challenge.status === 'finished' && challenge.finished_at">
                  {{ formatTime(challenge.finished_at) }}
                </span>
                <span v-else>
                  {{ formatTime(challenge.created_at) }}
                </span>
              </div>
              <div class="card-participants-count">
                <t-icon name="user" />
                <span>{{ challenge.participants?.length || 0 }}/{{ challenge.max_participants }}</span>
              </div>
            </div>
            <!-- 参赛选手（单行显示，超过3人只显示创建者名称+其他人图标） -->
            <div class="card-participants-row">
              <template v-if="challenge.participants?.length <= 3">
                <div 
                  class="participant-chip"
                  v-for="p in getSortedParticipants(challenge)"
                  :key="p.user_id"
                  :class="{ 'is-winner': challenge.status === 'finished' && p.user_id === challenge.winner_id }"
                >
                  <span class="winner-icon" v-if="challenge.status === 'finished' && p.user_id === challenge.winner_id">🏆</span>
                  <t-avatar v-else size="18px" :image="p.avatar_url">{{ p.nickname?.charAt(0) }}</t-avatar>
                  <span class="participant-name">{{ p.nickname }}</span>
                </div>
              </template>
              <template v-else>
                <!-- 创建者显示名称 -->
                <div class="participant-chip" v-if="getCreator(challenge)" :class="{ 'is-winner': challenge.status === 'finished' && getCreator(challenge).user_id === challenge.winner_id }">
                  <span class="winner-icon" v-if="challenge.status === 'finished' && getCreator(challenge).user_id === challenge.winner_id">🏆</span>
                  <t-avatar v-else size="18px" :image="getCreator(challenge).avatar_url">{{ getCreator(challenge).nickname?.charAt(0) }}</t-avatar>
                  <span class="participant-name">{{ getCreator(challenge).nickname }}</span>
                </div>
                <!-- 其他人只显示图标 -->
                <template v-for="p in getOtherParticipants(challenge)" :key="p.user_id">
                  <span class="winner-icon-only" v-if="challenge.status === 'finished' && p.user_id === challenge.winner_id">🏆</span>
                  <t-avatar 
                    v-else
                    size="18px" 
                    :image="p.avatar_url"
                    class="participant-avatar-only"
                  >{{ p.nickname?.charAt(0) }}</t-avatar>
                </template>
              </template>
            </div>
          </div>
          <div class="card-action">
            <t-button 
              v-if="challenge.status === 'finished' || challenge.status === 'cancelled'"
              variant="outline"
              size="small"
              @click.stop="viewChallengeDetail(challenge)"
            >
              <template #icon><t-icon name="browse" /></template>
              查看详情
            </t-button>
            <t-button 
              v-else-if="isJoined(challenge)"
              theme="primary" 
              size="small"
              :loading="connectingId === challenge.id"
              @click.stop="enterChallenge(challenge)"
            >
              <template #icon><t-icon name="enter" /></template>
              进入房间
            </t-button>
            <t-button 
              v-else
              theme="primary" 
              size="small"
              :disabled="!authStore.user || challenge.participants?.length >= challenge.max_participants"
              :loading="connectingId === challenge.id"
              @click.stop="joinChallenge(challenge)"
            >
              <template #icon><t-icon name="user-add" /></template>
              报名参赛
            </t-button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pagination-section" v-if="filteredChallenges.length > pageSize">
        <t-pagination
          v-model:current="currentPage"
          :total="filteredChallenges.length"
          :page-size="pageSize"
          :show-jumper="false"
          size="small"
        />
      </div>

    </div>

    <!-- 挑战赛房间 -->
    <ChallengeRoom v-else />

    <!-- 创建挑战赛对话框 -->
    <t-dialog
      v-model:visible="showCreateDialog"
      header="创建挑战赛"
      :footer="false"
      width="500px"
    >
      <!-- 快速创建按钮 -->
      <div class="quick-create-section">
        <div class="quick-create-buttons">
          <t-button 
            theme="primary" 
            size="large" 
            block 
            :loading="quickCreating === 2"
            :disabled="quickCreating !== null"
            @click="quickCreate(2)"
          >
            <template #icon><t-icon name="usergroup-add" /></template>
            两人对战
          </t-button>
          <t-button 
            variant="outline"
            size="large" 
            block 
            :loading="quickCreating === 3"
            :disabled="quickCreating !== null"
            @click="quickCreate(3)"
          >
            <template #icon><t-icon name="usergroup" /></template>
            三人对战
          </t-button>
        </div>
      </div>

      <!-- 定制挑战赛切换 -->
      <div class="custom-create-section">
        <div class="custom-toggle" @click="showCustomCreate = !showCustomCreate">
          <span class="toggle-title">
            <t-icon name="setting" />
            定制挑战赛
          </span>
          <t-icon :name="showCustomCreate ? 'chevron-up' : 'chevron-down'" />
        </div>
        <div class="custom-content" :class="showCustomCreate ? 'expanded' : 'collapsed'">
          <t-form
            ref="createForm"
            :data="createData"
            :rules="createRules"
            @submit="handleCreate"
            label-width="100px"
          >
            <t-form-item name="name" label="名称">
              <t-input v-model="createData.name" placeholder="给挑战赛起个名字" maxlength="30" />
            </t-form-item>
            <t-form-item name="description" label="描述">
              <t-textarea v-model="createData.description" placeholder="描述一下这场挑战赛（可选）" maxlength="200" />
            </t-form-item>
            <t-form-item name="image_url" label="封面图片">
              <div class="cover-selection">
                <div class="cover-options">
                  <div 
                    class="cover-option" 
                    :class="{ active: coverType === 'none' }"
                    @click="selectCoverType('none')"
                  >
                    <div class="cover-option-preview empty">
                      <t-icon name="image" size="24px" />
                    </div>
                    <span>无封面</span>
                  </div>
                  <div 
                    class="cover-option" 
                    :class="{ active: coverType === 'default' }"
                    @click="selectCoverType('default')"
                  >
                    <div class="cover-option-preview">
                      <img :src="`${baseUrl}challenge-default.svg`" alt="默认封面" />
                    </div>
                    <span>默认</span>
                  </div>
                  <div 
                    class="cover-option" 
                    :class="{ active: coverType === 'random' }"
                    @click="selectRandomCover"
                  >
                    <div class="cover-option-preview" v-if="randomCoverUrl && !loadingRandomCover">
                      <img :src="randomCoverUrl" alt="随机封面" />
                    </div>
                    <div class="cover-option-preview empty" v-else>
                      <t-loading v-if="loadingRandomCover" size="small" />
                      <t-icon v-else name="refresh" size="24px" />
                    </div>
                    <span>随机</span>
                  </div>
                  <div 
                    class="cover-option" 
                    :class="{ active: coverType === 'custom' }"
                    @click="triggerUpload"
                  >
                    <div class="cover-option-preview" v-if="customCoverUrl">
                      <img :src="customCoverUrl" alt="自定义封面" />
                    </div>
                    <div class="cover-option-preview empty" v-else>
                      <t-icon name="upload" size="24px" />
                    </div>
                    <span>自定义</span>
                  </div>
                </div>
                <t-upload
                  ref="uploadRef"
                  v-model="coverFiles"
                  :action="''"
                  theme="custom"
                  accept="image/*"
                  :auto-upload="false"
                  :show-upload-progress="false"
                  :request-method="customUpload"
                  @change="handleCoverChange"
                  style="display: none;"
                />
                <t-loading v-if="uploadingCover" size="small" class="upload-loading" />
              </div>
            </t-form-item>
            <t-form-item name="max_participants" label="参赛人数">
              <t-input-number v-model="createData.max_participants" :min="2" :max="10" />
            </t-form-item>
            <t-form-item name="entry_fee" label="参赛积分">
              <t-input-number v-model="createData.entry_fee" :min="0" :max="1000" :step="10" />
              <span class="form-hint">赢家将获得所有参赛积分</span>
            </t-form-item>
            <t-form-item name="word_count" label="单词数量">
              <t-input-number v-model="createData.word_count" :min="5" :max="500" :step="5" />
              <span class="form-hint">5-500个单词</span>
            </t-form-item>
            <t-form-item name="time_limit" label="答题时间">
              <t-slider v-model="createData.time_limit" :min="15" :max="60" :step="5" :marks="timeLimitMarks" />
            </t-form-item>
            <t-form-item name="difficulty" label="难度选择">
              <t-radio-group v-model="createData.difficulty" variant="default-filled">
                <t-radio-button :value="null">全部</t-radio-button>
                <t-radio-button :value="1">简单</t-radio-button>
                <t-radio-button :value="2">较易</t-radio-button>
                <t-radio-button :value="3">中等</t-radio-button>
                <t-radio-button :value="4">较难</t-radio-button>
                <t-radio-button :value="5">困难</t-radio-button>
              </t-radio-group>
            </t-form-item>
            <t-form-item name="word_mode" label="出题模式">
              <t-radio-group v-model="createData.word_mode" variant="default-filled">
                <t-radio-button value="simulate">模拟</t-radio-button>
                <t-radio-button value="new">新题</t-radio-button>
                <t-radio-button value="random">随机</t-radio-button>
                <t-radio-button value="sequential">顺序</t-radio-button>
                <t-radio-button value="reverse">倒序</t-radio-button>
              </t-radio-group>
              <span class="form-hint mode-hint">{{ wordModeHint }}</span>
            </t-form-item>
            <t-form-item name="hint_options" label="提示选项">
              <div class="hint-options">
                <t-checkbox v-model="createData.show_chinese">中文词义</t-checkbox>
                <t-checkbox v-model="createData.show_english">英文释义</t-checkbox>
              </div>
            </t-form-item>
            <div class="form-actions">
              <t-button variant="outline" @click="showCreateDialog = false">
                <template #icon><t-icon name="close" /></template>
                取消
              </t-button>
              <t-button theme="primary" type="submit" :loading="creating">
                <template #icon><t-icon name="add" /></template>
                创建
              </t-button>
            </div>
          </t-form>
        </div>
      </div>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, h, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { SearchIcon } from 'tdesign-icons-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useChallengeStore } from '@/stores/challenge'
import { useWordsStore } from '@/stores/words'
import { supabase } from '@/lib/supabase'
import ChallengeRoom from '@/components/ChallengeRoom.vue'

const baseUrl = import.meta.env.BASE_URL
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const challengeStore = useChallengeStore()
const wordsStore = useWordsStore()

const showCreateDialog = ref(false)
const creating = ref(false)
const quickCreating = ref(null) // 快速创建状态：null, 2, 3
const showCustomCreate = ref(false) // 定制挑战赛展开状态，默认不展开
const connectingId = ref(null) // 正在连接的挑战赛ID
const coverFiles = ref([])
const uploadingCover = ref(false)
const uploadRef = ref(null) // 上传组件引用

// 封面类型：none, default, random, custom
const coverType = ref('default')
const customCoverUrl = ref('')
const randomCoverUrl = ref('')
const loadingRandomCover = ref(false)
const defaultCoverUrl = `${import.meta.env.BASE_URL}challenge-default.svg`

// 获取封面图片URL（处理默认封面和旧数据兼容）
function getCoverUrl(challenge) {
  if (!challenge.image_url) return ''
  // 如果是默认封面标识或包含 challenge-default.svg，使用当前环境的默认封面路径
  if (challenge.image_url === 'default' || challenge.image_url.includes('challenge-default.svg')) {
    return defaultCoverUrl
  }
  // 否则直接返回存储的URL（自定义封面）
  return challenge.image_url
}

// 过滤和分页
const statusFilter = ref('all')
const searchKeyword = ref('')
const currentPage = ref(1)
const pageSize = 12

// 滚动位置保存
const savedScrollPosition = ref(0)

// 状态统计
const statusCounts = computed(() => {
  const challenges = challengeStore.challenges
  const userId = authStore.user?.id
  return {
    all: challenges.length,
    waiting: challenges.filter(c => c.status === 'waiting' || c.status === 'ready').length,
    in_progress: challenges.filter(c => c.status === 'in_progress').length,
    finished: challenges.filter(c => c.status === 'finished').length,
    mine: userId ? challenges.filter(c => c.participants?.some(p => p.user_id === userId)).length : 0
  }
})

// 过滤后的挑战赛
const filteredChallenges = computed(() => {
  let result = challengeStore.challenges
  const userId = authStore.user?.id

  // 状态过滤
  if (statusFilter.value === 'mine') {
    // 我的比赛：参赛人员中包含当前用户
    if (userId) {
      result = result.filter(c => c.participants?.some(p => p.user_id === userId))
    } else {
      result = []
    }
  } else if (statusFilter.value !== 'all') {
    if (statusFilter.value === 'waiting') {
      result = result.filter(c => c.status === 'waiting' || c.status === 'ready')
    } else {
      result = result.filter(c => c.status === statusFilter.value)
    }
  }

  // 搜索过滤
  if (searchKeyword.value.trim()) {
    const keyword = searchKeyword.value.trim().toLowerCase()
    result = result.filter(c => 
      c.name.toLowerCase().includes(keyword) ||
      c.creator_name?.toLowerCase().includes(keyword)
    )
  }

  return result
})

// 分页后的挑战赛
const paginatedChallenges = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredChallenges.value.slice(start, start + pageSize)
})

// 重置筛选
function resetFilters() {
  statusFilter.value = 'all'
  searchKeyword.value = ''
  currentPage.value = 1
}

// 设置存储键
const CHALLENGE_SETTINGS_KEY = 'spellingbee_challenge_settings'

const createData = reactive({
  name: '',
  description: '',
  image_url: '',
  max_participants: 2,
  entry_fee: 100,
  word_count: 10,
  time_limit: 30,
  difficulty: null,
  word_mode: 'simulate', // 比赛模式：simulate, new, random, sequential, reverse
  show_chinese: true, // 显示中文词义
  show_english: true // 显示英文释义
})

// 加载保存的设置
async function loadSettings() {
  try {
    const saved = localStorage.getItem(CHALLENGE_SETTINGS_KEY)
    if (saved) {
      const settings = JSON.parse(saved)
      Object.assign(createData, {
        max_participants: settings.max_participants ?? 2,
        entry_fee: settings.entry_fee ?? 100,
        word_count: settings.word_count ?? 10,
        time_limit: settings.time_limit ?? 30,
        difficulty: settings.difficulty ?? null,
        word_mode: settings.word_mode ?? 'simulate',
        show_chinese: settings.show_chinese ?? true,
        show_english: settings.show_english ?? true
      })
    }
  } catch (e) {
    console.error('Error loading challenge settings:', e)
  }
}

// 保存设置
function saveSettings() {
  try {
    localStorage.setItem(CHALLENGE_SETTINGS_KEY, JSON.stringify({
      max_participants: createData.max_participants,
      entry_fee: createData.entry_fee,
      word_count: createData.word_count,
      time_limit: createData.time_limit,
      difficulty: createData.difficulty,
      word_mode: createData.word_mode,
      show_chinese: createData.show_chinese,
      show_english: createData.show_english
    }))
  } catch (e) {
    console.error('Error saving challenge settings:', e)
  }
}

// 获取随机单词作为挑战赛名称
async function getRandomWordForName() {
  // 确保词汇表已加载
  if (wordsStore.words.length === 0) {
    await wordsStore.init()
  }
  
  if (wordsStore.words.length > 0) {
    const randomIndex = Math.floor(Math.random() * wordsStore.words.length)
    return wordsStore.words[randomIndex].word
  }
  
  // 如果词汇表为空，使用时间戳
  return Date.now().toString(36)
}

// 打开创建对话框
async function openCreateDialog() {
  const randomWord = await getRandomWordForName()
  createData.name = `挑战赛-${randomWord.toUpperCase()}`
  // 重置封面选择为默认
  coverType.value = 'default'
  createData.image_url = 'default' // 使用标识符而不是完整路径
  customCoverUrl.value = ''
  randomCoverUrl.value = ''
  coverFiles.value = []
  showCreateDialog.value = true
}

const createRules = {
  name: [
    { required: true, message: '请输入挑战赛名称', type: 'error' },
    { min: 2, max: 30, message: '名称长度2-30个字符', type: 'error' }
  ]
}

const timeLimitMarks = { 15: '15s', 30: '30s', 45: '45s', 60: '60s' }

// 出题模式提示
const wordModeHint = computed(() => {
  switch (createData.word_mode) {
    case 'simulate':
      return '模拟真实比赛，按难度递进出题'
    case 'new':
      return '优先出现未考过的单词'
    case 'random':
      return '完全随机打乱顺序'
    case 'sequential':
      return '按词库顺序依次出题'
    case 'reverse':
      return '按词库倒序依次出题'
    default:
      return ''
  }
})

// 格式化时间
function formatTime(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // 小于1分钟
  if (diff < 60 * 1000) {
    return '刚刚'
  }
  // 小于1小时
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))}分钟前`
  }
  // 小于24小时
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))}小时前`
  }
  // 小于7天
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (24 * 60 * 60 * 1000))}天前`
  }
  // 否则显示日期
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function getStatusText(status) {
  const map = {
    waiting: '等待中',
    ready: '准备就绪',
    in_progress: '进行中',
    finished: '已结束',
    cancelled: '已取消'
  }
  return map[status] || status
}

function isJoined(challenge) {
  if (!authStore.user) return false
  return challenge.participants?.some(p => p.user_id === authStore.user.id)
}

// 判断是否是管理员（创建者）
function isAdmin(challenge) {
  if (!authStore.user) return false
  return challenge.creator_id === authStore.user.id
}

// 获取排序后的参赛者（创建者排第一）
function getSortedParticipants(challenge) {
  if (!challenge.participants) return []
  return [...challenge.participants].sort((a, b) => {
    if (a.user_id === challenge.creator_id) return -1
    if (b.user_id === challenge.creator_id) return 1
    return 0
  })
}

// 获取创建者
function getCreator(challenge) {
  return challenge.participants?.find(p => p.user_id === challenge.creator_id)
}

// 获取非创建者的参赛者
function getOtherParticipants(challenge) {
  return challenge.participants?.filter(p => p.user_id !== challenge.creator_id) || []
}

// 自定义上传方法
const customUpload = () => {
  return Promise.resolve({ status: 'success', response: {} })
}

// 处理封面图片选择
const handleCoverChange = async (value) => {
  if (!value || value.length === 0) return
  
  const file = value[0]
  if (!file.raw) return
  
  // 检查文件大小（限制 2MB）
  if (file.raw.size > 2 * 1024 * 1024) {
    MessagePlugin.error('图片大小不能超过 2MB')
    coverFiles.value = []
    return
  }
  
  // 检查文件类型
  if (!file.raw.type.startsWith('image/')) {
    MessagePlugin.error('请选择图片文件')
    coverFiles.value = []
    return
  }
  
  await uploadCover(file.raw)
}

// 上传封面到 Supabase Storage
const uploadCover = async (file) => {
  if (!authStore.user) return
  
  uploadingCover.value = true
  
  try {
    const fileExt = file.name.split('.').pop()
    const fileName = `challenge-${Date.now()}.${fileExt}`
    const filePath = `challenges/${fileName}`
    
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError) {
      console.error('Upload error:', uploadError)
      MessagePlugin.error('上传失败，请重试')
      return
    }
    
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)
    
    if (urlData?.publicUrl) {
      customCoverUrl.value = urlData.publicUrl
      createData.image_url = urlData.publicUrl
      coverType.value = 'custom'
      MessagePlugin.success('封面上传成功')
    }
  } catch (error) {
    console.error('Upload error:', error)
    MessagePlugin.error('上传失败，请重试')
  } finally {
    uploadingCover.value = false
  }
}

// 移除封面
const removeCover = () => {
  createData.image_url = ''
  coverFiles.value = []
  customCoverUrl.value = ''
  coverType.value = 'none'
}

// 选择封面类型
function selectCoverType(type) {
  coverType.value = type
  if (type === 'none') {
    createData.image_url = ''
  } else if (type === 'default') {
    createData.image_url = 'default' // 使用标识符而不是完整路径
  } else if (type === 'random' && randomCoverUrl.value) {
    createData.image_url = randomCoverUrl.value
  } else if (type === 'custom' && customCoverUrl.value) {
    createData.image_url = customCoverUrl.value
  }
}

// 选择随机封面
async function selectRandomCover() {
  coverType.value = 'random'
  await fetchRandomCover()
}

// 获取随机封面图片
async function fetchRandomCover() {
  if (loadingRandomCover.value) return // 防止重复请求
  
  loadingRandomCover.value = true
  
  try {
    // 使用 Picsum API 获取随机图片（更稳定）
    // 使用随机种子确保每次获取不同图片
    const seed = Date.now() + Math.random().toString(36).slice(2, 8)
    const imageUrl = `https://picsum.photos/seed/${seed}/400/200`
    
    // 预加载图片确保可用
    await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        // 获取实际加载的URL（Picsum会重定向到CDN）
        randomCoverUrl.value = img.src
        createData.image_url = img.src
        resolve()
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = imageUrl
      // 设置超时
      setTimeout(() => reject(new Error('timeout')), 10000)
    })
  } catch (error) {
    console.error('Failed to fetch random cover:', error)
    MessagePlugin.error('获取随机图片失败，请重试')
  } finally {
    loadingRandomCover.value = false
  }
}

// 触发上传
function triggerUpload() {
  coverType.value = 'custom'
  if (customCoverUrl.value) {
    createData.image_url = customCoverUrl.value
  } else {
    // 触发文件选择
    const input = document.querySelector('.cover-selection input[type="file"]')
    if (input) input.click()
  }
}

// 保存当前滚动位置
function saveScrollPosition() {
  savedScrollPosition.value = window.scrollY || document.documentElement.scrollTop
}

// 恢复滚动位置（无动画，直接跳转）
function restoreScrollPosition() {
  if (savedScrollPosition.value > 0) {
    // 使用 requestAnimationFrame 确保 DOM 已渲染，同时使用 instant 避免滚动动画
    requestAnimationFrame(() => {
      window.scrollTo({
        top: savedScrollPosition.value,
        behavior: 'instant'
      })
    })
  }
}

async function viewChallenge(challenge) {
  if (!authStore.user) {
    MessagePlugin.warning('请先登录')
    return
  }
  
  // 已结束的比赛，点击查看详情
  if (challenge.status === 'finished' || challenge.status === 'cancelled') {
    viewChallengeDetail(challenge)
    return
  }
  
  if (connectingId.value) return // 防止重复点击
  
  // 保存滚动位置
  saveScrollPosition()
  
  connectingId.value = challenge.id
  try {
    await challengeStore.joinChallenge(challenge.id)
    // 更新 URL
    router.push({ name: 'ChallengeRoom', params: { id: challenge.id } })
    if (!isJoined(challenge)) {
      MessagePlugin.success('加入成功')
    }
  } catch (error) {
    MessagePlugin.error(error.message || '进入失败')
  } finally {
    connectingId.value = null
  }
}

// 查看已结束挑战赛的详情
function viewChallengeDetail(challenge) {
  // 保存滚动位置
  saveScrollPosition()
  
  challengeStore.viewFinishedChallenge(challenge)
  // 更新 URL
  router.push({ name: 'ChallengeRoom', params: { id: challenge.id } })
}

async function enterChallenge(challenge) {
  if (!authStore.user) {
    MessagePlugin.warning('请先登录')
    return
  }

  if (connectingId.value) return
  
  // 保存滚动位置
  saveScrollPosition()
  
  connectingId.value = challenge.id
  try {
    await challengeStore.joinChallenge(challenge.id)
    // 更新 URL
    router.push({ name: 'ChallengeRoom', params: { id: challenge.id } })
  } catch (error) {
    MessagePlugin.error(error.message || '进入失败')
  } finally {
    connectingId.value = null
  }
}

async function joinChallenge(challenge) {
  if (!authStore.user) {
    MessagePlugin.warning('请先登录')
    return
  }

  if (connectingId.value) return
  
  // 保存滚动位置
  saveScrollPosition()
  
  connectingId.value = challenge.id
  try {
    await challengeStore.joinChallenge(challenge.id)
    // 更新 URL
    router.push({ name: 'ChallengeRoom', params: { id: challenge.id } })
    MessagePlugin.success('加入成功')
  } catch (error) {
    MessagePlugin.error(error.message || '加入失败')
  } finally {
    connectingId.value = null
  }
}

// 删除挑战赛
async function handleDelete(challenge) {
  const dialog = DialogPlugin.confirm({
    header: '确认删除',
    body: `确定要删除挑战赛「${challenge.name}」吗？此操作不可恢复。`,
    confirmBtn: { content: '删除', theme: 'danger' },
    onConfirm: async () => {
      try {
        await challengeStore.deleteChallenge(challenge.id)
        MessagePlugin.success('删除成功')
      } catch (error) {
        MessagePlugin.error(error.message || '删除失败')
      }
      dialog.destroy()
    },
    onClose: () => dialog.destroy()
  })
}

// 快速创建挑战赛（两人/三人对战）
async function quickCreate(playerCount) {
  quickCreating.value = playerCount
  
  try {
    // 生成随机名称
    const randomWord = await getRandomWordForName()
    const name = `${playerCount}人对战-${randomWord.toUpperCase()}`
    
    // 检查名称是否重复
    const { data: existing } = await supabase
      .from('challenges')
      .select('id')
      .eq('name', name)
      .limit(1)
    
    if (existing && existing.length > 0) {
      // 如果重复，添加时间戳
      const timestamp = Date.now().toString(36).slice(-4)
      const uniqueName = `${playerCount}人对战-${randomWord.toUpperCase()}-${timestamp}`
      await doQuickCreate(uniqueName, playerCount)
    } else {
      await doQuickCreate(name, playerCount)
    }
  } catch (error) {
    MessagePlugin.error(error.message || '创建失败')
  } finally {
    quickCreating.value = null
  }
}

// 执行快速创建
async function doQuickCreate(name, playerCount) {
  // 保存设置
  saveSettings()
  
  await challengeStore.createChallenge({
    name,
    description: undefined,
    image_url: 'default',
    max_participants: playerCount,
    entry_fee: createData.entry_fee,
    word_count: createData.word_count,
    time_limit: createData.time_limit,
    difficulty: createData.difficulty,
    word_mode: createData.word_mode,
    show_chinese: createData.show_chinese,
    show_english: createData.show_english
  })
  
  showCreateDialog.value = false
  MessagePlugin.success(`${playerCount}人对战创建成功`)
}

async function handleCreate({ validateResult }) {
  if (validateResult !== true) return

  creating.value = true
  try {
    // 检查名称是否重复
    const { data: existing } = await supabase
      .from('challenges')
      .select('id')
      .eq('name', createData.name)
      .limit(1)
    
    if (existing && existing.length > 0) {
      MessagePlugin.warning('挑战赛名称已存在，请更换一个名称')
      creating.value = false
      return
    }

    // 保存设置
    saveSettings()

    await challengeStore.createChallenge({
      name: createData.name,
      description: createData.description || undefined,
      image_url: createData.image_url || undefined,
      max_participants: createData.max_participants,
      entry_fee: createData.entry_fee,
      word_count: createData.word_count,
      time_limit: createData.time_limit,
      difficulty: createData.difficulty,
      word_mode: createData.word_mode,
      show_chinese: createData.show_chinese,
      show_english: createData.show_english
    })
    
    showCreateDialog.value = false
    MessagePlugin.success('挑战赛创建成功')
    
    // 重置名称和封面，保留其他设置
    createData.name = ''
    createData.description = ''
    createData.image_url = ''
    coverFiles.value = []
    customCoverUrl.value = ''
    randomCoverUrl.value = ''
    coverType.value = 'default'
  } catch (error) {
    MessagePlugin.error(error.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function refreshList() {
  await challengeStore.loadChallenges(true) // 强制刷新
}

// 通过 URL 参数加入挑战赛
async function joinChallengeById(challengeId) {
  if (!challengeId) return
  
  // 先加载列表以获取挑战赛信息
  await challengeStore.loadChallenges()
  
  // 如果已经在这个挑战赛中，不需要重新加入
  if (challengeStore.currentChallenge?.id === challengeId) return
  
  connectingId.value = challengeId
  try {
    await challengeStore.joinChallenge(challengeId)
  } catch (error) {
    MessagePlugin.error(error.message || '加入失败')
    // 加入失败，返回列表
    router.replace({ name: 'Challenge' })
  } finally {
    connectingId.value = null
  }
}

// 监听 currentChallenge 变化，同步 URL
watch(() => challengeStore.currentChallenge, (newVal, oldVal) => {
  if (newVal && route.params.id !== newVal.id) {
    // 进入挑战赛，更新 URL
    router.replace({ name: 'ChallengeRoom', params: { id: newVal.id } })
  } else if (!newVal && oldVal && route.params.id) {
    // 离开挑战赛，返回列表
    router.replace({ name: 'Challenge' })
    // 恢复滚动位置
    restoreScrollPosition()
  }
})

onMounted(async () => {
  await loadSettings()
  await challengeStore.loadChallenges()
  
  // 如果 URL 中有挑战赛 ID，尝试加入
  const challengeId = route.params.id
  if (challengeId) {
    await joinChallengeById(challengeId)
  }
})
</script>

<style lang="scss" scoped>
.challenge-page {
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;

  .header-info {
    display: flex;
    align-items: center;
    gap: 1rem;

    .header-icon {
      width: 60px;
      height: 60px;
      animation: float 3s ease-in-out infinite;
    }

    h1 {
      margin: 0;
      font-size: 1.75rem;
    }

    p {
      margin: 0.25rem 0 0;
      color: var(--text-secondary);
    }
  }

  .header-actions {
    display: flex;
    gap: 0.75rem;
  }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.login-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--warning-light, #fef3c7);
  border-radius: 8px;
  color: var(--warning, #d97706);
  margin-bottom: 1.5rem;
}

.filter-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;

  .status-tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;

    .status-tab {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--bg-card);
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s;
      border: 2px solid transparent;

      &:hover {
        background: var(--hover-bg);
      }

      &.active {
        border-color: var(--honey-400);
        background: var(--honey-50);
      }

      .tab-label {
        font-size: 0.9rem;
        color: var(--text-primary);
      }

      .tab-count {
        font-size: 0.75rem;
        padding: 0.125rem 0.5rem;
        border-radius: 10px;
        background: var(--charcoal-200);
        color: var(--text-secondary);

        &.waiting {
          background: var(--honey-100);
          color: var(--honey-700);
        }

        &.in_progress {
          background: var(--primary-light, #dbeafe);
          color: var(--primary);
        }

        &.finished {
          background: var(--success-light, #d1fae5);
          color: var(--success);
        }

        &.mine {
          background: var(--primary-light, #dbeafe);
          color: var(--primary);
        }
      }
    }
  }

  .search-box {
    min-width: 200px;
    max-width: 280px;
  }
}

.pagination-section {
  display: flex;
  justify-content: center;
  margin-top: 1.5rem;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 4rem;
  color: var(--text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 4rem;
  text-align: center;
  color: var(--text-secondary);

  h3 {
    margin: 0;
    color: var(--text-primary);
  }

  p {
    margin: 0;
  }
}

.challenge-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.challenge-card {
  background: var(--bg-card);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: all 0.3s;
  cursor: pointer;
  position: relative;

  &:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
  }

  &.connecting {
    pointer-events: none;
    
    .card-image, .card-content, .card-action {
      opacity: 0.5;
    }
  }

  &.finished {
    opacity: 0.9;
    
    .card-image {
      background: linear-gradient(135deg, var(--success-light, #d1fae5) 0%, var(--success, #10b981) 100%);
    }
  }

  &.cancelled {
    opacity: 0.7;
    
    .card-image {
      filter: grayscale(50%);
    }
  }

  .connecting-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.9);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    z-index: 10;
    color: var(--text-primary);
    font-weight: 500;
  }

  .card-image {
    position: relative;
    height: 120px;
    background: linear-gradient(135deg, var(--honey-400) 0%, var(--honey-500) 100%);

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .card-image-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: white;
      opacity: 0.8;
    }

    .card-status {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.9);
      color: var(--text-primary);

      &.waiting {
        background: var(--honey-100);
        color: var(--honey-700);
      }

      &.ready {
        background: var(--success-light, #d1fae5);
        color: var(--success);
      }

      &.in_progress {
        background: var(--primary-light, #dbeafe);
        color: var(--primary);
      }

      &.finished {
        background: var(--success-light, #d1fae5);
        color: var(--success);
      }

      &.cancelled {
        background: var(--error-light, #fee2e2);
        color: var(--error);
      }
    }

    .delete-btn {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 50%;
      width: 32px;
      height: 32px;
      padding: 0;
      
      &:hover {
        background: var(--error-light, #fee2e2);
      }
    }
  }

  .card-content {
    padding: 1rem;

    .card-title {
      margin: 0 0 0.5rem;
      font-size: 1.1rem;
      font-weight: 600;
    }



    .card-meta {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.5rem;

      .meta-item {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.85rem;
        color: var(--text-secondary);
      }
    }

    .card-info-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--charcoal-100);
      font-size: 0.8rem;
      color: var(--text-muted);

      .card-time, .card-participants-count {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
    }

    .card-participants-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;

      .participant-chip {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.15rem 0.5rem 0.15rem 0.15rem;
        background: var(--hover-bg);
        border-radius: 20px;
        font-size: 0.75rem;

        .winner-icon {
          font-size: 14px;
          margin-left: 2px;
        }

        .participant-name {
          color: var(--text-secondary);
          max-width: 100px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        &.is-winner {
          background: linear-gradient(135deg, var(--honey-100) 0%, var(--honey-200) 100%);
          
          .participant-name {
            color: var(--honey-700);
            font-weight: 600;
          }
        }
      }

      .winner-icon-only {
        font-size: 16px;
        margin-left: -4px;
      }

      .participant-avatar-only {
        margin-left: -4px;
      }
    }

    .card-time {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }
  }

  .card-action {
    padding: 0 1rem 1rem;
  }
}

// 封面选择样式
.cover-selection {
  position: relative;

  .cover-options {
    display: flex;
    gap: 0.3rem;
  }

  .cover-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;

    .cover-option-preview {
      width: 80px;
      height: 54px;
      border: 2px solid var(--charcoal-200);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      background: var(--bg-card);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      &.empty {
        background: var(--charcoal-50);
        color: var(--text-secondary);
      }
    }

    span {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    &:hover .cover-option-preview {
      border-color: var(--honey-400);
    }

    &.active {
      .cover-option-preview {
        border-color: var(--honey-500);
        box-shadow: 0 0 0 2px var(--honey-200);
      }

      span {
        color: var(--honey-600);
        font-weight: 500;
      }
    }
  }

  .upload-loading {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
  }
}

.form-hint {
  margin-left: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.hint-options {
  display: flex;
  gap: 1.5rem;
}

// 快速创建区域样式
.quick-create-section {
  margin-bottom: 1rem;
  min-width: 100%; // 确保宽度稳定

  .quick-create-buttons {
    display: flex;
    gap: 1rem;

    .t-button {
      flex: 1;
      height: 56px;
      font-size: 1rem;
    }
  }
}

// 定制挑战赛区域样式
.custom-create-section {
  min-width: 100%; // 确保宽度稳定

  .custom-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 0;
    cursor: pointer;
    color: var(--text-secondary);
    transition: color 0.2s;

    &:hover {
      color: var(--text-primary);
    }

    .toggle-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 500;
    }
  }

  .custom-content {
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
    
    &.collapsed {
      max-height: 0;
      opacity: 0;
      padding-top: 0;
    }
    
    &.expanded {
      max-height: 1000px;
      opacity: 1;
      padding-top: 1rem;
    }
  }
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 1.5rem;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    gap: 1rem;
    text-align: center;

    .header-info {
      flex-direction: column;
    }

    .header-actions {
      width: 100%;
      justify-content: center;
    }
  }

  .challenge-cards {
    grid-template-columns: 1fr;
  }

  // 移动端创建挑战赛弹窗优化
  :deep(.t-dialog) {
    .t-dialog__body {
      max-height: 60vh;
      overflow-y: auto;
      padding: 1rem;
    }
  }

  // 快速创建按钮移动端优化
  .quick-create-section {
    margin-bottom: 0.75rem;

    .quick-create-buttons {
      gap: 0.75rem;

      .t-button {
        height: 48px;
        font-size: 0.9rem;
      }
    }
  }

  // 移动端定制挑战赛表单优化
  .custom-create-section {
    .custom-toggle {
      padding: 0.5rem 0;
    }

    .custom-content {
      max-width: 100%;
      box-sizing: border-box;

      &.expanded {
        padding-top: 0.75rem;
      }

      :deep(.t-form) {
        max-width: 100%;

        .t-form__item {
          flex-direction: column;
          align-items: flex-start;
          margin-bottom: 0.75rem;

          .t-form__label {
            width: auto !important;
            padding-right: 0;
            margin-bottom: 0.25rem;
            font-size: 0.85rem;
          }

          .t-form__controls {
            width: 100%;
            margin-left: 0 !important;
          }
        }

        // radio-group 自适应换行
        .t-radio-group {
          flex-wrap: wrap;
          gap: 0.35rem;

          .t-radio-button {
            flex: none;
            padding: 0 0.5rem;
            font-size: 0.8rem;
            height: 28px;
            line-height: 26px;
          }
        }

        // 滑块宽度自适应
        .t-slider {
          width: 100%;
        }

        // 输入框优化
        .t-input, .t-textarea, .t-input-number {
          font-size: 0.9rem;
        }
      }
    }
  }

  // 封面选项移动端优化
  .cover-options {
    gap: 0.5rem !important;

    .cover-option {
      .cover-option-preview {
        width: 80px !important;
        height: 54px !important;
      }

      span {
        font-size: 0.75rem;
      }
    }
  }

  // 表单提示文字优化
  .form-hint {
    font-size: 0.75rem;
    margin-top: 0.25rem;
  }

  // 表单操作按钮优化
  .form-actions {
    margin-top: 1rem;
    gap: 0.75rem;
    
    .t-button {
      font-size: 0.9rem;
    }
  }
}
</style>
