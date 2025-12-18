<template>
  <div class="dictionaries-page">
    <div class="page-header">
      <h1>词典管理</h1>
      <p>管理你的词典库，创建、编辑或选择词典进行学习</p>
      <!-- 当前词典信息 -->
      <div class="current-dictionary" v-if="currentDictionary" @click="goToCurrentDictionary">
        <t-icon name="book" />
        <span>{{ currentDictionary.name }}</span>
        <t-icon name="chevron-right" size="14px" />
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="action-bar">
      <div class="action-left">
        <t-input
          v-model="searchQuery"
          placeholder="搜索词典..."
          clearable
          class="search-input"
        >
          <template #prefix-icon>
            <t-icon name="search" />
          </template>
        </t-input>
        <t-select v-model="filterLevel" placeholder="等级筛选" clearable class="filter-select">
          <t-option v-for="(label, key) in DictionaryLevelLabels" :key="key" :value="key" :label="label" />
        </t-select>
      </div>
      <div class="action-right">
        <t-button theme="primary" @click="showCreateDialog = true">
          <template #icon><t-icon name="add" /></template>
          创建词典
        </t-button>
      </div>
    </div>

    <!-- 我的词典 -->
    <div class="section" v-if="myDictionaries.length > 0 || !searchQuery">
      <div class="section-header">
        <h2>我的词典</h2>
        <span class="count">{{ myDictionaries.length }} 个</span>
      </div>
      <div class="dict-grid" v-if="myDictionaries.length > 0">
        <div
          v-for="dict in myDictionaries"
          :key="dict.id"
          class="dict-card"
          :class="{ selected: currentDictionary?.id === dict.id }"
          @click="handleCardClick(dict)"
        >
          <div class="card-cover">
            <img v-if="getCoverUrl(dict)" :src="getCoverUrl(dict)" alt="封面" />
            <div v-else class="cover-placeholder">
              <t-icon name="book" size="32px" />
            </div>
            <div class="card-badge" v-if="currentDictionary?.id === dict.id">
              <t-icon name="check" />
              当前使用
            </div>
          </div>
          <div class="card-content">
            <h3>{{ dict.name }}</h3>
            <p class="description">{{ dict.description || '暂无描述' }}</p>
            <div class="card-meta">
              <t-tag size="small" variant="light" theme="primary">{{ DictionaryLevelLabels[dict.level] }}</t-tag>
              <t-tag size="small" variant="light">{{ dict.word_count }} 词</t-tag>
              <t-tag size="small" variant="light" v-if="dict.is_public" theme="success">公开</t-tag>
            </div>
          </div>
          <div class="card-actions" @click.stop>
            <t-button v-if="currentDictionary?.id !== dict.id" size="small" variant="text" @click="handleSelectDictionary(dict)">
              <template #icon><t-icon name="check-circle" /></template>
              选用
            </t-button>
            <t-button size="small" variant="text" @click="handleEditDictionary(dict)">
              <template #icon><t-icon name="edit" /></template>
              编辑
            </t-button>
            <t-popconfirm content="确定删除此词典？所有单词将被删除。" @confirm="handleDeleteDictionary(dict.id)">
              <t-button size="small" variant="text" theme="danger">
                <template #icon><t-icon name="delete" /></template>
                删除
              </t-button>
            </t-popconfirm>
          </div>
        </div>
      </div>
      <div class="empty-hint" v-else>
        <p>还没有创建词典，点击上方按钮创建第一个词典</p>
      </div>
    </div>

    <!-- 公开词典 -->
    <div class="section" v-if="publicDictionaries.length > 0">
      <div class="section-header">
        <h2>公开词典</h2>
        <span class="count">{{ publicDictionaries.length }} 个</span>
      </div>
      <div class="dict-grid">
        <div
          v-for="dict in publicDictionaries"
          :key="dict.id"
          class="dict-card"
          :class="{ selected: currentDictionary?.id === dict.id }"
          @click="handleCardClick(dict)"
        >
          <div class="card-cover">
            <img v-if="getCoverUrl(dict)" :src="getCoverUrl(dict)" alt="封面" />
            <div v-else class="cover-placeholder">
              <t-icon name="book" size="32px" />
            </div>
            <div class="card-badge" v-if="currentDictionary?.id === dict.id">
              <t-icon name="check" />
              当前使用
            </div>
          </div>
          <div class="card-content">
            <h3>{{ dict.name }}</h3>
            <p class="description">{{ dict.description || '暂无描述' }}</p>
            <div class="card-author">
              <t-icon name="user" size="14px" />
              {{ dict.author || '未知作者' }}
            </div>
            <div class="card-meta">
              <t-tag size="small" variant="light" theme="primary">{{ DictionaryLevelLabels[dict.level] }}</t-tag>
              <t-tag size="small" variant="light">{{ dict.word_count }} 词</t-tag>
            </div>
          </div>
          <div class="card-actions" @click.stop>
            <t-button v-if="currentDictionary?.id !== dict.id" size="small" variant="text" @click="handleSelectDictionary(dict)">
              <template #icon><t-icon name="check-circle" /></template>
              选用
            </t-button>
            <t-button size="small" variant="text" @click="router.push(`/dictionaries/${dict.id}`)">
              <template #icon><t-icon name="browse" /></template>
              查看
            </t-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div class="loading-state" v-if="dictionaryStore.loading">
      <t-loading />
      <p>加载中...</p>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-if="!dictionaryStore.loading && filteredDictionaries.length === 0 && searchQuery">
      <t-icon name="search" size="48px" />
      <h3>未找到匹配的词典</h3>
      <p>尝试其他搜索词或筛选条件</p>
    </div>

    <!-- 创建/编辑词典对话框 -->
    <t-dialog
      v-model:visible="showCreateDialog"
      :header="editingDictionary ? '编辑词典' : '创建词典'"
      width="600px"
      :confirm-btn="{ content: '保存', theme: 'primary', loading: saving }"
      :cancel-btn="{ content: '取消' }"
      @confirm="handleSaveDictionary"
      @close="resetForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="80px">
        <t-form-item label="名称" name="name">
          <t-input v-model="formData.name" placeholder="请输入词典名称" maxlength="50" show-limit-number />
        </t-form-item>
        <t-form-item label="描述" name="description">
          <t-textarea v-model="formData.description" placeholder="请输入词典描述" :rows="3" maxlength="200" />
        </t-form-item>
        <t-form-item label="封面" name="cover_image">
          <div class="cover-selection">
            <div class="cover-options">
              <div class="cover-option" :class="{ active: coverType === 'none' }" @click="selectCoverType('none')">
                <div class="cover-option-preview empty">
                  <t-icon name="image" size="24px" />
                </div>
                <span>无封面</span>
              </div>
              <div class="cover-option" :class="{ active: coverType === 'default' }" @click="selectCoverType('default')">
                <div class="cover-option-preview" v-if="!defaultCoverFailed">
                  <img :src="defaultCoverUrl" alt="默认封面" @error="handleDefaultCoverError" />
                </div>
                <div class="cover-option-preview default-placeholder" v-else>
                  <t-icon name="book" size="24px" />
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
            <t-upload 
              ref="uploadRef" 
              v-model="coverFiles" 
              :action="''" 
              theme="custom" 
              accept="image/*"
              :auto-upload="false" 
              :show-upload-progress="false" 
              :request-method="handleUploadCover"
              @change="handleCoverChange" 
              style="display: none;" 
            />
            <t-loading v-if="uploadingCover" size="small" class="upload-loading" />
          </div>
        </t-form-item>
        <t-form-item label="等级" name="level">
          <t-select v-model="formData.level" placeholder="请选择难度等级">
            <t-option value="primary" label="小学" />
            <t-option value="junior" label="初中" />
            <t-option value="senior" label="高中" />
            <t-option value="cet4" label="大学四级" />
            <t-option value="cet6" label="大学六级" />
            <t-option value="toefl" label="托福" />
            <t-option value="ielts" label="雅思" />
            <t-option value="gre" label="GRE" />
            <t-option value="custom" label="自定义" />
          </t-select>
        </t-form-item>
        <t-form-item label="类型" name="type">
          <t-select v-model="formData.type" placeholder="请选择词典类型">
            <t-option value="vocabulary" label="词汇表" />
            <t-option value="exam" label="考试词库" />
            <t-option value="topic" label="主题词库" />
            <t-option value="custom" label="自定义" />
          </t-select>
        </t-form-item>
        <t-form-item label="公开" name="is_public">
          <t-switch v-model="formData.is_public" />
          <span class="form-hint">公开后其他用户可以查看和使用此词典</span>
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useDictionaryStore } from '@/stores/dictionary'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { DictionaryLevelLabels, DictionaryTypeLabels } from '@/types'
import type { Dictionary, DictionaryLevel, DictionaryType } from '@/types'

