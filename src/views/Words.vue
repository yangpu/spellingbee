<template>
  <div class="words-page">
    <!-- 返回按钮和词典信息 -->
    <div class="page-header">
      <div class="header-left">
        <t-button variant="text" @click="router.push('/dictionaries')">
          <template #icon><t-icon name="chevron-left" /></template>
          返回词典列表
        </t-button>
      </div>
    </div>

    <!-- 词典信息卡片 -->
    <div class="dictionary-card" v-if="currentDictionary">
      <div class="card-cover">
        <img v-if="getCoverUrl(currentDictionary)" :src="getCoverUrl(currentDictionary)" alt="封面" />
        <div v-else class="cover-placeholder">
          <t-icon name="book" size="48px" />
        </div>
      </div>
      <div class="card-body">
        <div class="card-content">
          <h1>{{ currentDictionary.name }}</h1>
          <p class="description">{{ currentDictionary.description || '暂无描述' }}</p>
          <div class="card-meta">
            <span class="meta-item"><t-icon name="user" /> {{ currentDictionary.author || '未知作者' }}</span>
            <span class="meta-item"><t-icon name="time" /> {{ formatDate(currentDictionary.updated_at) }}</span>
          </div>
          <div class="card-tags">
            <t-tag size="small" variant="light" theme="primary">{{ DictionaryLevelLabels[currentDictionary.level] }}</t-tag>
            <t-tag size="small" variant="light">{{ DictionaryTypeLabels[currentDictionary.type] }}</t-tag>
            <t-tag size="small" variant="light">{{ currentDictionary.word_count || words.length }} 词</t-tag>
            <t-tag size="small" variant="light" v-if="currentDictionary.is_public" theme="success">公开</t-tag>
          </div>
        </div>
        <div class="card-actions" v-if="!isCurrentDictionary">
          <t-button theme="primary" @click="handleSelectAsCurrent">
            <template #icon><t-icon name="check-circle" /></template>
            设为当前词典
          </t-button>
        </div>
      </div>
      <div class="card-badge" v-if="isCurrentDictionary">
        <t-icon name="check" />
        当前使用
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar" v-if="currentDictionary">
      <div class="toolbar-left">
        <t-input
          v-model="searchQuery"
          placeholder="搜索单词或释义..."
          clearable
          class="search-input"
        >
          <template #prefix-icon>
            <t-icon name="search" />
          </template>
        </t-input>
        <t-select
          v-model="filterDifficulty"
          placeholder="难度筛选"
          clearable
          class="filter-select"
        >
          <t-option :value="1" label="⭐ 简单" />
          <t-option :value="2" label="⭐⭐ 较易" />
          <t-option :value="3" label="⭐⭐⭐ 中等" />
          <t-option :value="4" label="⭐⭐⭐⭐ 较难" />
          <t-option :value="5" label="⭐⭐⭐⭐⭐ 困难" />
        </t-select>
      </div>
      <div class="toolbar-right" v-if="isOwner">
        <t-dropdown :options="importOptions" @click="handleImportClick" :min-column-width="180">
          <t-button variant="outline">
            <template #icon><t-icon name="upload" /></template>
            导入
            <template #suffix><t-icon name="chevron-down" /></template>
          </t-button>
        </t-dropdown>
        <t-button variant="outline" @click="handleExport">
          <template #icon><t-icon name="download" /></template>
          导出
        </t-button>
        <t-button theme="primary" @click="showAddWordDialog = true">
          <template #icon><t-icon name="add" /></template>
          添加单词
        </t-button>
        <t-button theme="primary" variant="outline" @click="openBatchWordDialog">
          <template #icon><t-icon name="file-add" /></template>
          批量单词
        </t-button>
      </div>
    </div>

    <!-- 统计行 -->
    <div class="stats-row" v-if="currentDictionary">
      <div class="stat-item" :class="{ active: filterDifficulty === null }" @click="setDifficultyFilter(null)">
        <span class="stat-value">{{ words.length }}</span>
        <span class="stat-label">总单词数</span>
      </div>
      <div 
        class="stat-item" 
        :class="{ active: filterDifficulty === Number(level) }"
        v-for="(count, level) in difficultyCounts" 
        :key="level"
        @click="setDifficultyFilter(Number(level))"
      >
        <span class="stat-value">{{ count }}</span>
        <span class="stat-label">{{ getDifficultyLabel(level) }}</span>
      </div>
    </div>

    <!-- 单词表格 -->
    <div class="words-table-container" v-if="currentDictionary && words.length > 0">
      <t-table
        :data="filteredWords"
        :columns="columns"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        hover
        stripe
        @page-change="handlePageChange"
      >
        <template #index="{ row }">
          <span class="word-index">{{ getWordIndex(row.id) }}</span>
        </template>
        <template #word="{ row }">
          <div class="word-cell">
            <span class="word-text">{{ row.word }}</span>
            <t-button size="small" variant="text" @click="speakWord(row.word)">
              <template #icon><t-icon name="sound" /></template>
            </t-button>
          </div>
        </template>
        <template #difficulty="{ row }">
          <t-tag :theme="getDifficultyTheme(row.difficulty)" variant="light">
            {{ '⭐'.repeat(row.difficulty) }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-space v-if="isOwner">
            <t-button size="small" variant="text" @click="handleEditWord(row)">
              编辑
            </t-button>
            <t-popconfirm content="确定删除这个单词吗？" @confirm="handleDeleteWord(row.id)">
              <t-button size="small" variant="text" theme="danger">
                删除
              </t-button>
            </t-popconfirm>
          </t-space>
          <span v-else class="readonly-hint">只读</span>
        </template>
      </t-table>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else-if="currentDictionary && words.length === 0 && !loading">
      <t-icon name="file-add" size="64px" />
      <h3>词典还没有单词</h3>
      <p v-if="isOwner">开始添加单词或导入词库</p>
      <p v-else>该词典暂无单词</p>
      <t-space v-if="isOwner">
        <t-button theme="primary" @click="showAddWordDialog = true">
          <template #icon><t-icon name="add" /></template>
          添加单词
        </t-button>
        <t-dropdown :options="importOptions" @click="handleImportClick">
          <t-button variant="outline">
            <template #icon><t-icon name="upload" /></template>
            导入词库
          </t-button>
        </t-dropdown>
      </t-space>
    </div>

    <!-- 加载状态 -->
    <div class="loading-state" v-if="loading">
      <t-loading />
      <p>加载中...</p>
    </div>

    <!-- 添加/编辑单词对话框 -->
    <t-dialog
      v-model:visible="showAddWordDialog"
      :header="editingWord ? '编辑单词' : '添加单词'"
      width="600px"
      :confirm-btn="{ content: '保存', theme: 'primary', loading: saving }"
      :cancel-btn="{ content: '取消' }"
      @confirm="handleSaveWord"
      @close="resetWordForm"
    >
      <t-form ref="wordFormRef" :data="wordForm" :rules="wordRules" label-width="80px">
        <t-form-item label="单词" name="word">
          <div class="word-input-with-speak">
            <t-input v-model="wordForm.word" placeholder="请输入单词" style="flex: 1" />
            <t-button variant="outline" :disabled="!wordForm.word" @click="speakWord(wordForm.word)">
              <template #icon><t-icon name="sound" /></template>
            </t-button>
          </div>
        </t-form-item>
        <t-form-item label="音标" name="pronunciation">
          <t-input v-model="wordForm.pronunciation" placeholder="例如: /ˈeksəmpəl/" />
        </t-form-item>
        <t-form-item label="词性" name="part_of_speech">
          <t-select v-model="wordForm.part_of_speech" placeholder="请选择词性" clearable>
            <t-option value="noun" label="名词 (noun)" />
            <t-option value="verb" label="动词 (verb)" />
            <t-option value="adjective" label="形容词 (adjective)" />
            <t-option value="adverb" label="副词 (adverb)" />
            <t-option value="preposition" label="介词 (preposition)" />
            <t-option value="conjunction" label="连词 (conjunction)" />
            <t-option value="pronoun" label="代词 (pronoun)" />
            <t-option value="interjection" label="感叹词 (interjection)" />
          </t-select>
        </t-form-item>
        <t-form-item label="英文释义" name="definition">
          <t-textarea v-model="wordForm.definition" placeholder="请输入英文释义" :rows="2" />
        </t-form-item>
        <t-form-item label="中文释义" name="definition_cn">
          <t-textarea v-model="wordForm.definition_cn" placeholder="请输入中文释义" :rows="2" />
        </t-form-item>
        <t-form-item label="例句" name="example_sentence">
          <t-textarea v-model="wordForm.example_sentence" placeholder="请输入例句" :rows="2" />
        </t-form-item>
        <t-form-item label="难度" name="difficulty">
          <t-slider v-model="wordForm.difficulty" :min="1" :max="5" :step="1" :marks="difficultyMarks" />
        </t-form-item>
        <t-form-item label="分类" name="category">
          <t-input v-model="wordForm.category" placeholder="请输入分类" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 导入对话框 -->
    <t-dialog
      v-model:visible="showImportDialog"
      :header="importDialogTitle"
      width="700px"
      :confirm-btn="{ content: importMode === 'wordlist' ? '生成词库' : '导入', theme: 'primary', loading: importing }"
      :cancel-btn="{ content: '取消' }"
      @confirm="handleImportConfirm"
    >
      <!-- JSON 导入 -->
      <div v-if="importMode === 'json'">
        <t-upload
          :request-method="handleJSONUpload"
          accept=".json"
          theme="custom"
          draggable
        >
          <div class="upload-area">
            <t-icon name="upload" size="48px" />
            <p>点击或拖拽 JSON 文件到此处</p>
            <span>支持标准词库 JSON 格式</span>
          </div>
        </t-upload>
      </div>

      <!-- CSV 导入 -->
      <div v-else-if="importMode === 'csv'">
        <t-upload
          :request-method="handleCSVUpload"
          accept=".csv"
          theme="custom"
          draggable
        >
          <div class="upload-area">
            <t-icon name="upload" size="48px" />
            <p>点击或拖拽 CSV 文件到此处</p>
            <span>CSV 首行应包含列名：word, pronunciation, definition, definition_cn, part_of_speech, example_sentence, difficulty, category</span>
          </div>
        </t-upload>
      </div>

      <!-- 单词列表导入 -->
      <div v-else-if="importMode === 'wordlist'" class="wordlist-import">
        <t-textarea
          v-model="wordListInput"
          placeholder="输入单词列表，每行一个单词或用逗号分隔&#10;例如：&#10;apple&#10;banana&#10;cherry&#10;&#10;或：apple, banana, cherry"
          :rows="10"
        />
        <div class="wordlist-preview" v-if="parsedWordList.length > 0">
          <p>识别到 <strong>{{ parsedWordList.length }}</strong> 个单词</p>
          <div class="word-tags">
            <t-tag v-for="word in parsedWordList.slice(0, 20)" :key="word" size="small">{{ word }}</t-tag>
            <t-tag v-if="parsedWordList.length > 20" size="small" variant="light">+{{ parsedWordList.length - 20 }} 更多</t-tag>
          </div>
        </div>
        <t-alert theme="info" style="margin-top: 12px">
          <template #message>
            系统将自动查询在线词典 API，生成完整的单词定义。此过程可能需要一些时间。
          </template>
        </t-alert>
      </div>

      <!-- 导入进度 -->
      <div v-if="importProgress.show" class="import-progress">
        <t-progress :percentage="importProgress.percentage" :status="importProgress.status" />
        <p>{{ importProgress.message }}</p>
      </div>
    </t-dialog>

    <!-- 批量单词弹窗 -->
    <t-dialog
      v-model:visible="showBatchWordDialog"
      header="批量添加单词"
      width="700px"
      :confirm-btn="{ content: '生成词库', theme: 'primary', loading: batchGenerating }"
      :cancel-btn="{ content: '取消' }"
      @confirm="handleBatchGenerate"
    >
      <div class="batch-word-dialog">
        <div class="provider-select">
          <label>词典服务商：</label>
          <t-select v-model="selectedProvider" style="width: 200px">
            <t-option value="free" label="Free Dictionary (英文)" />
            <t-option value="mymemory" label="MyMemory (英中翻译)" />
          </t-select>
          <t-tag v-if="selectedProvider === 'free'" theme="warning" variant="light" size="small">仅英文释义</t-tag>
          <t-tag v-else theme="success" variant="light" size="small">含中文释义</t-tag>
        </div>
        <t-textarea
          v-model="batchWordInput"
          placeholder="输入单词列表，每行一个单词或用逗号分隔&#10;例如：&#10;apple&#10;banana&#10;cherry&#10;&#10;或：apple, banana, cherry"
          :rows="10"
        />
        <div class="wordlist-preview" v-if="parsedBatchWordList.length > 0">
          <p>识别到 <strong>{{ parsedBatchWordList.length }}</strong> 个单词</p>
          <div class="word-tags">
            <t-tag v-for="word in parsedBatchWordList.slice(0, 20)" :key="word" size="small">{{ word }}</t-tag>
            <t-tag v-if="parsedBatchWordList.length > 20" size="small" variant="light">+{{ parsedBatchWordList.length - 20 }} 更多</t-tag>
          </div>
        </div>
        <t-alert theme="info" style="margin-top: 12px">
          <template #message>
            <span v-if="selectedProvider === 'free'">使用 Free Dictionary API，仅提供英文释义和音标。</span>
            <span v-else>使用 MyMemory 翻译 API，可获取中文释义。生成速度较慢但质量更好。</span>
          </template>
        </t-alert>
        <!-- 生成进度 -->
        <div v-if="batchProgress.show" class="import-progress">
          <t-progress :percentage="batchProgress.percentage" :status="batchProgress.status" />
          <p>{{ batchProgress.message }}</p>
        </div>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useDictionaryStore } from '@/stores/dictionary'
