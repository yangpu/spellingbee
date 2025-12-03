<template>
  <div class="words-page">
    <div class="page-header">
      <h1>词库管理</h1>
      <p>管理你的单词库，支持添加、编辑、导入和导出</p>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <t-input
          v-model="searchQuery"
          placeholder="搜索单词或释义..."
          clearable
          style="width: 300px"
        >
          <template #prefix-icon>
            <t-icon name="search" />
          </template>
        </t-input>
        <t-select
          v-model="filterDifficulty"
          placeholder="难度筛选"
          clearable
          style="width: 140px"
        >
          <t-option :value="1" label="⭐ 简单" />
          <t-option :value="2" label="⭐⭐ 较易" />
          <t-option :value="3" label="⭐⭐⭐ 中等" />
          <t-option :value="4" label="⭐⭐⭐⭐ 较难" />
          <t-option :value="5" label="⭐⭐⭐⭐⭐ 困难" />
        </t-select>
        <t-select
          v-model="filterCategory"
          placeholder="分类筛选"
          clearable
          style="width: 140px"
        >
          <t-option
            v-for="cat in categories"
            :key="cat"
            :value="cat"
            :label="cat"
          />
        </t-select>
      </div>
      <div class="toolbar-right">
        <t-button variant="outline" @click="handleExport">
          <t-icon name="download" />
          导出
        </t-button>
        <t-upload
          :request-method="handleImport"
          accept=".json"
          theme="custom"
        >
          <t-button variant="outline">
            <t-icon name="upload" />
            导入
          </t-button>
        </t-upload>
        <t-button theme="primary" @click="showAddDialog = true">
          <t-icon name="add" />
          添加单词
        </t-button>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-item">
        <span class="stat-value">{{ wordsStore.wordCount }}</span>
        <span class="stat-label">总单词数</span>
      </div>
      <div class="stat-item" v-for="(count, level) in difficultyCounts" :key="level">
        <span class="stat-value">{{ count }}</span>
        <span class="stat-label">{{ getDifficultyLabel(level) }}</span>
      </div>
    </div>

    <!-- Words Table -->
    <div class="words-table-container">
      <t-table
        :data="filteredWords"
        :columns="columns"
        :loading="wordsStore.loading"
        :pagination="pagination"
        row-key="id"
        hover
        stripe
        @page-change="handlePageChange"
      >
        <template #word="{ row }">
          <div class="word-cell">
            <span class="word-text">{{ row.word }}</span>
            <t-button size="small" variant="text" @click="speakWord(row.word)">
              <t-icon name="sound" />
            </t-button>
          </div>
        </template>
        <template #difficulty="{ row }">
          <t-tag :theme="getDifficultyTheme(row.difficulty)" variant="light">
            {{ '⭐'.repeat(row.difficulty) }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-space>
            <t-button size="small" variant="text" @click="handleEdit(row)">
              编辑
            </t-button>
            <t-popconfirm content="确定删除这个单词吗？" @confirm="handleDelete(row.id)">
              <t-button size="small" variant="text" theme="danger">
                删除
              </t-button>
            </t-popconfirm>
          </t-space>
        </template>
      </t-table>
    </div>

    <!-- Add/Edit Dialog -->
    <t-dialog
      v-model:visible="showAddDialog"
      :header="editingWord ? '编辑单词' : '添加单词'"
      width="600px"
      :confirm-btn="{ content: '保存', theme: 'primary', loading: saving }"
      :cancel-btn="{ content: '取消' }"
      @confirm="handleSave"
      @close="resetForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="80px">
        <t-form-item label="单词" name="word">
          <t-input v-model="formData.word" placeholder="请输入单词" />
        </t-form-item>
        <t-form-item label="音标" name="pronunciation">
          <t-input v-model="formData.pronunciation" placeholder="例如: /ˈeksəmpəl/" />
        </t-form-item>
        <t-form-item label="词性" name="part_of_speech">
          <t-select v-model="formData.part_of_speech" placeholder="请选择词性">
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
        <t-form-item label="释义" name="definition">
          <t-textarea v-model="formData.definition" placeholder="请输入单词释义" :rows="2" />
        </t-form-item>
        <t-form-item label="例句" name="example_sentence">
          <t-textarea v-model="formData.example_sentence" placeholder="请输入例句" :rows="2" />
        </t-form-item>
        <t-form-item label="难度" name="difficulty">
          <t-slider v-model="formData.difficulty" :min="1" :max="5" :step="1" :marks="difficultyMarks" />
        </t-form-item>
        <t-form-item label="分类" name="category">
          <t-input v-model="formData.category" placeholder="请输入分类" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useWordsStore } from '@/stores/words'

const wordsStore = useWordsStore()

