<template>
  <div class="challenge-page">
    <!-- 挑战赛列表 -->
    <div class="challenge-list" v-if="!challengeStore.currentChallenge">
      <div class="page-header">
        <h1>多人挑战赛</h1>
        <p>创建或加入挑战赛，与其他玩家实时对战</p>
        <div class="header-actions">
          <t-button theme="primary" size="large" @click="openCreateDialog" :disabled="!authStore.user">
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
        <!-- 桌面端：状态标签 -->
        <div class="status-tabs desktop-only">
          <div class="status-tab" :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">
            <span class="tab-label">全部</span>
            <span class="tab-count">{{ statusCounts.all }}</span>
          </div>
          <div class="status-tab" :class="{ active: statusFilter === 'waiting' }" @click="statusFilter = 'waiting'">
            <span class="tab-label">等待中</span>
            <span class="tab-count waiting">{{ statusCounts.waiting }}</span>
          </div>
          <div class="status-tab" :class="{ active: statusFilter === 'in_progress' }"
            @click="statusFilter = 'in_progress'">
            <span class="tab-label">进行中</span>
            <span class="tab-count in_progress">{{ statusCounts.in_progress }}</span>
          </div>
          <div class="status-tab" :class="{ active: statusFilter === 'finished' }" @click="statusFilter = 'finished'">
            <span class="tab-label">已结束</span>
            <span class="tab-count finished">{{ statusCounts.finished }}</span>
          </div>
          <div v-if="authStore.user" class="status-tab" :class="{ active: statusFilter === 'mine' }"
            @click="statusFilter = 'mine'">
            <span class="tab-label">我的比赛</span>
            <span class="tab-count mine">{{ statusCounts.mine }}</span>
          </div>
        </div>
        <div class="search-box">
          <!-- 手机端：状态下拉选择 -->
          <t-select v-model="statusFilter" class="status-select mobile-only"
            :popup-props="{ overlayClassName: 'status-select-popup' }">
            <t-option value="all" :label="`全部 (${statusCounts.all})`" />
            <t-option value="waiting" :label="`等待中 (${statusCounts.waiting})`" />
            <t-option value="in_progress" :label="`进行中 (${statusCounts.in_progress})`" />
            <t-option value="finished" :label="`已结束 (${statusCounts.finished})`" />
            <t-option v-if="authStore.user" value="mine" :label="`我的比赛 (${statusCounts.mine})`" />
          </t-select>
          <t-input v-model="searchKeyword" placeholder="搜索挑战赛名称..." clearable :prefix-icon="() => h(SearchIcon)" />
          <t-button variant="outline" @click="refreshList" :loading="challengeStore.loading" class="refresh-btn">
            <template #icon><t-icon name="refresh" /></template>
          </t-button>
        </div>
      </div>

      <!-- 加载中（只在没有数据时显示） -->
      <div class="loading-container" v-if="challengeStore.loading && challengeStore.challenges.length === 0">
        <t-loading v-if="!isLoadingTimeout" />
        <span v-if="!isLoadingTimeout">加载挑战赛列表...</span>
        <template v-else>
          <t-icon name="error-circle" size="48px" />
          <span>加载超时</span>
          <t-button theme="primary" @click="forceReload">重新加载</t-button>
        </template>
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
        <div class="challenge-card" v-for="challenge in paginatedChallenges" :key="challenge.id"
          :class="{ connecting: connectingId === challenge.id, finished: challenge.status === 'finished', cancelled: challenge.status === 'cancelled' }"
          @click="viewChallenge(challenge)">
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
            <t-button v-if="isAdmin(challenge)" class="delete-btn" variant="text" theme="danger" size="small"
              @click.stop="handleDelete(challenge)">
              <template #icon><t-icon name="delete" /></template>
            </t-button>
          </div>
          <div class="card-content">
            <h3 class="card-title">{{ challenge.name }}</h3>
            <!-- 词典名称 -->
            <div class="card-dictionary" v-if="challenge.dictionary_name">
              <t-icon name="books" size="14px" />
              <span>{{ challenge.dictionary_name }}</span>
            </div>
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
                <div class="participant-chip" v-for="p in getSortedParticipants(challenge)" :key="p.user_id"
                  :class="{ 'is-winner': challenge.status === 'finished' && p.user_id === challenge.winner_id }">
                  <span class="winner-icon"
                    v-if="challenge.status === 'finished' && p.user_id === challenge.winner_id">🏆</span>
                  <t-avatar v-else size="18px" :image="normalizeMediaUrl(p.avatar_url)">{{ p.nickname?.charAt(0) }}</t-avatar>
                  <span class="participant-name">{{ p.nickname }}</span>
                </div>
              </template>
              <template v-else>
                <!-- 创建者显示名称 -->
                <div class="participant-chip" v-if="getCreator(challenge)"
                  :class="{ 'is-winner': challenge.status === 'finished' && getCreator(challenge).user_id === challenge.winner_id }">
                  <span class="winner-icon"
                    v-if="challenge.status === 'finished' && getCreator(challenge).user_id === challenge.winner_id">🏆</span>
                  <t-avatar v-else size="18px" :image="normalizeMediaUrl(getCreator(challenge).avatar_url)">{{
                    getCreator(challenge).nickname?.charAt(0) }}</t-avatar>
                  <span class="participant-name">{{ getCreator(challenge).nickname }}</span>
                </div>
                <!-- 其他人只显示图标 -->
                <template v-for="p in getOtherParticipants(challenge)" :key="p.user_id">
                  <span class="winner-icon-only"
                    v-if="challenge.status === 'finished' && p.user_id === challenge.winner_id">🏆</span>
                  <t-avatar v-else size="18px" :image="normalizeMediaUrl(p.avatar_url)" class="participant-avatar-only">{{
                    p.nickname?.charAt(0) }}</t-avatar>
                </template>
              </template>
            </div>
          </div>
          <div class="card-action">
            <t-button v-if="challenge.status === 'finished' || challenge.status === 'cancelled'" variant="outline"
              size="small" @click.stop="viewChallengeDetail(challenge)">
              <template #icon><t-icon name="browse" /></template>
              查看详情
            </t-button>
            <t-button v-else-if="isJoined(challenge)" theme="primary" size="small"
              :loading="connectingId === challenge.id" @click.stop="enterChallenge(challenge)">
              <template #icon><t-icon name="enter" /></template>
              进入房间
            </t-button>
            <t-button v-else theme="primary" size="small"
              :disabled="!authStore.user || challenge.participants?.length >= challenge.max_participants"
              :loading="connectingId === challenge.id" @click.stop="joinChallenge(challenge)">
              <template #icon><t-icon name="user-add" /></template>
              报名参赛
            </t-button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pagination-section" v-if="filteredChallenges.length > pageSize">
        <t-pagination v-model:current="currentPage" v-model:page-size="pageSize" :total="filteredChallenges.length"
          :page-size-options="pageSizeOptions" :show-jumper="false" size="medium" />
      </div>

    </div>

    <!-- 挑战赛房间 -->
    <ChallengeRoom v-else />

    <!-- 创建挑战赛对话框 -->
    <t-dialog v-model:visible="showCreateDialog" header="创建挑战赛" :footer="false" width="500px">
      <!-- 当前词典提示 -->
      <div class="current-dictionary" v-if="currentDictionaryInfo" @click="goToDictionary">
        <t-icon name="book" />
        <span>{{ currentDictionaryInfo.name }}</span>
        <t-icon name="chevron-right" size="14px" />
      </div>
      
      <!-- 快速创建按钮 -->
      <div class="quick-create-section">
        <div class="quick-create-buttons">
          <t-button theme="primary" size="large" block :loading="quickCreating === 2" :disabled="quickCreating !== null"
            @click="quickCreate(2)">
            <template #icon><t-icon name="usergroup-add" /></template>
            两人对战
          </t-button>
          <t-button variant="outline" size="large" block :loading="quickCreating === 3"
            :disabled="quickCreating !== null" @click="quickCreate(3)">
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
          <t-form ref="createForm" :data="createData" :rules="createRules" @submit="handleCreate" label-width="100px">
            <t-form-item name="name" label="名称">
              <t-input v-model="createData.name" placeholder="给挑战赛起个名字" maxlength="30" />
            </t-form-item>
            <t-form-item name="description" label="描述">
              <t-textarea v-model="createData.description" placeholder="描述一下这场挑战赛（可选）" maxlength="200" />
            </t-form-item>
            <t-form-item name="image_url" label="封面图片">
              <div class="cover-selection">
                <div class="cover-options">
                  <div class="cover-option" :class="{ active: coverType === 'none' }" @click="selectCoverType('none')">
                    <div class="cover-option-preview empty">
                      <t-icon name="image" size="24px" />
                    </div>
                    <span>无封面</span>
                  </div>
                  <div class="cover-option" :class="{ active: coverType === 'default' }"
                    @click="selectCoverType('default')">
                    <div class="cover-option-preview">
                      <img :src="`${baseUrl}challenge-default.svg`" alt="默认封面" />
                    </div>
                    <span>默认</span>
                  </div>
                  <div class="cover-option" :class="{ active: coverType === 'random' }" @click="selectRandomCover">
                    <div class="cover-option-preview" v-if="randomCoverUrl && !loadingRandomCover">
                      <img :src="randomCoverUrl" alt="随机封面" />
                    </div>
                    <div class="cover-option-preview empty" v-else>
                      <t-loading v-if="loadingRandomCover" size="small" />
                      <t-icon v-else name="refresh" size="24px" />
                    </div>
                    <span>随机</span>
                  </div>
                  <div class="cover-option" :class="{ active: coverType === 'custom' }" @click="triggerUpload">
                    <div class="cover-option-preview" v-if="customCoverUrl">
                      <img :src="customCoverUrl" alt="自定义封面" />
                    </div>
                    <div class="cover-option-preview empty" v-else>
                      <t-icon name="upload" size="24px" />
                    </div>
                    <span>自定义</span>
                  </div>
                </div>
                <t-upload ref="uploadRef" v-model="coverFiles" :action="''" theme="custom" accept="image/*"
                  :auto-upload="false" :show-upload-progress="false" :request-method="customUpload"
                  @change="handleCoverChange" style="display: none;" />
                <t-loading v-if="uploadingCover" size="small" class="upload-loading" />
              </div>
            </t-form-item>
            <t-form-item name="max_participants" label="参赛人数">
              <t-input-number v-model="createData.max_participants" :min="2" :max="100" @blur="validateMaxParticipants" />
              <span class="form-hint" :class="{ 'form-hint-error': createData.max_participants > 100 }">
                {{ createData.max_participants > 100 ? '参赛人数不能超过100人' : '2-100人' }}
              </span>
            </t-form-item>
            <t-form-item name="entry_fee" label="参赛积分">
              <t-input-number v-model="createData.entry_fee" :min="0" :max="10000" :step="10" @blur="validateEntryFee" />
              <span class="form-hint" :class="{ 'form-hint-error': createData.entry_fee > 10000 }">
                {{ createData.entry_fee > 10000 ? '参赛积分不能超过10000分' : '赢家将获得所有参赛积分' }}
              </span>
            </t-form-item>
            <t-form-item name="word_count" label="单词数量">
              <t-input-number v-model="createData.word_count" :min="5" :max="500" :step="5" @blur="validateWordCount" />
              <span class="form-hint" :class="{ 'form-hint-error': createData.word_count > 500 }">
                {{ createData.word_count > 500 ? '单词数量不能超过500个' : '5-500个单词' }}
              </span>
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
                <t-radio-button value="wrong">错题</t-radio-button>
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
            <t-form-item name="assisted_input" label="辅助输入">
              <t-switch v-model="createData.assisted_input" />
              <span class="form-hint">{{ createData.assisted_input ? '显示所有字母框和颜色提示' : '逐个显示字母框，无颜色提示' }}</span>
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
import { ref, reactive, onMounted, onUnmounted, computed, h, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { SearchIcon } from 'tdesign-icons-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useChallengeStore } from '@/stores/challenge'
import { useWordsStore } from '@/stores/words'
import { useDictionaryStore } from '@/stores/dictionary'
import { supabase } from '@/lib/supabase'
import { normalizeMediaUrl } from '@/lib/media-url'
import ChallengeRoom from '@/components/ChallengeRoom.vue'

const baseUrl = import.meta.env.BASE_URL
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const challengeStore = useChallengeStore()
const wordsStore = useWordsStore()
const dictionaryStore = useDictionaryStore()

// 当前词典信息（直接从 dictionaryStore 获取，确保响应式）
// 注意：使用 computed 直接访问 store 属性，Vue 会自动追踪依赖
const currentDictionaryInfo = computed(() => {
  // 显式依赖 dictionaryVersion 确保词典切换时重新计算
  void dictionaryStore.dictionaryVersion
  if (dictionaryStore.currentDictionary) {
    return {
      id: dictionaryStore.currentDictionary.id,
      name: dictionaryStore.currentDictionary.name
    }
  }
  return null
})

const showCreateDialog = ref(false)
const creating = ref(false)
const quickCreating = ref(null) // 快速创建状态：null, 2, 3
const showCustomCreate = ref(true) // 定制挑战赛展开状态，默认展开
const connectingId = ref(null) // 正在连接的挑战赛ID
const coverFiles = ref([])
const uploadingCover = ref(false)
const uploadRef = ref(null) // 上传组件引用

// 跳转到词典详情页
function goToDictionary() {
  const dictId = currentDictionaryInfo.value?.id
  if (dictId) {
    router.push(`/dictionaries/${dictId}`)
  }
}

// 保存的随机单词，用于定制挑战赛名称和快捷按钮
const savedRandomWord = ref('')

// 页面可见性变化处理
let lastHiddenTime = 0
const VISIBILITY_RELOAD_THRESHOLD = 3000 // 3秒

async function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    const hiddenDuration = Date.now() - lastHiddenTime

    // 应用从后台恢复时，立即重置 loading 状态
    if (challengeStore.loading) {
      challengeStore.loading = false
      isLoadingTimeout.value = false
    }
    // 清除超时定时器
    if (loadingTimeoutTimer) {
      clearTimeout(loadingTimeoutTimer)
      loadingTimeoutTimer = null
    }
    // 重置 connectingId，避免卡在"正在建立连接"状态
    connectingId.value = null
    // 【关键】重置创建挑战赛按钮状态，避免卡在加载状态
    quickCreating.value = null
    creating.value = false

    // 如果隐藏时间超过阈值，刷新挑战赛列表
    // 注意：Realtime 重连由 RealtimeManager 统一处理，这里不再调用 forceReconnect
    if (hiddenDuration > VISIBILITY_RELOAD_THRESHOLD) {
      // 如果不在房间内，检查是否需要刷新（使用标志机制，避免不必要的请求）
      if (!challengeStore.currentChallenge) {
        await challengeStore.checkAndRefresh()
      }
    }
  } else {
    lastHiddenTime = Date.now()
  }
}