const router = useRouter()
const dictionaryStore = useDictionaryStore()
const authStore = useAuthStore()

// 使用 storeToRefs 确保响应式
const { currentDictionary } = storeToRefs(dictionaryStore)

// 跳转到当前词典详情页
function goToCurrentDictionary() {
  const dictId = currentDictionary.value?.id
  if (dictId) {
    router.push(`/dictionaries/${dictId}`)
  }
}

// 搜索和筛选
const searchQuery = ref('')
const filterLevel = ref<DictionaryLevel | null>(null)

// 对话框状态
const showCreateDialog = ref(false)
const saving = ref(false)
const editingDictionary = ref<Dictionary | null>(null)

// 表单
const formRef = ref()
const formData = reactive({
  name: '',
  description: '',
  cover_image: '',
  level: 'junior' as DictionaryLevel,
  type: 'vocabulary' as DictionaryType,
  is_public: false
})

const formRules = {
  name: [{ required: true, message: '请输入词典名称', type: 'error' as const }]
}

// 封面上传
const coverFiles = ref<any[]>([])
const uploadRef = ref()
const uploadingCover = ref(false)
const baseUrl = import.meta.env.BASE_URL

// 默认封面 - 使用内联 data URL 确保显示
const DEFAULT_COVER_SVG = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" width="400" height="240"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FEF3C7"/><stop offset="100%" stop-color="#FDE68A"/></linearGradient><linearGradient id="bk" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><rect width="400" height="240" fill="url(#bg)"/><circle cx="50" cy="40" r="30" fill="#FCD34D" opacity="0.4"/><circle cx="350" cy="200" r="40" fill="#FCD34D" opacity="0.3"/><g transform="translate(120,50)"><rect x="0" y="10" width="24" height="120" rx="4" fill="url(#bk)"/><path d="M24 10 L24 130 Q75 124 120 130 L120 10 Q75 16 24 10" fill="#FBBF24"/><path d="M30 18 L30 122 Q72 118 108 122 L108 18 Q72 22 30 18" fill="#FFFBEB"/><line x1="42" y1="40" x2="96" y2="38" stroke="#D1D5DB" stroke-width="3"/><line x1="42" y1="58" x2="96" y2="56" stroke="#D1D5DB" stroke-width="3"/><line x1="42" y1="76" x2="96" y2="74" stroke="#D1D5DB" stroke-width="3"/><text x="69" y="72" font-family="Georgia" font-size="20" font-weight="bold" fill="#D97706" text-anchor="middle">ABC</text></g><g transform="translate(265,70)"><ellipse cx="22" cy="8" rx="16" ry="10" fill="#F3F4F6" opacity="0.9"/><ellipse cx="25" cy="30" rx="22" ry="16" fill="#FCD34D"/><rect x="10" y="24" width="30" height="5" rx="2" fill="#1F2937"/><rect x="12" y="34" width="26" height="5" rx="2" fill="#1F2937"/><circle cx="50" cy="30" r="12" fill="#FCD34D"/><circle cx="55" cy="28" r="4" fill="#1F2937"/></g><text x="200" y="205" font-family="Arial" font-size="16" fill="#92400E" text-anchor="middle" font-weight="600">Dictionary</text></svg>`)}`
const defaultCoverUrl = ref(DEFAULT_COVER_SVG)