// Search and filter
const searchQuery = ref('')
const filterDifficulty = ref(null)
const filterCategory = ref(null)

// Pagination
const pagination = reactive({
  current: 1,
  pageSize: 15,
  total: 0,
  showJumper: true,
  showPageSize: true,
  pageSizeOptions: [10, 15, 20, 50]
})

// Dialog
const showAddDialog = ref(false)
const editingWord = ref(null)
const saving = ref(false)
const formRef = ref(null)

const formData = reactive({
  word: '',
  pronunciation: '',
  part_of_speech: '',
  definition: '',
  example_sentence: '',
  difficulty: 3,
  category: 'basic'
})

const formRules = {
  word: [{ required: true, message: '请输入单词', type: 'error' }],
  definition: [{ required: true, message: '请输入释义', type: 'error' }]
}

const difficultyMarks = {
  1: '简单',
  2: '较易',
  3: '中等',
  4: '较难',
  5: '困难'
}

// Table columns
const columns = [
  { colKey: 'word', title: '单词', width: 180 },
  { colKey: 'pronunciation', title: '音标', width: 140 },
  { colKey: 'part_of_speech', title: '词性', width: 100 },
  { colKey: 'definition', title: '释义', ellipsis: true },
  { colKey: 'difficulty', title: '难度', width: 120 },
  { colKey: 'category', title: '分类', width: 100 },
  { colKey: 'operation', title: '操作', width: 120 }
]

// Computed
const filteredWords = computed(() => {
  let result = wordsStore.words

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(w =>
      w.word.toLowerCase().includes(q) ||
      w.definition.toLowerCase().includes(q)
    )
  }

  if (filterDifficulty.value !== null) {
    result = result.filter(w => w.difficulty === filterDifficulty.value)
  }

  if (filterCategory.value) {
    result = result.filter(w => w.category === filterCategory.value)
  }

  pagination.total = result.length
  return result
})

const categories = computed(() => {
  const cats = new Set(wordsStore.words.map(w => w.category))
  return Array.from(cats).sort()
})

const difficultyCounts = computed(() => {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  wordsStore.words.forEach(w => {
    if (counts[w.difficulty] !== undefined) {
      counts[w.difficulty]++
    }
  })
  return counts
})

// Methods
function getDifficultyLabel(level) {
  const labels = { 1: '简单', 2: '较易', 3: '中等', 4: '较难', 5: '困难' }
  return labels[level] || ''
}

function getDifficultyTheme(level) {
  const themes = { 1: 'success', 2: 'primary', 3: 'warning', 4: 'danger', 5: 'danger' }
  return themes[level] || 'default'
}

function speakWord(word) {
  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = 'en-US'
  utterance.rate = 0.8
  speechSynthesis.speak(utterance)
}

function handlePageChange(pageInfo) {
  pagination.current = pageInfo.current
  pagination.pageSize = pageInfo.pageSize
}

function handleEdit(row) {
  editingWord.value = row
  Object.assign(formData, row)
  showAddDialog.value = true
}

async function handleDelete(id) {
  try {
    await wordsStore.deleteWord(id)
    MessagePlugin.success('删除成功')
  } catch (error) {
    MessagePlugin.error('删除失败')
  }
}

async function handleSave() {
  const result = await formRef.value.validate()
  if (result !== true) return

  saving.value = true
  try {
    if (editingWord.value) {
      await wordsStore.updateWord(editingWord.value.id, { ...formData })
      MessagePlugin.success('更新成功')
    } else {
      await wordsStore.addWord({ ...formData })
      MessagePlugin.success('添加成功')
    }
    showAddDialog.value = false
    resetForm()
  } catch (error) {
    MessagePlugin.error(error.message || '操作失败')
  } finally {
    saving.value = false
  }
}

function resetForm() {
  editingWord.value = null
  Object.assign(formData, {
    word: '',
    pronunciation: '',
    part_of_speech: '',
    definition: '',
    example_sentence: '',
    difficulty: 3,
    category: 'basic'
  })
}

async function handleImport(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result)
        const words = Array.isArray(data) ? data : [data]
        const count = await wordsStore.importWords(words)
        MessagePlugin.success(`成功导入 ${count} 个单词`)
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

function handleExport() {
  const data = wordsStore.exportWords()
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `spellingbee-words-${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  MessagePlugin.success('导出成功')
}

onMounted(() => {
  wordsStore.init()
})
</script>

<style lang="scss" scoped>
.words-page {
  .page-header {
    margin-bottom: 2rem;

    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    p {
      color: var(--text-secondary);
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
  }
}

@media (max-width: 768px) {
  .words-page {
    .toolbar {
      flex-direction: column;

      .toolbar-left,
      .toolbar-right {
        width: 100%;
      }
    }

    .stats-row {
      justify-content: center;
    }
  }
}
</style>

