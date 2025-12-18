<template>
  <div class="learning-manager-page">
    <div class="page-header">
      <div class="header-left">
        <t-button variant="text" @click="$router.push('/learn')">
          <template #icon><t-icon name="chevron-left" /></template>
          返回学习
        </t-button>
      </div>
      <div class="header-center">
        <h1>学习管理</h1>
        <p>查看词库学习进度和统计数据</p>
        <!-- 当前词典信息 -->
        <div class="current-dictionary" v-if="currentDictionaryInfo" @click="goToDictionary">
          <t-icon name="book" />
          <span>{{ currentDictionaryInfo.name }}</span>
          <t-icon name="chevron-right" size="14px" />
        </div>
      </div>
      <div class="header-right"></div>
    </div>

    <!-- Stats Summary -->
    <div class="stats-cards">
      <div class="stat-card" :class="{ active: filterStatus === null }" @click="setFilter(null)">
        <div class="stat-icon total">
          <t-icon name="books" />
        </div>
        <div class="stat-content">
          <span class="stat-value">{{ wordsStore.wordCount }}</span>
          <span class="stat-label">词库总数</span>
        </div>
      </div>
      <div class="stat-card" :class="{ active: filterStatus === 'mastered' }" @click="setFilter('mastered')">
        <div class="stat-icon mastered">
          <t-icon name="check-circle" />
        </div>
        <div class="stat-content">
          <span class="stat-value text-success">{{ currentMasteredCount }}</span>
          <span class="stat-label">已掌握</span>
        </div>
      </div>
      <div class="stat-card" :class="{ active: filterStatus === 'learning' }" @click="setFilter('learning')">
        <div class="stat-icon learning">
          <t-icon name="time" />
        </div>
        <div class="stat-content">
          <span class="stat-value text-warning">{{ currentLearningCount }}</span>
          <span class="stat-label">学习中</span>
        </div>
      </div>
      <div class="stat-card" :class="{ active: filterStatus === 'not_started' }" @click="setFilter('not_started')">
        <div class="stat-icon review">
          <t-icon name="browse" />
        </div>
        <div class="stat-content">
          <span class="stat-value text-info">{{ notStartedCount }}</span>
          <span class="stat-label">未学习</span>
        </div>
      </div>
    </div>

    <!-- Progress Bar -->
    <div class="progress-section">
      <div class="progress-header">
        <span>学习进度</span>
        <span>{{ progressPercentage }}%</span>
      </div>
      <t-progress :percentage="progressPercentage" theme="plump" />
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <t-input v-model="searchQuery" placeholder="搜索单词..." clearable class="search-input">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <t-select v-model="filterStatus" placeholder="学习状态" clearable class="filter-select">
          <t-option value="mastered" label="已掌握" />
          <t-option value="learning" label="学习中" />
          <t-option value="not_started" label="未学习" />
        </t-select>
        <t-select v-model="filterDifficulty" placeholder="难度筛选" clearable class="filter-select">
          <t-option :value="1" label="⭐ 简单" />
          <t-option :value="2" label="⭐⭐ 较易" />
          <t-option :value="3" label="⭐⭐⭐ 中等" />
          <t-option :value="4" label="⭐⭐⭐⭐ 较难" />
          <t-option :value="5" label="⭐⭐⭐⭐⭐ 困难" />
        </t-select>
      </div>
      <div class="toolbar-right">
        <t-button variant="outline" @click="exportData">
          <template #icon><t-icon name="download" /></template>
          导出数据
        </t-button>
        <t-button variant="outline" theme="danger" @click="confirmClearRecords">
          <template #icon><t-icon name="delete" /></template>
          清空记录
        </t-button>
      </div>
    </div>

    <!-- Words Table -->
    <div class="table-container">
      <t-table :data="filteredWords" :columns="columns" :pagination="pagination" row-key="id" hover stripe
        @page-change="handlePageChange">
        <template #index="{ row }">
          <span class="word-index">{{ row.vocabIndex }}</span>
        </template>
        <template #status="{ row }">
          <div class="status-cell">
            <t-icon :name="getStatusIcon(row.word).icon" :class="getStatusIcon(row.word).class" size="18px" />
          </div>
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
          <t-tag :theme="getDifficultyTheme(row.difficulty)" variant="light" size="small">
            {{ '⭐'.repeat(row.difficulty) }}
          </t-tag>
        </template>
        <template #learnMastered="{ row }">
          <span :class="{ 'text-success': getWordStats(row.word).learnMastered > 0 }">
            {{ getWordStats(row.word).learnMastered }}
          </span>
        </template>
        <template #learnReview="{ row }">
          <span :class="{ 'text-warning': getWordStats(row.word).learnReview > 0 }">
            {{ getWordStats(row.word).learnReview }}
          </span>
        </template>
        <template #competitionCorrect="{ row }">
          <span :class="{ 'text-success': getWordStats(row.word).competitionCorrect > 0 }">
            {{ getWordStats(row.word).competitionCorrect }}
          </span>
        </template>
        <template #competitionWrong="{ row }">
          <span :class="{ 'text-error': getWordStats(row.word).competitionWrong > 0 }">
            {{ getWordStats(row.word).competitionWrong }}
          </span>
        </template>
      </t-table>
    </div>

    <!-- Empty State -->
    <div class="empty-state" v-if="wordsStore.wordCount === 0">
      <t-icon name="folder-open" size="64px" />
      <h3>词库为空</h3>
      <p>请先添加一些单词到词库</p>
      <t-button theme="primary" @click="$router.push('/dictionaries')">
        前往词库
      </t-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { useWordsStore } from '@/stores/words'