// 加载超时检测
const loadingStartTime = ref(0)
const isLoadingTimeout = ref(false)
const LOADING_TIMEOUT = 10000 // 10秒超时
let loadingTimeoutTimer = null

// 监听 loading 状态变化，记录开始时间
watch(() => challengeStore.loading, (newVal) => {
  if (newVal) {
    loadingStartTime.value = Date.now()
    isLoadingTimeout.value = false
    // 设置超时检测定时器
    if (loadingTimeoutTimer) clearTimeout(loadingTimeoutTimer)
    loadingTimeoutTimer = setTimeout(() => {
      if (challengeStore.loading) {
        isLoadingTimeout.value = true
      }
    }, LOADING_TIMEOUT)
  } else {
    loadingStartTime.value = 0
    isLoadingTimeout.value = false
    if (loadingTimeoutTimer) {
      clearTimeout(loadingTimeoutTimer)
      loadingTimeoutTimer = null
    }
  }
})

// 强制重新加载（用于超时后手动重试）
async function forceReload() {
  isLoadingTimeout.value = false
  challengeStore.loading = false
  challengeStore.clearCache()
  await challengeStore.loadChallenges(true)
}

// 封面类型：none, default, random, custom（默认改为 random）
const coverType = ref('random')
const customCoverUrl = ref('')
const randomCoverUrl = ref('')
const loadingRandomCover = ref(false)
const defaultCoverUrl = `${import.meta.env.BASE_URL}challenge-default.svg`