import { useAuthStore } from '@/stores/auth'
import { useSpeechStore } from '@/stores/speech'
import { supabase } from '@/lib/supabase'
import { generateWordDefinitions, setDictionaryProvider, type DictionaryProvider } from '@/lib/dictionary-api'
import { DictionaryLevelLabels, DictionaryTypeLabels } from '@/types'
import type { Word, Dictionary } from '@/types'

const route = useRoute()
const router = useRouter()
const dictionaryStore = useDictionaryStore()
const authStore = useAuthStore()
const speechStore = useSpeechStore()

// 当前词典和单词
const currentDictionary = ref<Dictionary | null>(null)
const words = ref<Word[]>([])
const loading = ref(false)

// 保存进入页面时的"当前使用"词典ID（不随页面操作变化）
const savedCurrentDictId = ref<string | null>(null)

// 搜索和筛选
const searchQuery = ref('')
const filterDifficulty = ref<number | null>(null)

// 分页
const pagination = reactive({
  current: 1,
  pageSize: 15,
  total: 0,
  showJumper: true,
  showPageSize: true,
  pageSizeOptions: [10, 15, 20, 50]
})

// 对话框状态
const showAddWordDialog = ref(false)
const showImportDialog = ref(false)
const saving = ref(false)
const importing = ref(false)