import { useDictionaryStore } from '@/stores/dictionary'
import { useLearningStore } from '@/stores/learning'
import { useCompetitionStore } from '@/stores/competition'
import { useSpeechStore } from '@/stores/speech'

const router = useRouter()

const wordsStore = useWordsStore()
const dictionaryStore = useDictionaryStore()
const learningStore = useLearningStore()
const competitionStore = useCompetitionStore()
const speechStore = useSpeechStore()

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

// 跳转到词典详情页
function goToDictionary() {
  const dictId = currentDictionaryInfo.value?.id
  if (dictId) {
    router.push(`/dictionaries/${dictId}`)
  }
}

// Filter state
const searchQuery = ref('')
const filterStatus = ref(null)
const filterDifficulty = ref(null)
const pagination = reactive({
  current: 1,
  pageSize: 20,
  total: 0,
  showJumper: true,
  showPageSize: true,
  pageSizeOptions: [10, 20, 50, 100]
})

// Table columns
const columns = [
  { colKey: 'index', title: '序号', width: 70 },
  { colKey: 'status', title: '状态', width: 70 },
  { colKey: 'word', title: '单词', width: 150 },
  { colKey: 'pronunciation', title: '音标', width: 130 },
  { colKey: 'definition_cn', title: '中文释义', ellipsis: true },
  { colKey: 'difficulty', title: '难度', width: 120 },
  { colKey: 'learnMastered', title: '掌握次数', width: 100 },
  { colKey: 'learnReview', title: '复习次数', width: 100 },
  { colKey: 'competitionCorrect', title: '比赛正确', width: 100 },
  { colKey: 'competitionWrong', title: '比赛错误', width: 100 }
]

// 当前词典的单词列表
const currentWords = computed(() => wordsStore.activeWords)

// 当前词典中已掌握的单词数量
const currentMasteredCount = computed(() => {
  return currentWords.value.filter(w => {
    const progress = learningStore.getWordProgress(w.word.toLowerCase())
    return progress && progress.mastery_level >= 2
  }).length
})

// 当前词典中学习中的单词数量
const currentLearningCount = computed(() => {
  return currentWords.value.filter(w => {
    const progress = learningStore.getWordProgress(w.word.toLowerCase())
    return progress && progress.mastery_level < 2
  }).length
})

// 未学习单词数量
const notStartedCount = computed(() => {
  return currentWords.value.filter(w => !learningStore.getWordProgress(w.word.toLowerCase())).length
})

// 设置筛选
function setFilter(status) {
  filterStatus.value = status
  pagination.current = 1
}

// Progress percentage
const progressPercentage = computed(() => {
  if (wordsStore.wordCount === 0) return 0
  return Math.round((currentMasteredCount.value / wordsStore.wordCount) * 100)
})

// Get word learning stats
function getWordStats(word) {
  const lowerWord = word.toLowerCase()

  let learnMastered = 0
  let learnReview = 0
  learningStore.learningRecords.forEach(record => {
    if (record.word.toLowerCase() === lowerWord && record.study_mode === 'learn') {
      if (record.is_correct) {
        learnMastered++
      } else {
        learnReview++
      }
    }
  })

  let competitionCorrect = 0
  let competitionWrong = 0

  learningStore.learningRecords.forEach(record => {
    if (record.word.toLowerCase() === lowerWord && record.study_mode === 'competition') {
      if (record.is_correct) {
        competitionCorrect++
      } else {
        competitionWrong++
      }
    }
  })

  if (competitionCorrect === 0 && competitionWrong === 0) {
    competitionStore.records.forEach(record => {
      const incorrectWords = (record.incorrect_words || []).map(w => w.toLowerCase())
      if (incorrectWords.includes(lowerWord)) {
        competitionWrong++
      }
    })
  }

  return {
    learnMastered,
    learnReview,
    competitionCorrect,
    competitionWrong
  }
}