// 图片预缓存机制（单词-图片对）
const IMAGE_CACHE_KEY = 'spellingbee_cover_cache_v2'
const CURRENT_COVER_KEY = 'spellingbee_current_cover' // 当前使用的单词-图片对
const MAX_CACHE_SIZE = 5 // 最多缓存5个单词-图片对
// 缓存结构: { word: string, imageUrl: string }[]
const cachedCovers = ref([])
// 当前使用的单词-图片对（打开弹窗时使用，创建成功后清除）
const currentCover = ref(null)

// 加载缓存
function loadImageCache() {
  try {
    // 加载缓存列表
    const cached = localStorage.getItem(IMAGE_CACHE_KEY)
    if (cached) {
      cachedCovers.value = JSON.parse(cached)
    }
    // 加载当前使用的封面
    const current = localStorage.getItem(CURRENT_COVER_KEY)
    if (current) {
      currentCover.value = JSON.parse(current)
    }
  } catch (e) {
    console.warn('Failed to load image cache:', e)
    cachedCovers.value = []
    currentCover.value = null
  }
}

// 保存缓存列表
function saveImageCache() {
  try {
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cachedCovers.value))
  } catch (e) {
    console.warn('Failed to save image cache:', e)
  }
}

// 保存当前使用的封面
function saveCurrentCover() {
  try {
    if (currentCover.value) {
      localStorage.setItem(CURRENT_COVER_KEY, JSON.stringify(currentCover.value))
    } else {
      localStorage.removeItem(CURRENT_COVER_KEY)
    }
  } catch (e) {
    console.warn('Failed to save current cover:', e)
  }
}