// 编辑状态
const editingWord = ref<Word | null>(null)

// 导入模式
const importMode = ref<'json' | 'csv' | 'wordlist'>('json')
const wordListInput = ref('')

// 批量单词弹窗
const showBatchWordDialog = ref(false)
const batchWordInput = ref('')
const batchGenerating = ref(false)
const selectedProvider = ref<DictionaryProvider>('mymemory')
const batchProgress = reactive({
  show: false,
  percentage: 0,
  message: '',
  status: 'active' as 'active' | 'success' | 'error'
})

// 导入进度
const importProgress = reactive({
  show: false,
  percentage: 0,
  message: '',
  status: 'active' as 'active' | 'success' | 'error'
})

// 表单引用
const wordFormRef = ref()

// 单词表单
const wordForm = reactive({
  word: '',
  pronunciation: '',
  part_of_speech: '',
  definition: '',
  definition_cn: '',
  example_sentence: '',
  difficulty: 3,
  category: ''
})

const wordRules = {
  word: [{ required: true, message: '请输入单词', type: 'error' as const }],
  definition: [{ required: true, message: '请输入释义', type: 'error' as const }]
}

const difficultyMarks = {
  1: '简单',
  2: '较易',
  3: '中等',
  4: '较难',
  5: '困难'
}