// Get status icon and class
function getStatusIcon(word) {
  const lowerWord = word.toLowerCase()
  const progress = learningStore.getWordProgress(lowerWord)
  const stats = getWordStats(word)

  // 检查比赛状态
  if (stats.competitionWrong > 0 && stats.competitionCorrect === 0) {
    return { icon: 'close-circle-filled', class: 'status-competition-wrong' }
  }
  if (stats.competitionCorrect > 0 && stats.competitionWrong === 0) {
    return { icon: 'check-circle-filled', class: 'status-competition-correct' }
  }
  if (stats.competitionCorrect > 0 && stats.competitionWrong > 0) {
    return { icon: 'error-circle-filled', class: 'status-competition-mixed' }
  }

  // 检查学习状态
  if (!progress) {
    return { icon: 'browse', class: 'status-not-started' }
  }
  if (progress.mastery_level >= 2) {
    return { icon: 'check-circle-filled', class: 'status-mastered' }
  }
  return { icon: 'time-filled', class: 'status-learning' }
}

// Get difficulty theme
function getDifficultyTheme(level) {
  const themes = { 1: 'success', 2: 'primary', 3: 'warning', 4: 'danger', 5: 'danger' }
  return themes[level] || 'default'
}

// Get status label for export
function getStatusLabel(word) {
  const lowerWord = word.toLowerCase()
  const progress = learningStore.getWordProgress(lowerWord)
  const stats = getWordStats(word)

  if (stats.competitionWrong > 0 && stats.competitionCorrect === 0) {
    return '比赛错误'
  }
  if (stats.competitionCorrect > 0 && stats.competitionWrong === 0) {
    return '比赛正确'
  }
  if (stats.competitionCorrect > 0 && stats.competitionWrong > 0) {
    return '比赛混合'
  }
  if (!progress) {
    return '未学习'
  }
  if (progress.mastery_level >= 2) {
    return '已掌握'
  }
  return '学习中'
}

// Speak word
function speakWord(word) {
  speechStore.speakWord(word)
}

// Filtered words - 按词库顺序显示
const filteredWords = computed(() => {
  let result = [...currentWords.value]

  // 添加索引
  result = result.map((w, idx) => ({ ...w, vocabIndex: idx + 1 }))

  // Search filter
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(w =>
      w.word.toLowerCase().includes(q) ||
      (w.definition_cn && w.definition_cn.includes(q)) ||
      w.definition.toLowerCase().includes(q)
    )
  }

  // Status filter
  if (filterStatus.value) {
    result = result.filter(w => {
      const progress = learningStore.getWordProgress(w.word.toLowerCase())
      switch (filterStatus.value) {
        case 'mastered':
          return progress && progress.mastery_level >= 2
        case 'learning':
          return progress && progress.mastery_level < 2
        case 'not_started':
          return !progress
        default:
          return true
      }
    })
  }

  // Difficulty filter
  if (filterDifficulty.value) {
    result = result.filter(w => w.difficulty === filterDifficulty.value)
  }

  // 不排序，保持词库原始顺序

  pagination.total = result.length

  // Paginate
  const start = (pagination.current - 1) * pagination.pageSize
  const end = start + pagination.pageSize
  return result.slice(start, end)
})

// Handle page change
function handlePageChange(pageInfo) {
  pagination.current = pageInfo.current
  pagination.pageSize = pageInfo.pageSize
}