// 从缓存获取一个单词-图片对（不删除，只是取出使用）
function getCoverFromCache() {
  if (cachedCovers.value.length > 0) {
    // 取出第一个作为当前使用
    const cover = cachedCovers.value.shift()
    saveImageCache()
    return cover
  }
  return null
}

// 添加单词-图片对到缓存
function addCoverToCache(word, imageUrl) {
  if (!word || !imageUrl) return
  // 检查是否已存在相同单词
  if (cachedCovers.value.some(c => c.word === word)) return
  cachedCovers.value.push({ word, imageUrl })
  // 保持缓存大小
  while (cachedCovers.value.length > MAX_CACHE_SIZE) {
    cachedCovers.value.shift()
  }
  saveImageCache()
}

// 清除当前使用的封面（创建成功后调用）
function clearCurrentCover() {
  currentCover.value = null
  saveCurrentCover()
}

// 后台预加载单词-图片对到缓存
async function prefetchImages() {
  // 如果缓存已满，不需要预加载
  if (cachedCovers.value.length >= MAX_CACHE_SIZE) return

  const needCount = MAX_CACHE_SIZE - cachedCovers.value.length

  // 先生成随机单词列表
  const words = []
  for (let i = 0; i < needCount; i++) {
    const word = await getRandomWordForName()
    // 避免重复单词
    if (!words.includes(word) && !cachedCovers.value.some(c => c.word === word)) {
      words.push(word)
    }
  }

  // 并行获取每个单词对应的图片
  const fetchPromises = words.map(word => fetchImageForWord(word))

  const results = await Promise.allSettled(fetchPromises)
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      addCoverToCache(words[index], result.value)
    }
  })
}

// 根据单词获取对应主题的图片
async function fetchImageForWord(word) {
  // 尝试 Unsplash（使用单词作为查询主题）
  try {
    const url = await Promise.race([
      fetchFromUnsplashWithWord(word),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ])
    if (url) return url
  } catch { }

  // 尝试 Picsum（不支持主题，作为备用）
  try {
    const url = await Promise.race([
      fetchFromPicsum(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ])
    if (url) return url
  } catch { }

  // 尝试 LoremFlickr（使用单词作为主题）
  try {
    const url = await Promise.race([
      fetchFromLoremFlickrWithWord(word),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ])
    if (url) return url
  } catch { }

  return null
}

// 获取封面图片URL（处理默认封面和旧数据兼容）
function getCoverUrl(challenge) {
  if (!challenge.image_url) return ''
  // 如果是默认封面标识或包含 challenge-default.svg，使用当前环境的默认封面路径
  if (challenge.image_url === 'default' || challenge.image_url.includes('challenge-default.svg')) {
    return defaultCoverUrl
  }
  // 否则返回归一化后的 URL（自定义封面 / Supabase Storage 直链）
  return normalizeMediaUrl(challenge.image_url)
}

// 过滤和分页
const statusFilter = ref('all')
const searchKeyword = ref('')
const currentPage = ref(1)
const pageSize = ref(12)
const pageSizeOptions = [
  { label: '12条/页', value: 12 },
  { label: '24条/页', value: 24 },
  { label: '48条/页', value: 48 }
]

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
  const start = (currentPage.value - 1) * pageSize.value
  return filteredChallenges.value.slice(start, start + pageSize.value)
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
  show_english: true, // 显示英文释义
  assisted_input: true // 辅助输入：true显示所有字母框和颜色提示，false逐个显示无颜色提示
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
        show_english: settings.show_english ?? true,
        assisted_input: settings.assisted_input ?? true
      })
      // 恢复封面类型（默认改为 random）
      coverType.value = settings.coverType ?? 'random'
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
      show_english: createData.show_english,
      assisted_input: createData.assisted_input,
      coverType: coverType.value
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
  // 重置自定义封面状态
  customCoverUrl.value = ''
  coverFiles.value = []

  // 根据封面类型设置
  if (coverType.value === 'none') {
    // 无封面模式：生成新的随机单词
    savedRandomWord.value = await getRandomWordForName()
    createData.name = `挑战赛-${savedRandomWord.value.toUpperCase()}`
    createData.image_url = ''
    randomCoverUrl.value = ''
  } else if (coverType.value === 'default') {
    // 默认封面模式：生成新的随机单词
    savedRandomWord.value = await getRandomWordForName()
    createData.name = `挑战赛-${savedRandomWord.value.toUpperCase()}`
    createData.image_url = 'default'
    randomCoverUrl.value = ''
  } else if (coverType.value === 'random') {
    // 随机封面模式：优先使用当前封面，否则从缓存获取或实时获取
    if (currentCover.value) {
      // 使用已有的当前封面
      savedRandomWord.value = currentCover.value.word
      createData.name = `挑战赛-${currentCover.value.word.toUpperCase()}`
      randomCoverUrl.value = currentCover.value.imageUrl
      createData.image_url = currentCover.value.imageUrl
    } else {
      // 从缓存获取或实时获取
      createData.image_url = ''
      randomCoverUrl.value = ''
      fetchRandomCover()
    }
  } else if (coverType.value === 'custom') {
    // 自定义封面：需要重新上传，回退到随机模式
    createData.image_url = ''
    randomCoverUrl.value = ''
    coverType.value = 'random'
    fetchRandomCover()
  }

  showCreateDialog.value = true
}