// 封面类型：none, default, random, custom
const coverType = ref<'none' | 'default' | 'random' | 'custom'>('default')
const customCoverUrl = ref('')
const randomCoverUrl = ref('')
const loadingRandomCover = ref(false)
const defaultCoverFailed = ref(false)

// 处理默认封面加载失败
function handleDefaultCoverError() {
  console.warn('Default cover failed to load')
  defaultCoverFailed.value = true
}

// Unsplash API
const UNSPLASH_ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY

// 计算属性
const filteredDictionaries = computed(() => {
  let result = [...dictionaryStore.dictionaries]
  
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(d => 
      d.name.toLowerCase().includes(q) ||
      (d.description && d.description.toLowerCase().includes(q)) ||
      (d.author && d.author.toLowerCase().includes(q))
    )
  }
  
  if (filterLevel.value) {
    result = result.filter(d => d.level === filterLevel.value)
  }
  
  return result
})

const myDictionaries = computed(() => 
  filteredDictionaries.value.filter(d => d.creator_id === authStore.user?.id)
)

const publicDictionaries = computed(() => 
  filteredDictionaries.value.filter(d => d.is_public && d.creator_id !== authStore.user?.id)
)

// 方法
function handleCardClick(dict: Dictionary) {
  router.push(`/dictionaries/${dict.id}`)
}