// 表格列
const columns = computed(() => {
  const cols = [
    { colKey: 'index', title: '序号', width: 70 },
    { colKey: 'word', title: '单词', width: 180 },
    { colKey: 'pronunciation', title: '音标', width: 140 },
    { colKey: 'part_of_speech', title: '词性', width: 100 },
    { colKey: 'definition_cn', title: '中文释义', width: 150, ellipsis: true },
    { colKey: 'definition', title: '英文释义', ellipsis: true },
    { colKey: 'difficulty', title: '难度', width: 120 },
    { colKey: 'category', title: '分类', width: 100 },
    { colKey: 'operation', title: '操作', width: isOwner.value ? 120 : 60 }
  ]
  return cols
})

// 导入选项
const importOptions = [
  { content: '📄 导入 JSON 文件', value: 'json' },
  { content: '📊 导入 CSV 文件', value: 'csv' },
  { content: '✏️ 输入单词列表', value: 'wordlist' }
]

// 计算属性
const isOwner = computed(() => 
  currentDictionary.value?.creator_id === authStore.user?.id
)

const isCurrentDictionary = computed(() =>
  savedCurrentDictId.value === currentDictionary.value?.id
)

const filteredWords = computed(() => {
  let result = [...words.value]

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(w =>
      w.word.toLowerCase().includes(q) ||
      w.definition.toLowerCase().includes(q) ||
      (w.definition_cn && w.definition_cn.includes(q))
    )
  }

  if (filterDifficulty.value !== null) {
    result = result.filter(w => w.difficulty === filterDifficulty.value)
  }

  pagination.total = result.length

  // 分页
  const start = (pagination.current - 1) * pagination.pageSize
  const end = start + pagination.pageSize
  return result.slice(start, end)
})