const createRules = {
  name: [
    { required: true, message: '请输入挑战赛名称', type: 'error' },
    { min: 2, max: 30, message: '名称长度2-30个字符', type: 'error' }
  ]
}

// 参数限制常量
const MAX_PARTICIPANTS = 100
const MAX_ENTRY_FEE = 10000
const MAX_WORD_COUNT = 500

// 验证函数
function validateMaxParticipants() {
  if (createData.max_participants > MAX_PARTICIPANTS) {
    createData.max_participants = MAX_PARTICIPANTS
  }
}

function validateEntryFee() {
  if (createData.entry_fee > MAX_ENTRY_FEE) {
    createData.entry_fee = MAX_ENTRY_FEE
  }
}

function validateWordCount() {
  if (createData.word_count > MAX_WORD_COUNT) {
    createData.word_count = MAX_WORD_COUNT
  }
}

// 创建前验证参数
function validateCreateParams() {
  if (createData.max_participants > MAX_PARTICIPANTS) {
    MessagePlugin.error(`参赛人数不能超过${MAX_PARTICIPANTS}人`)
    return false
  }
  if (createData.entry_fee > MAX_ENTRY_FEE) {
    MessagePlugin.error(`参赛积分不能超过${MAX_ENTRY_FEE}分`)
    return false
  }
  if (createData.word_count > MAX_WORD_COUNT) {
    MessagePlugin.error(`单词数量不能超过${MAX_WORD_COUNT}个`)
    return false
  }
  return true
}

const timeLimitMarks = { 15: '15s', 30: '30s', 45: '45s', 60: '60s' }