// 获取封面URL（处理默认封面）
function getCoverUrl(dict: Dictionary): string {
  if (!dict.cover_image) return ''
  if (dict.cover_image === 'default' || dict.cover_image.includes('dictionary-default')) {
    return `${baseUrl}dictionary-default.svg`
  }
  return dict.cover_image
}

async function handleSelectDictionary(dict: Dictionary) {
  try {
    await dictionaryStore.selectDictionary(dict.id)
    MessagePlugin.success(`已选用「${dict.name}」作为当前词典`)
  } catch (error) {
    MessagePlugin.error('选用失败')
  }
}

function handleEditDictionary(dict: Dictionary) {
  editingDictionary.value = dict
  Object.assign(formData, {
    name: dict.name,
    description: dict.description || '',
    cover_image: dict.cover_image || '',
    level: dict.level,
    type: dict.type,
    is_public: dict.is_public
  })
  // 根据已有封面设置封面类型
  if (!dict.cover_image) {
    coverType.value = 'none'
  } else if (dict.cover_image === 'default' || dict.cover_image.includes('dictionary-default')) {
    coverType.value = 'default'
  } else if (dict.cover_image.startsWith('http')) {
    // 判断是随机图片还是自定义图片（通过URL判断）
    if (dict.cover_image.includes('unsplash') || dict.cover_image.includes('picsum') || dict.cover_image.includes('loremflickr')) {
      coverType.value = 'random'
      randomCoverUrl.value = dict.cover_image
    } else {
      coverType.value = 'custom'
      customCoverUrl.value = dict.cover_image
    }
  }
  coverFiles.value = []
  showCreateDialog.value = true
}

async function handleDeleteDictionary(id: string) {
  try {
    await dictionaryStore.deleteDictionary(id)
    MessagePlugin.success('删除成功')
  } catch (error) {
    MessagePlugin.error('删除失败')
  }
}

async function handleUploadCover(file: { raw: File }) {
  if (!authStore.user) {
    MessagePlugin.error('请先登录')
    return { status: 'fail', error: { message: '未登录' } }
  }

  try {
    const fileExt = file.raw.name.split('.').pop()
    const fileName = `${authStore.user.id}/${Date.now()}.${fileExt}`
    
    const { data, error } = await supabase.storage
      .from('dictionary-covers')
      .upload(fileName, file.raw, {
        cacheControl: '3600',
        upsert: false
      })
    
    if (error) throw error
    
    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from('dictionary-covers')
      .getPublicUrl(data.path)
    
    formData.cover_image = urlData.publicUrl
    
    return { 
      status: 'success', 
      response: { url: urlData.publicUrl }
    }
  } catch (error: any) {
    console.error('Upload error:', error)
    MessagePlugin.error(error.message || '上传失败')
    return { status: 'fail', error: { message: error.message } }
  }
}