const difficultyCounts = computed(() => {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  words.value.forEach(w => {
    if (counts[w.difficulty] !== undefined) {
      counts[w.difficulty]++
    }
  })
  return counts
})

const parsedWordList = computed(() => {
  return wordListInput.value
    .split(/[,\n]/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && /^[a-z]+$/i.test(w))
})

const parsedBatchWordList = computed(() => {
  return batchWordInput.value
    .split(/[,\n]/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && /^[a-z]+$/i.test(w))
})

const importDialogTitle = computed(() => {
  switch (importMode.value) {
    case 'json': return '导入 JSON 文件'
    case 'csv': return '导入 CSV 文件'
    case 'wordlist': return '从单词列表生成词库'
    default: return '导入'
  }
})

// 方法
function getDifficultyLabel(level: number | string) {
  const labels: Record<number, string> = { 1: '简单', 2: '较易', 3: '中等', 4: '较难', 5: '困难' }
  return labels[Number(level)] || ''
}

function getDifficultyTheme(level: number) {
  const themes: Record<number, string> = { 1: 'success', 2: 'primary', 3: 'warning', 4: 'danger', 5: 'danger' }
  return themes[level] || 'default'
}

const baseUrl = import.meta.env.BASE_URL

// 获取封面URL（处理默认封面）
function getCoverUrl(dict: Dictionary | null): string {
  if (!dict?.cover_image) return ''
  if (dict.cover_image === 'default' || dict.cover_image.includes('dictionary-default')) {
    return `${baseUrl}dictionary-default.svg`
  }
  return dict.cover_image
}

function getWordIndex(wordId: string) {
  // 按添加顺序（原始数组顺序）查找索引
  const index = words.value.findIndex(w => w.id === wordId)
  return index >= 0 ? index + 1 : '-'
}

function setDifficultyFilter(level: number | null) {
  filterDifficulty.value = filterDifficulty.value === level ? null : level
  pagination.current = 1
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

function speakWord(word: string) {
  speechStore.speakWord(word)
}

function handlePageChange(pageInfo: { current: number; pageSize: number }) {
  pagination.current = pageInfo.current
  pagination.pageSize = pageInfo.pageSize
}

async function handleSelectAsCurrent() {
  if (!currentDictionary.value) return
  try {
    await dictionaryStore.selectDictionary(currentDictionary.value.id)
    // 更新保存的当前词典ID，使标识立即显示
    savedCurrentDictId.value = currentDictionary.value.id
    MessagePlugin.success('已设为当前词典')
  } catch (error) {
    MessagePlugin.error('设置失败')
  }
}

function handleEditWord(row: Word) {
  editingWord.value = row
  Object.assign(wordForm, row)
  showAddWordDialog.value = true
}

async function handleDeleteWord(id: string) {
  try {
    await dictionaryStore.deleteWord(id)
    // 从本地列表中移除
    words.value = words.value.filter(w => w.id !== id)
    MessagePlugin.success('删除成功')
  } catch (error) {
    MessagePlugin.error('删除失败')
  }
}

async function handleSaveWord() {
  const result = await wordFormRef.value?.validate()
  if (result !== true) return

  if (!currentDictionary.value) {
    MessagePlugin.warning('词典信息丢失')
    return
  }

  saving.value = true
  try {
    if (editingWord.value) {
      await dictionaryStore.updateWord(editingWord.value.id, { ...wordForm })
      // 更新本地列表
      const index = words.value.findIndex(w => w.id === editingWord.value!.id)
      if (index !== -1) {
        words.value[index] = { ...words.value[index], ...wordForm }
      }
      MessagePlugin.success('更新成功')
    } else {
      const newWord = await dictionaryStore.addWord(currentDictionary.value.id, { ...wordForm })
      words.value.push(newWord)
      MessagePlugin.success('添加成功')
    }
    showAddWordDialog.value = false
    resetWordForm()
  } catch (error) {
    MessagePlugin.error((error as Error).message || '操作失败')
  } finally {
    saving.value = false
  }
}

function resetWordForm() {
  editingWord.value = null
  Object.assign(wordForm, {
    word: '',
    pronunciation: '',
    part_of_speech: '',
    definition: '',
    definition_cn: '',
    example_sentence: '',
    difficulty: 3,
    category: ''
  })
}

function handleImportClick(data: { value: string }) {
  importMode.value = data.value as 'json' | 'csv' | 'wordlist'
  wordListInput.value = ''
  importProgress.show = false
  showImportDialog.value = true
}

async function handleJSONUpload(file: { raw: File }) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        if (!currentDictionary.value) throw new Error('词典信息丢失')
        const addedWords = await dictionaryStore.importFromJSON(e.target?.result as string, currentDictionary.value.id)
        // 直接更新本地单词列表（避免重复）
        const existingWords = new Set(words.value.map(w => w.word.toLowerCase()))
        const uniqueNewWords = addedWords.filter(w => !existingWords.has(w.word.toLowerCase()))
        words.value = [...words.value, ...uniqueNewWords]
        MessagePlugin.success(`成功导入 ${addedWords.length} 个单词`)
        showImportDialog.value = false
        resolve({ status: 'success' })
      } catch (error) {
        MessagePlugin.error('导入失败：文件格式错误')
        reject(error)
      }
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file.raw)
  })
}