// Export data
function exportData() {
  const data = currentWords.value.map(w => {
    const stats = getWordStats(w.word)
    return {
      单词: w.word,
      音标: w.pronunciation,
      中文释义: w.definition_cn,
      英文释义: w.definition,
      难度: w.difficulty,
      掌握次数: stats.learnMastered,
      复习次数: stats.learnReview,
      比赛正确: stats.competitionCorrect,
      比赛错误: stats.competitionWrong,
      状态: getStatusLabel(w.word)
    }
  })

  const csv = [
    Object.keys(data[0]).join(','),
    ...data.map(row => Object.values(row).map(v => `"${v || ''}"`).join(','))
  ].join('\n')

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `学习记录_${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)

  MessagePlugin.success('导出成功')
}

// 清空学习记录
function confirmClearRecords() {
  const dialog = DialogPlugin.confirm({
    header: '确认清空',
    body: '确定要清空所有学习记录吗？此操作将清除学习进度、掌握状态等数据，且不可恢复。',
    confirmBtn: { content: '确认清空', theme: 'danger' },
    onConfirm: async () => {
      try {
        await learningStore.clearAllData()
        MessagePlugin.success('学习记录已清空')
      } catch (error) {
        MessagePlugin.error('清空失败，请重试')
      }
      dialog.destroy()
    },
    onClose: () => {
      dialog.destroy()
    }
  })
}

onMounted(() => {
  wordsStore.init()
  learningStore.init()
  competitionStore.loadRecords()
})
</script>

<style lang="scss" scoped>
.learning-manager-page {
  max-width: 1400px;
  margin: 0 auto;

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 2rem;

    .header-left {
      flex: 0 0 150px;
    }

    .header-right {
      flex: 0 0 150px;
      min-width: 150px;
    }

    .header-center {
      text-align: center;
      flex: 1;
      width: 100%;

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
  }

  .stats-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.5rem;
    margin-bottom: 2rem;

    .stat-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.5rem;
      background: var(--bg-card);
      border-radius: 16px;
      box-shadow: var(--shadow-sm);
      transition: transform 0.2s, box-shadow 0.2s;
      cursor: pointer;
      border: 2px solid transparent;

      &:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      &.active {
        border-color: var(--honey-500);
        background: var(--honey-50);
      }

      .stat-icon {
        width: 56px;
        height: 56px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;

        &.total {
          background: var(--honey-100);
          color: var(--honey-600);
        }

        &.mastered {
          background: rgba(34, 197, 94, 0.1);
          color: var(--success);
        }

        &.learning {
          background: rgba(245, 158, 11, 0.1);
          color: var(--warning);
        }

        &.review {
          background: rgba(59, 130, 246, 0.1);
          color: var(--primary);
        }
      }

      .stat-content {
        display: flex;
        flex-direction: column;

        .stat-value {
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--charcoal-800);

          &.text-success {
            color: var(--success);
          }

          &.text-warning {
            color: var(--warning);
          }

          &.text-info {
            color: var(--primary);
          }
        }

        .stat-label {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
      }
    }
  }

  .progress-section {
    padding: 1.5rem;
    background: var(--bg-card);
    border-radius: 16px;
    margin-bottom: 2rem;

    .progress-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.75rem;
      font-weight: 500;
      color: var(--charcoal-700);
    }
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;

    .toolbar-left {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      flex: 1;

      .search-input {
        width: 250px;
      }

      .filter-select {
        width: 150px;
      }
    }

    .toolbar-right {
      display: flex;
      gap: 0.5rem;
    }
  }

  .table-container {
    background: var(--bg-card);
    border-radius: 16px;
    padding: 1rem;
    box-shadow: var(--shadow-sm);
  }

  .word-index {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .status-cell {
    display: flex;
    align-items: center;
    justify-content: center;

    .status-mastered {
      color: var(--success);
    }

    .status-learning {
      color: var(--warning);
    }

    .status-not-started {
      color: var(--text-muted);
    }

    .status-competition-correct {
      color: var(--success);
    }

    .status-competition-wrong {
      color: var(--error);
    }

    .status-competition-mixed {
      color: var(--warning);
    }
  }

  .word-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    .word-text {
      font-weight: 600;
      color: var(--charcoal-800);
    }
  }

  .text-success {
    color: var(--success);
    font-weight: 600;
  }

  .text-warning {
    color: var(--warning);
    font-weight: 600;
  }

  .text-error {
    color: var(--error);
    font-weight: 600;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-secondary);

    h3 {
      margin: 1rem 0 0.5rem;
    }

    p {
      margin-bottom: 1.5rem;
    }
  }
}

// Tablet
@media (max-width: 1024px) {
  .learning-manager-page {
    .stats-cards {
      grid-template-columns: repeat(2, 1fr);
    }

    .toolbar {
      .toolbar-left {
        .search-input {
          width: 200px;
        }

        .filter-select {
          width: 130px;
        }
      }
    }
  }
}

// Mobile
@media (max-width: 768px) {
  .learning-manager-page {
    .page-header {
      flex-direction: column;
      gap: 1rem;

      .header-left,
      .header-right {
        flex: none;
      }

      .header-left {
        align-self: flex-start;
      }
    }

    .stats-cards {
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;

      .stat-card {
        padding: 1rem;
        flex-direction: column;
        text-align: center;

        .stat-icon {
          width: 48px;
          height: 48px;
          font-size: 1.25rem;
        }

        .stat-content {
          align-items: center;

          .stat-value {
            font-size: 1.5rem;
          }
        }
      }
    }

    .toolbar {
      flex-direction: column;
      align-items: stretch;

      .toolbar-left {
        flex-direction: column;

        .search-input,
        .filter-select {
          width: 100%;
        }
      }

      .toolbar-right {
        justify-content: flex-end;
      }
    }

    .table-container {
      padding: 0.5rem;
      overflow-x: auto;
    }

    // 隐藏分页跳转控件
    :deep(.t-pagination__jump) {
      display: none;
    }
  }
}

// Small mobile
@media (max-width: 480px) {
  .learning-manager-page {
    .stats-cards {
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;

      .stat-card {
        padding: 0.75rem;

        .stat-icon {
          width: 40px;
          height: 40px;
          font-size: 1rem;
        }

        .stat-content .stat-value {
          font-size: 1.25rem;
        }
      }
    }
  }
}
</style>