function handleRemoveCover() {
  formData.cover_image = ''
  coverFiles.value = []
  customCoverUrl.value = ''
  coverType.value = 'none'
}

// 选择封面类型
function selectCoverType(type: 'none' | 'default' | 'random' | 'custom') {
  coverType.value = type
  if (type === 'none') {
    formData.cover_image = ''
  } else if (type === 'default') {
    formData.cover_image = 'default'
  } else if (type === 'random' && randomCoverUrl.value) {
    formData.cover_image = randomCoverUrl.value
  } else if (type === 'custom' && customCoverUrl.value) {
    formData.cover_image = customCoverUrl.value
  }
}

// 选择随机封面
async function selectRandomCover() {
  coverType.value = 'random'
  randomCoverUrl.value = ''
  await fetchRandomCover()
}

// 获取随机封面（使用词典名称作为主题）
async function fetchRandomCover() {
  loadingRandomCover.value = true
  
  try {
    // 使用词典名称或默认词作为查询主题
    const query = formData.name || 'dictionary'
    const imageUrl = await fetchFromUnsplash(query)
    
    if (imageUrl) {
      randomCoverUrl.value = imageUrl
      formData.cover_image = imageUrl
    }
  } catch (e) {
    console.warn('fetchRandomCover failed:', e)
    // 失败时尝试 Picsum
    try {
      const picsumUrl = `https://picsum.photos/400/240?random=${Date.now()}`
      randomCoverUrl.value = picsumUrl
      formData.cover_image = picsumUrl
    } catch {
      randomCoverUrl.value = ''
    }
  } finally {
    loadingRandomCover.value = false
  }
}

