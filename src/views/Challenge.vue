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

      <!-- 挑战赛卡片列表 -->
      <div class="challenge-cards" v-else>
        <div 
          class="challenge-card" 
          v-for="challenge in challengeStore.challenges" 
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
            <img v-if="challenge.image_url" :src="challenge.image_url" alt="" />
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
            <!-- 获胜者信息（已结束的比赛） -->
            <div class="winner-info" v-if="challenge.status === 'finished' && challenge.winner_name">
              <t-icon name="crown" />
              <span>冠军: {{ challenge.winner_name }}</span>
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
            <div class="card-time">
              <t-icon name="time" />
              <span v-if="challenge.status === 'finished' && challenge.finished_at">
                {{ formatTime(challenge.finished_at) }} 结束
              </span>
              <span v-else>
                {{ formatTime(challenge.created_at) }} 创建
              </span>
            </div>
            <!-- 参赛选手（创建者排第一） -->
            <div class="card-participants-list">
              <div 
                class="participant-item"
                v-for="p in getSortedParticipants(challenge)"
                :key="p.user_id"
              >
                <t-avatar size="20px" :image="p.avatar_url">
                  {{ p.nickname?.charAt(0) }}
                </t-avatar>
                <span class="participant-name">{{ p.nickname }}</span>
                <t-tag v-if="p.user_id === challenge.creator_id" size="small" variant="light" theme="warning">房主</t-tag>
              </div>
            </div>
            <div class="participants-count-row">
              <t-icon name="user" />
              <span>{{ challenge.participants?.length || 0 }}/{{ challenge.max_participants }} 人</span>
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
      <t-form
        ref="createForm"
        :data="createData"
        :rules="createRules"
        @submit="handleCreate"
        label-width="100px"
      >
        <t-form-item name="name" label="挑战赛名称">
          <t-input v-model="createData.name" placeholder="给挑战赛起个名字" maxlength="30" />
        </t-form-item>
        <t-form-item name="description" label="描述">
          <t-textarea v-model="createData.description" placeholder="描述一下这场挑战赛（可选）" maxlength="200" />
        </t-form-item>
        <t-form-item name="image_url" label="封面图片">
          <div class="cover-upload">
            <t-upload
              v-model="coverFiles"
              :action="''"
              theme="image"
              accept="image/*"
              :auto-upload="false"
              :show-upload-progress="false"
              :request-method="customUpload"
              @change="handleCoverChange"
            >
              <template #default>
                <div class="upload-area" v-if="!createData.image_url">
                  <t-icon name="add" size="32px" />
                  <span>上传封面</span>
                </div>
                <img v-else :src="createData.image_url" class="cover-preview" />
              </template>
            </t-upload>
            <t-loading v-if="uploadingCover" size="small" class="upload-loading" />
            <t-button 
              v-if="createData.image_url" 
              variant="text" 
              theme="danger" 
              size="small"
              @click="removeCover"
            >
              移除
            </t-button>
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
        <div class="form-actions">
          <t-button variant="outline" @click="showCreateDialog = false">取消</t-button>
          <t-button theme="primary" type="submit" :loading="creating">创建</t-button>
        </div>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useChallengeStore } from '@/stores/challenge'
import { supabase } from '@/lib/supabase'
import ChallengeRoom from '@/components/ChallengeRoom.vue'

const baseUrl = import.meta.env.BASE_URL
const authStore = useAuthStore()
const challengeStore = useChallengeStore()

const showCreateDialog = ref(false)
const creating = ref(false)
const connectingId = ref(null) // 正在连接的挑战赛ID
const coverFiles = ref([])
const uploadingCover = ref(false)
const nextChallengeNumber = ref(1) // 下一个比赛序号

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
  word_mode: 'simulate' // 比赛模式：simulate, new, random, sequential, reverse
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
        word_mode: settings.word_mode ?? 'simulate'
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
      word_mode: createData.word_mode
    }))
  } catch (e) {
    console.error('Error saving challenge settings:', e)
  }
}

// 获取下一个比赛序号
async function getNextChallengeNumber() {
  try {
    const { data, error } = await supabase
      .from('challenges')
      .select('challenge_number')
      .order('challenge_number', { ascending: false })
      .limit(1)
    
    if (error) throw error
    nextChallengeNumber.value = (data?.[0]?.challenge_number || 0) + 1
  } catch (e) {
    console.error('Error getting next challenge number:', e)
    nextChallengeNumber.value = 1
  }
}

// 打开创建对话框
async function openCreateDialog() {
  await getNextChallengeNumber()
  createData.name = `挑战赛-${nextChallengeNumber.value}`
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
      createData.image_url = urlData.publicUrl
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
  
  connectingId.value = challenge.id
  try {
    await challengeStore.joinChallenge(challenge.id)
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
  challengeStore.viewFinishedChallenge(challenge)
}

async function enterChallenge(challenge) {
  if (!authStore.user) {
    MessagePlugin.warning('请先登录')
    return
  }

  if (connectingId.value) return
  
  connectingId.value = challenge.id
  try {
    await challengeStore.joinChallenge(challenge.id)
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
  
  connectingId.value = challenge.id
  try {
    await challengeStore.joinChallenge(challenge.id)
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
      challenge_number: nextChallengeNumber.value
    })
    
    showCreateDialog.value = false
    MessagePlugin.success('挑战赛创建成功')
    
    // 重置名称和封面，保留其他设置
    createData.name = ''
    createData.description = ''
    createData.image_url = ''
    coverFiles.value = []
  } catch (error) {
    MessagePlugin.error(error.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function refreshList() {
  await challengeStore.loadChallenges()
}

onMounted(async () => {
  await loadSettings()
  await challengeStore.loadChallenges()
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

    .winner-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: linear-gradient(135deg, var(--honey-50) 0%, var(--honey-100) 100%);
      border-radius: 8px;
      margin-bottom: 0.75rem;
      font-size: 0.85rem;
      color: var(--honey-700);
      font-weight: 500;
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

    .card-participants-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--charcoal-100);

      .participant-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8rem;

        .participant-name {
          flex: 1;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    }

    .participants-count-row {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
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

// 封面上传样式
.cover-upload {
  display: flex;
  align-items: center;
  gap: 1rem;
  position: relative;

  .upload-area {
    width: 120px;
    height: 80px;
    border: 2px dashed var(--charcoal-300);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      border-color: var(--honey-400);
      color: var(--honey-600);
    }

    span {
      font-size: 0.85rem;
    }
  }

  .cover-preview {
    width: 120px;
    height: 80px;
    object-fit: cover;
    border-radius: 8px;
  }

  .upload-loading {
    position: absolute;
    left: 50px;
    top: 30px;
  }
}

.form-hint {
  margin-left: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
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
}
</style>