async function handleCSVUpload(file: { raw: File }) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        if (!currentDictionary.value) throw new Error('词典信息丢失')
        const addedWords = await dictionaryStore.importFromCSV(e.target?.result as string, currentDictionary.value.id)
        // 直接更新本地单词列表（避免重复）
        const existingWords = new Set(words.value.map(w => w.word.toLowerCase()))
        const uniqueNewWords = addedWords.filter(w => !existingWords.has(w.word.toLowerCase()))
        words.value = [...words.value, ...uniqueNewWords]
        MessagePlugin.success(`成功导入 ${addedWords.length} 个单词`)
        showImportDialog.value = false
        resolve({ status: 'success' })
      } catch (error) {
        MessagePlugin.error('导入失败：文件格式错误')
        reject(error)
      }
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file.raw)
  })
}

async function handleImportConfirm() {
  if (importMode.value === 'wordlist') {
    if (parsedWordList.value.length === 0) {
      MessagePlugin.warning('请输入单词列表')
      return
    }

    if (!currentDictionary.value) {
      MessagePlugin.warning('词典信息丢失')
      return
    }

    importing.value = true
    importProgress.show = true
    importProgress.percentage = 0
    importProgress.status = 'active'
    importProgress.message = '正在生成词库...'

    try {
      const { success, failed } = await generateWordDefinitions(
        parsedWordList.value,
        (current, total, word, status) => {
          importProgress.percentage = Math.round((current / total) * 100)
          importProgress.message = `正在处理: ${word} (${current}/${total})`
        }
      )

      if (success.length > 0) {
        const addedWords = await dictionaryStore.addWords(
          currentDictionary.value.id,
          success.map(w => ({
            word: w.word || '',
            pronunciation: w.pronunciation || '',
            definition: w.definition || '',
            definition_cn: w.definition_cn || '',
            part_of_speech: w.part_of_speech || '',
            example_sentence: w.example_sentence || '',
            difficulty: w.difficulty || 3,
            category: w.category || ''
          }))
        )
        // 直接更新本地单词列表（避免重复）
        const existingWords = new Set(words.value.map(w => w.word.toLowerCase()))
        const uniqueNewWords = addedWords.filter(w => !existingWords.has(w.word.toLowerCase()))
        words.value = [...words.value, ...uniqueNewWords]
      }

      importProgress.status = 'success'
      importProgress.message = `完成！成功 ${success.length} 个，失败 ${failed.length} 个`

      if (failed.length > 0) {
        MessagePlugin.warning(`${failed.length} 个单词未能获取定义: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '...' : ''}`)
      } else {
        MessagePlugin.success(`成功导入 ${success.length} 个单词`)
      }

      setTimeout(() => {
        showImportDialog.value = false
        wordListInput.value = ''
        importProgress.show = false
      }, 1500)
    } catch (error) {
      importProgress.status = 'error'
      importProgress.message = '导入失败'
      MessagePlugin.error('导入失败')
    } finally {
      importing.value = false
    }
  }
}

// 批量单词相关方法
function openBatchWordDialog() {
  batchWordInput.value = ''
  batchProgress.show = false
  showBatchWordDialog.value = true
}