// 出题模式提示
const wordModeHint = computed(() => {
  switch (createData.word_mode) {
    case 'simulate':
      return '模拟真实比赛，按难度递进出题'
    case 'new':
      return '优先出现未考过的单词'
    case 'wrong':
      return '专门挑选容易错误的题目'
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
      const normalized = normalizeMediaUrl(urlData.publicUrl)
      customCoverUrl.value = normalized
      createData.image_url = normalized
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

// 选择随机封面（点击时切换到下一个随机单词和图片）
async function selectRandomCover() {
  coverType.value = 'random'
  // 清除当前封面，强制获取下一个
  currentCover.value = null
  saveCurrentCover()
  randomCoverUrl.value = ''
  await fetchRandomCover()
}

// Unsplash API 配置
const UNSPLASH_ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY

// 获取随机封面图片（优先使用当前封面或缓存）
async function fetchRandomCover() {
  // 如果正在加载，允许重新点击（取消当前加载）
  if (loadingRandomCover.value) {
    loadingRandomCover.value = false
    // 短暂延迟后重新开始
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  loadingRandomCover.value = true

  try {
    // 1. 如果已有当前封面，直接使用
    if (currentCover.value) {
      randomCoverUrl.value = currentCover.value.imageUrl
      createData.image_url = currentCover.value.imageUrl
      loadingRandomCover.value = false
      // 后台补充缓存
      prefetchImages()
      return
    }

    // 2. 从缓存获取
    const cached = getCoverFromCache()
    if (cached) {
      currentCover.value = cached
      saveCurrentCover()
      savedRandomWord.value = cached.word
      createData.name = `挑战赛-${cached.word.toUpperCase()}`
      randomCoverUrl.value = cached.imageUrl
      createData.image_url = cached.imageUrl
      loadingRandomCover.value = false
      // 后台补充缓存
      prefetchImages()
      return
    }

    // 3. 缓存为空，实时获取（使用当前的随机单词）
    const word = savedRandomWord.value || await getRandomWordForName()
    savedRandomWord.value = word
    createData.name = `挑战赛-${word.toUpperCase()}`
    
    const imageUrl = await Promise.race([
      fetchImageForWord(word),
      new Promise((resolve) => setTimeout(() => resolve(null), 6000))
    ])

    if (imageUrl) {
      currentCover.value = { word, imageUrl }
      saveCurrentCover()
      randomCoverUrl.value = imageUrl
      createData.image_url = imageUrl
      // 后台补充缓存
      prefetchImages()
    } else {
      // 获取失败，保持 random 状态，允许用户重新点击
      randomCoverUrl.value = ''
      // 不改变 coverType，用户可以再次点击尝试
    }
  } catch {
    randomCoverUrl.value = ''
  } finally {
    loadingRandomCover.value = false
  }
}

// 从 Unsplash 获取图片（使用单词作为主题）
async function fetchFromUnsplashWithWord(word) {
  const response = await fetch(
    `https://api.unsplash.com/photos/random?query=${encodeURIComponent(word)}&orientation=landscape&w=800&h=400`,
    {
      headers: {
        'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Unsplash API error: ${response.status}`)
  }

  const data = await response.json()
  const imageUrl = data.urls?.regular || data.urls?.small

  if (!imageUrl) {
    throw new Error('No image URL in response')
  }

  // 预加载图片（3秒超时）
  await preloadImage(imageUrl, 3000)
  return imageUrl
}

// 从 Picsum 获取图片（备用服务1）
// 直接使用 Image 对象加载，避免 CORS 问题
async function fetchFromPicsum() {
  const randomUrl = `https://picsum.photos/800/400?random=${Date.now()}`
  
  // 使用 Image 对象加载，它会自动处理重定向
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    const timeoutId = setTimeout(() => {
      img.src = ''
      reject(new Error('Picsum timeout'))
    }, 3000)
    
    img.onload = () => {
      clearTimeout(timeoutId)
      // img.src 会是重定向后的最终 URL
      resolve(img.src)
    }
    img.onerror = () => {
      clearTimeout(timeoutId)
      reject(new Error('Picsum load failed'))
    }
    img.src = randomUrl
  })
}

// 从 LoremFlickr 获取图片（使用单词作为主题）
// 直接使用 Image 对象加载，避免 CORS 问题
async function fetchFromLoremFlickrWithWord(word) {
  const randomUrl = `https://loremflickr.com/800/400/${encodeURIComponent(word)}?random=${Date.now()}`
  
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    const timeoutId = setTimeout(() => {
      img.src = ''
      reject(new Error('LoremFlickr timeout'))
    }, 3000)
    
    img.onload = () => {
      clearTimeout(timeoutId)
      resolve(img.src)
    }
    img.onerror = () => {
      clearTimeout(timeoutId)
      reject(new Error('LoremFlickr load failed'))
    }
    img.src = randomUrl
  })
}

// 预加载图片（不再修改 loadingRandomCover 状态）
function preloadImage(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    const timeoutId = setTimeout(() => {
      img.src = ''
      reject(new Error('Image preload timeout'))
    }, timeout)

    img.onload = () => {
      clearTimeout(timeoutId)
      resolve()
    }
    img.onerror = () => {
      clearTimeout(timeoutId)
      reject(new Error('Image load failed'))
    }
    img.src = url
  })
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
  // 验证参数
  if (!validateCreateParams()) {
    return
  }

  quickCreating.value = playerCount

  try {
    // 使用当前封面的单词，或已保存的随机单词，或重新获取
    let randomWord = ''
    if (currentCover.value) {
      randomWord = currentCover.value.word
    } else if (savedRandomWord.value) {
      randomWord = savedRandomWord.value
    } else {
      randomWord = await getRandomWordForName()
    }
    // 直接使用带时间戳的名称，避免重复检查的数据库请求
    const timestamp = Date.now().toString(36).slice(-4)
    const finalName = `${playerCount}人对战-${randomWord.toUpperCase()}-${timestamp}`

    // 保存设置
    saveSettings()

    // 确定封面URL：创建时不等待图片加载，如果没有加载成功则留空
    let imageUrl = ''
    if (coverType.value === 'none') {
      imageUrl = ''
    } else if (coverType.value === 'default') {
      imageUrl = 'default'
    } else if (coverType.value === 'random') {
      // 随机封面：优先使用当前封面，否则使用已加载的图片
      imageUrl = currentCover.value?.imageUrl || randomCoverUrl.value || ''
    } else if (coverType.value === 'custom' && customCoverUrl.value) {
      imageUrl = customCoverUrl.value
    }

    // 添加超时保护，避免卡住
    await Promise.race([
      challengeStore.createChallenge({
        name: finalName,
        description: undefined,
        image_url: imageUrl || undefined,
        max_participants: playerCount,
        entry_fee: createData.entry_fee,
        word_count: createData.word_count,
        time_limit: createData.time_limit,
        difficulty: createData.difficulty,
        word_mode: createData.word_mode,
        show_chinese: createData.show_chinese,
        show_english: createData.show_english,
        assisted_input: createData.assisted_input
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('创建超时，请检查网络后重试')), 15000))
    ])

    showCreateDialog.value = false
    MessagePlugin.success(`${playerCount}人对战创建成功`)

    // 创建成功后手动跳转到房间（带上房间ID）
    if (challengeStore.currentChallenge) {
      router.push({ name: 'ChallengeRoom', params: { id: challengeStore.currentChallenge.id } })
    }

    // 创建成功后清除当前封面（下次打开会使用新的）
    clearCurrentCover()
    savedRandomWord.value = ''
    randomCoverUrl.value = ''
  } catch (error) {
    MessagePlugin.error(error.message || '创建失败')
    // 超时或失败时清理可能的残留状态
    if (challengeStore.currentChallenge) {
      challengeStore.cleanup().catch(() => { })
    }
  } finally {
    quickCreating.value = null
  }
}