// 从 Unsplash 获取图片
async function fetchFromUnsplash(query: string): Promise<string | null> {
  if (!UNSPLASH_ACCESS_KEY) {
    // 没有 API key，使用 Picsum 替代
    return `https://picsum.photos/400/240?random=${Date.now()}`
  }
  
  const response = await fetch(
    `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&w=400&h=240`,
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
  return data.urls?.small || data.urls?.regular || null
}

// 触发上传
function triggerUpload() {
  coverType.value = 'custom'
  uploadRef.value?.triggerUpload()
}

// 处理封面文件变化
async function handleCoverChange(files: any[]) {
  if (files.length === 0) return
  
  const file = files[files.length - 1]
  if (!file.raw) return
  
  // 验证文件
  const isImage = file.raw.type.startsWith('image/')
  const isLt2M = file.raw.size / 1024 / 1024 < 2
  
  if (!isImage) {
    MessagePlugin.error('只能上传图片文件')
    return
  }
  if (!isLt2M) {
    MessagePlugin.error('图片大小不能超过 2MB')
    return
  }
  
  uploadingCover.value = true
  try {
    const result = await handleUploadCover(file)
    if (result.status === 'success' && result.response?.url) {
      customCoverUrl.value = result.response.url
      formData.cover_image = result.response.url
      MessagePlugin.success('封面上传成功')
    }
  } catch (error) {
    MessagePlugin.error('上传失败')
  } finally {
    uploadingCover.value = false
  }
}

async function handleSaveDictionary() {
  const result = await formRef.value?.validate()
  if (result !== true) return

  saving.value = true
  try {
    // 自动设置作者为当前用户昵称或邮箱
    const author = authStore.profile?.nickname || authStore.user?.email?.split('@')[0] || '匿名用户'
    
    if (editingDictionary.value) {
      await dictionaryStore.updateDictionary(editingDictionary.value.id, {
        ...formData,
        author
      })
      MessagePlugin.success('更新成功')
    } else {
      const newDict = await dictionaryStore.createDictionary({
        ...formData,
        author
      })
      MessagePlugin.success('创建成功')
      // 跳转到新词典的单词管理页
      router.push(`/dictionaries/${newDict.id}`)
    }
    showCreateDialog.value = false
    resetForm()
  } catch (error: any) {
    MessagePlugin.error(error.message || '操作失败')
  } finally {
    saving.value = false
  }
}

function resetForm() {
  editingDictionary.value = null
  coverFiles.value = []
  coverType.value = 'default'
  customCoverUrl.value = ''
  randomCoverUrl.value = ''
  Object.assign(formData, {
    name: '',
    description: '',
    cover_image: 'default',
    level: 'junior',
    type: 'vocabulary',
    is_public: false
  })
}

onMounted(async () => {
  await dictionaryStore.init()
})
</script>

<style lang="scss" scoped>
.dictionaries-page {
  max-width: 1400px;
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
      margin-top: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: var(--honey-100);
        border-color: var(--honey-300);
      }
    }
  }

  .action-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 2rem;
    padding: 1rem;
    background: var(--bg-card);
    border-radius: 12px;

    .action-left,
    .action-right {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .search-input {
      width: 280px;
    }
    
    .filter-select {
      width: 140px;
    }
  }

  .section {
    margin-bottom: 2.5rem;

    .section-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.25rem;

      h2 {
        font-size: 1.25rem;
        font-weight: 600;
      }

      .count {
        color: var(--text-secondary);
        font-size: 0.9rem;
      }
    }
  }

  .dict-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.25rem;
  }

  .dict-card {
    background: var(--bg-card);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid transparent;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
    }

    &.selected {
      border-color: var(--honey-500);
    }

    .card-cover {
      position: relative;
      height: 140px;
      background: linear-gradient(135deg, var(--honey-100), var(--honey-200));

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cover-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--honey-500);
      }

      .card-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--honey-500);
        color: white;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 500;
      }
    }

    .card-content {
      padding: 1rem;

      h3 {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .description {
        font-size: 0.85rem;
        color: var(--text-secondary);
        margin-bottom: 0.75rem;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        min-height: 2.5em;
      }

      .card-author {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.8rem;
        color: var(--text-secondary);
        margin-bottom: 0.5rem;
      }

      .card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
    }

    .card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.25rem;
      padding: 0.5rem 1rem 1rem;
      border-top: 1px solid var(--border-color);
    }
  }

  .empty-hint {
    padding: 2rem;
    text-align: center;
    color: var(--text-secondary);
    background: var(--bg-card);
    border-radius: 12px;
  }

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    color: var(--text-secondary);

    h3 {
      margin: 1rem 0 0.5rem;
      color: var(--text-primary);
    }
  }

  .form-hint {
    margin-left: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
}

// 封面选择样式
.cover-selection {
  width: 100%;
  
  .cover-options {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  
  .cover-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    
    .cover-option-preview {
      width: 100px;
      height: 60px;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid var(--border-color);
      transition: all 0.2s;
      background: var(--bg-page);
      
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      &.empty {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
      }

      &.default-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--honey-100), var(--honey-200));
        color: var(--honey-500);
      }
    }
    
    span {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    
    &:hover .cover-option-preview {
      border-color: var(--honey-400);
    }
    
    &.active {
      .cover-option-preview {
        border-color: var(--honey-500);
        box-shadow: 0 0 0 2px rgba(var(--honey-500-rgb), 0.2);
      }
      
      span {
        color: var(--honey-600);
        font-weight: 500;
      }
    }
  }
  
  .upload-loading {
    margin-top: 0.5rem;
  }
}

@media (max-width: 768px) {
  .dictionaries-page {
    .action-bar {
      flex-direction: column;

      .action-left {
        width: 100%;
        flex-direction: row;
        
        .search-input {
          flex: 1;
          min-width: 0;
        }
        
        .filter-select {
          width: 120px;
          flex-shrink: 0;
        }
      }
      
      .action-right {
        width: 100%;
      }
    }

    .dict-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