async function handleBatchGenerate() {
  if (parsedBatchWordList.value.length === 0) {
    MessagePlugin.warning('请输入单词列表')
    return
  }

  if (!currentDictionary.value) {
    MessagePlugin.warning('词典信息丢失')
    return
  }

  batchGenerating.value = true
  batchProgress.show = true
  batchProgress.percentage = 0
  batchProgress.status = 'active'
  batchProgress.message = '正在生成词库...'

  // 设置词典服务商
  setDictionaryProvider(selectedProvider.value)

  try {
    const { success, failed } = await generateWordDefinitions(
      parsedBatchWordList.value,
      (current, total, word, status) => {
        batchProgress.percentage = Math.round((current / total) * 100)
        batchProgress.message = `正在处理: ${word} (${current}/${total})`
      }
    )

    if (success.length > 0) {
      const addedWords = await dictionaryStore.addWords(
        currentDictionary.value.id,
        success.map(w => ({
          word: w.word || '',
          pronunciation: w.pronunciation || '',
          definition: w.definition || '',
          definition_cn: w.definition_cn || '',
          part_of_speech: w.part_of_speech || '',
          example_sentence: w.example_sentence || '',
          difficulty: w.difficulty || 3,
          category: w.category || ''
        }))
      )
      // 直接更新本地单词列表（避免重复）
      const existingWords = new Set(words.value.map(w => w.word.toLowerCase()))
      const uniqueNewWords = addedWords.filter(w => !existingWords.has(w.word.toLowerCase()))
      words.value = [...words.value, ...uniqueNewWords]
    }

    batchProgress.status = 'success'
    batchProgress.message = `完成！成功 ${success.length} 个，失败 ${failed.length} 个`

    if (failed.length > 0) {
      MessagePlugin.warning(`${failed.length} 个单词未能获取定义: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '...' : ''}`)
    } else {
      MessagePlugin.success(`成功导入 ${success.length} 个单词`)
    }

    setTimeout(() => {
      showBatchWordDialog.value = false
      batchWordInput.value = ''
      batchProgress.show = false
    }, 1500)
  } catch (error) {
    batchProgress.status = 'error'
    batchProgress.message = '生成失败'
    MessagePlugin.error('生成失败')
  } finally {
    batchGenerating.value = false
  }
}

function handleExport() {
  if (!currentDictionary.value) {
    MessagePlugin.warning('词典信息丢失')
    return
  }

  const data = JSON.stringify({
    dictionary: {
      name: currentDictionary.value.name,
      description: currentDictionary.value.description,
      author: currentDictionary.value.author,
      level: currentDictionary.value.level,
      type: currentDictionary.value.type
    },
    words: words.value.map(w => ({
      word: w.word,
      pronunciation: w.pronunciation,
      definition: w.definition,
      definition_cn: w.definition_cn,
      part_of_speech: w.part_of_speech,
      example_sentence: w.example_sentence,
      difficulty: w.difficulty,
      category: w.category
    }))
  }, null, 2)

  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${currentDictionary.value.name}-${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  MessagePlugin.success('导出成功')
}

async function loadDictionaryWords() {
  const dictId = route.params.id as string
  if (!dictId) {
    router.push('/dictionaries')
    return
  }

  loading.value = true
  try {
    // 先加载词典信息
    await dictionaryStore.init()
    
    // 保存进入页面时的"当前使用"词典ID
    savedCurrentDictId.value = dictionaryStore.currentDictionary?.id || null
    
    // 从服务器加载词典详情（不改变当前选用的词典）
    const { data: dictData, error: dictError } = await supabase
      .from('dictionaries')
      .select('*')
      .eq('id', dictId)
      .single()
    
    if (dictError) throw dictError
    
    // 加载单词列表
    await refreshWordsList(dictId)
    
    currentDictionary.value = dictData as Dictionary
  } catch (error) {
    console.error('Failed to load dictionary:', error)
    MessagePlugin.error('加载词典失败')
  } finally {
    loading.value = false
  }
}

// 单独刷新单词列表（不重新加载词典信息）
async function refreshWordsList(dictId?: string) {
  const targetDictId = dictId || (route.params.id as string)
  if (!targetDictId) return
  
  try {
    const { data: wordsData, error: wordsError } = await supabase
      .from('dictionary_words')
      .select('*')
      .eq('dictionary_id', targetDictId)
      .order('sort_order', { ascending: true })
    
    if (wordsError) throw wordsError
    
    words.value = wordsData as Word[]
  } catch (error) {
    console.error('Failed to refresh words:', error)
  }
}

// 监听路由变化
watch(() => route.params.id, (newId) => {
  if (newId) {
    loadDictionaryWords()
  }
}, { immediate: true })

onMounted(() => {
  loadDictionaryWords()
})
</script>

<style lang="scss" scoped>
.words-page {
  max-width: 1400px;
  margin: 0 auto;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .dictionary-card {
    display: flex;
    position: relative;
    background: var(--bg-card);
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 1.5rem;

    .card-cover {
      position: relative;
      width: 200px;
      min-height: 200px;
      flex-shrink: 0;
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
    }

    .card-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      background: var(--honey-500);
      color: white;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 500;
      white-space: nowrap;
    }

    .card-body {
      flex: 1;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;

      .card-content {
        h1 {
          font-size: 1.75rem;
          margin: 0 0 0.5rem;
        }

        .description {
          color: var(--text-secondary);
          margin-bottom: 1rem;
          line-height: 1.5;
        }

        .card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 0.75rem;
          color: var(--text-secondary);
          font-size: 0.85rem;

          .meta-item {
            display: flex;
            align-items: center;
            gap: 0.25rem;
          }
        }

        .card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
      }

      .card-actions {
        margin-top: 1rem;
        display: flex;
        gap: 0.5rem;
      }
    }
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: var(--bg-card);
    border-radius: 12px;

    .toolbar-left,
    .toolbar-right {
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

  .stats-row {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.75rem 1.5rem;
      background: var(--bg-card);
      border-radius: 8px;
      min-width: 80px;
      cursor: pointer;
      transition: all 0.2s;
      border: 2px solid transparent;

      &:hover {
        background: var(--hover-bg);
      }

      &.active {
        border-color: var(--honey-500);
        background: var(--accent-bg);
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--honey-600);
      }

      .stat-label {
        font-size: 0.8rem;
        color: var(--text-secondary);
      }
    }
  }

  .words-table-container {
    background: var(--bg-card);
    border-radius: 12px;
    overflow: hidden;

    .word-cell {
      display: flex;
      align-items: center;
      gap: 0.5rem;

      .word-text {
        font-weight: 600;
        color: var(--charcoal-800);
      }
    }

    .word-index {
      color: var(--text-secondary);
      font-size: 0.85rem;
    }

    .readonly-hint {
      color: var(--text-secondary);
      font-size: 0.8rem;
    }
  }

  .empty-state,
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    background: var(--bg-card);
    border-radius: 12px;
    text-align: center;
    color: var(--text-secondary);

    h3 {
      margin: 1rem 0 0.5rem;
      color: var(--text-primary);
    }

    p {
      margin-bottom: 1.5rem;
    }
  }
}