async function handleCreate({ validateResult }) {
  if (validateResult !== true) return

  // 验证参数
  if (!validateCreateParams()) {
    return
  }

  creating.value = true
  try {
    // 保存设置
    saveSettings()

    // 确定封面URL（默认使用随机封面）
    let imageUrl = createData.image_url
    if (!imageUrl && coverType.value === 'random' && randomCoverUrl.value) {
      imageUrl = randomCoverUrl.value
    }

    // 添加超时保护，避免卡住
    await Promise.race([
      challengeStore.createChallenge({
        name: createData.name,
        description: createData.description || undefined,
        image_url: imageUrl || undefined,
        max_participants: createData.max_participants,
        entry_fee: createData.entry_fee,
        word_count: createData.word_count,
        time_limit: createData.time_limit,
        difficulty: createData.difficulty,
        word_mode: createData.word_mode,
        show_chinese: createData.show_chinese,
        show_english: createData.show_english,
        assisted_input: createData.assisted_input
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('创建超时，请检查网络后重试')), 15000))
    ])

    showCreateDialog.value = false
    MessagePlugin.success('挑战赛创建成功')

    // 创建成功后手动跳转到房间（带上房间ID）
    if (challengeStore.currentChallenge) {
      router.push({ name: 'ChallengeRoom', params: { id: challengeStore.currentChallenge.id } })
    }

    // 创建成功后清除当前封面（下次打开会使用新的）
    clearCurrentCover()
    
    // 重置名称和封面，保留其他设置
    createData.name = ''
    createData.description = ''
    createData.image_url = ''
    coverFiles.value = []
    customCoverUrl.value = ''
    randomCoverUrl.value = ''
    savedRandomWord.value = ''
    coverType.value = 'random'
  } catch (error) {
    MessagePlugin.error(error.message || '创建失败')
    // 超时或失败时清理可能的残留状态
    if (challengeStore.currentChallenge) {
      challengeStore.cleanup().catch(() => { })
    }
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
// 注意：只处理离开房间的情况，进入房间由具体操作函数处理（避免重复 push）
watch(() => challengeStore.currentChallenge, async (newVal, oldVal) => {
  if (!newVal && oldVal && route.params.id) {
    // 离开挑战赛，返回列表（使用 replace 避免重复历史记录）
    router.replace({ name: 'Challenge' })
    // 恢复滚动位置
    restoreScrollPosition()
    // 不再标记刷新，因为 updateChallengeInList 已经更新了本地缓存
    // 直接使用缓存数据即可
  }
})

onMounted(async () => {
  await loadSettings()

  // 加载图片缓存并在后台预加载图片
  loadImageCache()
  prefetchImages()

  // 如果 URL 中有挑战赛 ID，尝试加入
  const challengeId = route.params.id
  if (challengeId) {
    // 先加载列表（使用缓存）
    await challengeStore.loadChallenges()
    await joinChallengeById(challengeId)
  } else {
    // 在列表页：先检查是否需要刷新，否则使用缓存
    if (challengeStore.needsRefresh) {
      await challengeStore.checkAndRefresh()
    } else {
      await challengeStore.loadChallenges()
    }
  }

  // 监听页面可见性变化
  document.addEventListener('visibilitychange', handleVisibilityChange)
  lastHiddenTime = Date.now()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (loadingTimeoutTimer) {
    clearTimeout(loadingTimeoutTimer)
    loadingTimeoutTimer = null
  }
})

// 监听路由变化，处理浏览器前进后退
// 使用 route.params.id 而非 route.path，更可靠
watch(() => route.params.id, async (newId, oldId) => {
  // 用户从房间回退到列表页（浏览器回退按钮）
  // newId 为 undefined 表示回到了 /challenge 列表页
  if (!newId && oldId && challengeStore.currentChallenge) {
    // 清理当前房间状态，返回列表
    try {
      await Promise.race([
        challengeStore.leaveChallenge(true),
        new Promise(resolve => setTimeout(resolve, 2000))
      ])
    } catch { }
    try {
      await Promise.race([
        challengeStore.cleanup(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ])
    } catch { }
    // 恢复滚动位置
    restoreScrollPosition()
    // 不再标记刷新，直接使用缓存数据
    return
  }

  // 用户从列表前进到房间页（浏览器前进按钮）
  // newId 有值但 currentChallenge 为空，需要加入房间
  if (newId && !challengeStore.currentChallenge) {
    await joinChallengeById(newId)
    return
  }

  // 回到列表页且没有当前挑战赛：直接使用缓存，不发起请求
  if (!newId && !challengeStore.currentChallenge) {
    challengeStore.loading = false
    // 只有在 needsRefresh 标志为 true 时才刷新（如收到新挑战通知）
    if (challengeStore.needsRefresh) {
      await challengeStore.checkAndRefresh()
    }
  }
})
</script>

<style lang="scss" scoped>
.challenge-page {
  max-width: 1000px;
  margin: 0 auto;
}

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

  .header-actions {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 1rem;
  }
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
          background: var(--success-light, #d1fae5);
          color: var(--success, #10b981);
        }

        &.in_progress {
          background: var(--primary-light, #dbeafe);
          color: var(--primary, #3b82f6);
        }

        &.finished {
          background: var(--honey-100);
          color: var(--honey-700);
        }

        &.mine {
          background: var(--primary-light, #dbeafe);
          color: var(--primary);
        }
      }
    }
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    :deep(.t-input) {
      min-width: 200px;
      max-width: 280px;
    }

    .refresh-btn {
      flex-shrink: 0;
    }

    .status-select {
      width: 130px;
      flex-shrink: 0;
    }
  }
}

// 响应式：桌面端显示标签，手机端显示下拉框
.desktop-only {
  display: flex;
}

.mobile-only {
  display: none;
}

@media (max-width: 768px) {
  .desktop-only {
    display: none !important;
  }

  .mobile-only {
    display: block !important;
  }

  .filter-section {
    flex-direction: column;
    align-items: stretch;

    .search-box {
      width: 100%;

      :deep(.t-input) {
        flex: 1;
        min-width: 0;
        max-width: none;
      }

      .status-select {
        width: 120px;
      }
    }
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

    .card-image,
    .card-content,
    .card-action {
      opacity: 0.5;
    }
  }

  &.finished {
    opacity: 0.9;
    //background: linear-gradient(135deg, var(--honey-50) 0%, var(--honey-100) 100%);

    .card-image {
      background: linear-gradient(135deg, var(--honey-300) 0%, var(--honey-500) 100%);
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
    background: rgba(255, 255, 255, 0.5);
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
        background: var(--success-light, #d1fae5);
        color: var(--success, #10b981);
      }

      &.ready {
        background: var(--success-light, #d1fae5);
        color: var(--success, #10b981);
      }

      &.in_progress {
        background: var(--primary-light, #dbeafe);
        color: var(--primary, #3b82f6);
      }

      &.finished {
        background: var(--honey-100);
        color: var(--honey-700);
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

    .card-dictionary {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
      color: var(--honey-600);
      margin-bottom: 0.5rem;
      
      .t-icon {
        flex-shrink: 0;
      }
      
      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
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

      .card-time,
      .card-participants-count {
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
  
  &.form-hint-error {
    color: var(--error, #e53935);
    font-weight: 500;
  }
}

.hint-options {
  display: flex;
  gap: 1.5rem;
}

// 当前词典样式
.current-dictionary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--honey-50);
  border: 1px solid var(--honey-200);
  border-radius: 8px;
  color: var(--honey-700);
  font-size: 0.9rem;
  margin-bottom: 1rem;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--honey-100);
    border-color: var(--honey-300);
  }
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
      // max-height: 1000px;
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
        .t-input,
        .t-textarea,
        .t-input-number {
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

<style lang="scss">
// Dark mode styles - 非 scoped 样式
[data-theme="dark"] {
  .challenge-page {
    .page-header {
      h1 {
        color: var(--text-primary);
      }

      p {
        color: var(--text-secondary);
      }
    }

    .login-hint {
      background: rgba(251, 191, 36, 0.15);
      color: var(--accent-color);
    }

    // 状态筛选标签 dark mode
    .filter-section {
      .status-tabs {
        .status-tab {
          background: var(--bg-card);
          border: 2px solid transparent;

          &:hover {
            background: var(--hover-bg);
          }

          &.active {
            border-color: var(--accent-color);
            background: var(--accent-bg);
          }

          .tab-label {
            color: var(--text-primary);
          }

          .tab-count {
            background: rgba(60, 60, 65, 0.8);
            color: var(--text-secondary);

            &.waiting {
              background: rgba(52, 211, 153, 0.2);
              color: var(--success);
            }

            &.in_progress {
              background: rgba(59, 130, 246, 0.2);
              color: #60a5fa;
            }

            &.finished {
              background: var(--accent-bg);
              color: var(--accent-color);
            }

            &.mine {
              background: rgba(59, 130, 246, 0.2);
              color: #60a5fa;
            }
          }
        }
      }
    }

    // 挑战赛卡片 dark mode
    .challenge-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);

      &:hover {
        box-shadow: var(--shadow-lg);
      }

      &.finished {
        .card-image {
          background: linear-gradient(135deg, #8b6914 0%, #a67c00 100%);
        }
      }

      .connecting-overlay {
        background: rgba(26, 26, 29, 0.7);
      }

      .card-image {
        background: linear-gradient(135deg, #8b6914 0%, #d97706 100%);

        .card-status {
          background: rgba(45, 45, 50, 0.95);
          color: var(--text-primary);

          &.waiting {
            background: rgba(52, 211, 153, 0.2);
            color: var(--success);
          }

          &.ready {
            background: rgba(52, 211, 153, 0.2);
            color: var(--success);
          }

          &.in_progress {
            background: rgba(59, 130, 246, 0.2);
            color: #60a5fa;
          }

          &.finished {
            background: var(--accent-bg);
            color: var(--accent-color);
          }

          &.cancelled {
            background: rgba(248, 113, 113, 0.2);
            color: var(--error);
          }
        }

        .delete-btn {
          background: rgba(45, 45, 50, 0.95);

          &:hover {
            background: rgba(248, 113, 113, 0.2);
          }
        }
      }

      .card-content {
        .card-title {
          color: var(--text-primary);
        }

        .card-meta .meta-item {
          color: var(--text-secondary);
        }

        .card-info-row {
          border-top-color: var(--border-color);
          color: var(--text-muted);
        }

        .card-participants-row {
          .participant-chip {
            background: var(--hover-bg);

            .participant-name {
              color: var(--text-secondary);
            }

            &.is-winner {
              background: linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(217, 119, 6, 0.2) 100%);

              .participant-name {
                color: var(--accent-color);
              }
            }
          }
        }
      }
    }

    // 空状态 dark mode
    .empty-state {
      color: var(--text-secondary);

      h3 {
        color: var(--text-primary);
      }
    }

    .loading-container {
      color: var(--text-secondary);
    }

    // 创建挑战赛对话框 dark mode
    .quick-create-section {
      .quick-create-buttons {
        .t-button {
          &.t-button--theme-primary {
            background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
            border-color: #b45309;
          }
        }
      }
    }

    .custom-create-section {
      .custom-toggle {
        color: var(--text-secondary);

        &:hover {
          color: var(--text-primary);
        }
      }
    }

    // 封面选择 dark mode
    .cover-selection {
      .cover-option {
        .cover-option-preview {
          border-color: var(--border-color);
          background: var(--bg-card-solid);

          &.empty {
            background: rgba(40, 40, 45, 0.8);
            color: var(--text-secondary);
          }
        }

        span {
          color: var(--text-secondary);
        }

        &:hover .cover-option-preview {
          border-color: var(--accent-color);
        }

        &.active {
          .cover-option-preview {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.2);
          }

          span {
            color: var(--accent-color);
          }
        }
      }
    }

    .form-hint {
      color: var(--text-muted);
    }
  }
}
</style>