// 导入对话框 - 隐藏 t-upload 内部滚动条
:deep(.t-upload__dragger) {
  max-height: none !important;
  overflow: visible !important;
}

:deep(.t-upload__dragger-progress) {
  display: none;
}

.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--honey-500);
    background: var(--accent-bg);
  }

  p {
    margin: 0.75rem 0 0.5rem;
    font-weight: 500;
  }

  span {
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-align: center;
    line-height: 1.4;
    max-width: 100%;
    word-break: break-word;
  }
}

.wordlist-import {
  .wordlist-preview {
    margin-top: 1rem;
    padding: 1rem;
    background: var(--bg-page);
    border-radius: 8px;

    p {
      margin-bottom: 0.75rem;
    }

    .word-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  }
}

.import-progress {
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--bg-page);
  border-radius: 8px;

  p {
    margin-top: 0.75rem;
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
}

// 批量单词弹窗
.batch-word-dialog {
  .provider-select {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    
    label {
      font-weight: 500;
      white-space: nowrap;
    }
  }
  
  .wordlist-preview {
    margin-top: 1rem;
    padding: 1rem;
    background: var(--bg-page);
    border-radius: 8px;

    p {
      margin-bottom: 0.75rem;
    }

    .word-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  }
}

// 单词输入带发音按钮
.word-input-with-speak {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

// Dark 主题下拉菜单样式修复
:deep(.t-dropdown__menu) {
  min-width: 180px !important;
}

:global([theme-mode="dark"]) {
  :deep(.t-dropdown__item:hover) {
    background-color: var(--td-bg-color-container-hover) !important;
  }
}

@media (max-width: 768px) {
  .words-page {
    .dictionary-card {
      flex-direction: column;

      .card-cover {
        width: 100%;
        min-height: 180px;
        max-height: 220px;
      }

      .card-body {
        .card-content {
          text-align: center;

          .card-meta {
            justify-content: center;
          }

          .card-tags {
            justify-content: center;
          }
        }

        .card-actions {
          justify-content: center;
        }
      }
    }

    .toolbar {
      flex-direction: column;

      .toolbar-left {
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
      
      .toolbar-right {
        width: 100%;
        flex-wrap: wrap;
        justify-content: flex-start;
      }
    }

    .stats-row {
      justify-content: center;
    }

    :deep(.t-pagination__jump) {
      display: none;
    }
  }
}
</style>
