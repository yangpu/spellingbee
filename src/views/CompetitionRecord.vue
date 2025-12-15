<template>
  <div class="competition-record-page">
    <div class="page-header">
      <t-button variant="text" @click="$router.push('/stats')">
        <template #icon><t-icon name="chevron-left" /></template>
        返回统计
      </t-button>
      <h1>比赛记录详情</h1>
      <div class="header-placeholder"></div>
    </div>

    <div v-if="record" class="record-content">
      <!-- Summary Card -->
      <div class="summary-card">
        <div class="summary-header">
          <div class="record-badge" :class="getBadgeClass(record.accuracy)">
            {{ getBadgeText(record.accuracy) }}
          </div>
          <div class="record-date">{{ formatDate(record.created_at) }}</div>
        </div>
        <div class="summary-stats">
          <div class="stat-item">
            <span class="stat-value">{{ record.score }}</span>
            <span class="stat-label">得分</span>
          </div>
          <div class="stat-item">
            <span class="stat-value text-success">{{ record.correct_words }}</span>
            <span class="stat-label">正确</span>
          </div>
          <div class="stat-item">
            <span class="stat-value text-error">{{ record.total_words - record.correct_words }}</span>
            <span class="stat-label">错误</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ record.accuracy }}%</span>
            <span class="stat-label">正确率</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ formatDuration(record.duration) }}</span>
            <span class="stat-label">用时</span>
          </div>
        </div>
      </div>

      <!-- Words List -->
      <div class="words-section">
        <h2>单词列表</h2>
        
        <!-- 工具栏：过滤、搜索 -->
        <WordListToolbar
          v-model="wordsToolbar"
          :filter-options="wordsFilterOptions"
        />
        
        <div class="words-table-container" v-if="paginatedWordsList.length > 0">
          <t-table
            :data="paginatedWordsList"
            :columns="columns"
            row-key="index"
            hover
            stripe
          >
            <template #index="{ row }">
              <span class="word-index">{{ row._displayIndex }}</span>
            </template>
            <template #status="{ row }">
              <div class="status-cell">
                <t-icon 
                  :name="row.isCorrect ? 'check-circle-filled' : (row.isCorrect === false ? 'close-circle-filled' : 'help-circle')" 
                  :class="{ 
                    'status-correct': row.isCorrect === true, 
                    'status-wrong': row.isCorrect === false,
                    'status-unknown': row.isCorrect === null 
                  }"
                  size="20px"
                />
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
            <template #userAnswer="{ row }">
              <span v-if="row.isCorrect === false" class="user-answer-wrong">
                {{ row.userAnswer || '-' }}
              </span>
              <span v-else-if="row.isCorrect === true" class="user-answer-correct">
                {{ row.word }}
              </span>
              <span v-else class="user-answer-unknown">-</span>
            </template>
            <template #difficulty="{ row }">
              <t-tag v-if="row.difficulty" :theme="getDifficultyTheme(row.difficulty)" variant="light" size="small">
                {{ '⭐'.repeat(row.difficulty) }}
              </t-tag>
              <span v-else>-</span>
            </template>
          </t-table>
        </div>
        
        <!-- 空状态 -->
        <div class="empty-filter-result" v-else>
          <t-icon name="search" size="32px" />
          <span>没有找到匹配的单词</span>
        </div>
        
        <!-- 分页器 -->
        <div class="list-pagination" v-if="filteredWordsList.length > wordsToolbar.pageSize">
          <t-pagination
            :current="wordsToolbar.page"
            :page-size="wordsToolbar.pageSize"
            :total="filteredWordsList.length"
            :page-size-options="[10, 20, 50]"
            :show-jumper="true"
            size="small"
            @change="handleWordsPageChange"
          />
        </div>
      </div>

      <!-- Error Words Review -->
      <div class="error-words-section" v-if="errorWords.length > 0">
        <h2>错误单词复习 ({{ errorWords.length }} 词)</h2>
        
        <!-- 工具栏：搜索 -->
        <WordListToolbar
          v-model="errorWordsToolbar"
          :filter-options="[]"
          hide-filter
        />
        
        <div class="error-words-grid" v-if="paginatedErrorWords.length > 0">
          <div class="error-word-card" v-for="(item, idx) in paginatedErrorWords" :key="idx">
            <div class="error-word-header">
              <span class="word-index-badge">#{{ item._displayIndex }}</span>
              <t-button size="small" variant="text" @click="speakWord(item.word)">
                <template #icon><t-icon name="sound" /></template>
              </t-button>
            </div>
            <div class="error-word-content">
              <div class="correct-word">{{ item.word }}</div>
              <div class="pronunciation" v-if="item.pronunciation">{{ item.pronunciation }}</div>
              <div class="user-input">
                <span class="label">你的输入：</span>
                <span class="wrong-text">{{ item.userAnswer }}</span>
              </div>
              <div class="definition" v-if="item.definition_cn || item.definition">
                {{ item.definition_cn || item.definition }}
              </div>
            </div>
          </div>
        </div>
        
        <!-- 空状态 -->
        <div class="empty-filter-result" v-else>
          <t-icon name="search" size="32px" />
          <span>没有找到匹配的单词</span>
        </div>
        
        <!-- 分页器 -->
        <div class="list-pagination" v-if="filteredErrorWords.length > errorWordsToolbar.pageSize">
          <t-pagination
            :current="errorWordsToolbar.page"
            :page-size="errorWordsToolbar.pageSize"
            :total="filteredErrorWords.length"
            :page-size-options="[5, 10, 20]"
            size="small"
            @change="handleErrorWordsPageChange"
          />
        </div>
      </div>

      <!-- Actions -->
      <div class="actions">
        <t-button variant="outline" @click="$router.push('/stats')">
          返回统计
        </t-button>
        <t-button theme="primary" @click="$router.push('/competition')">
          再来一局
        </t-button>
      </div>
    </div>

    <!-- Not Found -->
    <div class="not-found" v-else>
      <t-icon name="info-circle" size="64px" />
      <h3>记录不存在</h3>
      <p>找不到该比赛记录</p>
      <t-button theme="primary" @click="$router.push('/stats')">
        返回统计
      </t-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useCompetitionStore } from '@/stores/competition'
import { useWordsStore } from '@/stores/words'
import { useSpeechStore } from '@/stores/speech'
import WordListToolbar from '@/components/WordListToolbar.vue'

const route = useRoute()
const competitionStore = useCompetitionStore()
const wordsStore = useWordsStore()
const speechStore = useSpeechStore()

const record = ref(null)

// 单词列表工具栏状态
const wordsToolbar = ref({
  filter: 'all',
  keyword: '',
  page: 1,
  pageSize: 10
})

// 错误单词工具栏状态
const errorWordsToolbar = ref({
  filter: 'all',
  keyword: '',
  page: 1,
  pageSize: 10
})

// Table columns
const columns = [
  { colKey: 'index', title: '序号', width: 70 },
  { colKey: 'status', title: '状态', width: 70 },
  { colKey: 'word', title: '单词', width: 180 },
  { colKey: 'userAnswer', title: '你的输入', width: 180 },
  { colKey: 'pronunciation', title: '音标', width: 140 },
  { colKey: 'definition_cn', title: '释义', ellipsis: true },
  { colKey: 'difficulty', title: '难度', width: 100 }
]

// Get word index in vocabulary
function getWordIndex(word) {
  const idx = wordsStore.words.findIndex(w => w.word.toLowerCase() === word.toLowerCase())
  return idx >= 0 ? idx + 1 : null
}

// Build words list with status
const wordsList = computed(() => {
  if (!record.value) return []
  
  const incorrectWordsMap = new Map()
  if (record.value.incorrect_words_detail) {
    // If we have detailed incorrect words with user answers
    record.value.incorrect_words_detail.forEach(item => {
      incorrectWordsMap.set(item.word.toLowerCase(), item.userAnswer)
    })
  } else if (record.value.incorrect_words) {
    // Just word names
    record.value.incorrect_words.forEach(word => {
      incorrectWordsMap.set(word.toLowerCase(), '[错误]')
    })
  }
  
  // Get all words from the record
  const allWords = []
  const processedWords = new Set()
  
  // Add correct words
  if (record.value.correct_words_list) {
    record.value.correct_words_list.forEach(word => {
      const lowerWord = word.toLowerCase()
      if (!processedWords.has(lowerWord)) {
        processedWords.add(lowerWord)
        const wordData = wordsStore.words.find(w => w.word.toLowerCase() === lowerWord) || {}
        allWords.push({
          word,
          isCorrect: true,
          userAnswer: word,
          index: getWordIndex(word),
          ...wordData
        })
      }
    })
  }
  
  // Add incorrect words
  if (record.value.incorrect_words) {
    record.value.incorrect_words.forEach(word => {
      const lowerWord = word.toLowerCase()
      if (!processedWords.has(lowerWord)) {
        processedWords.add(lowerWord)
        const wordData = wordsStore.words.find(w => w.word.toLowerCase() === lowerWord) || {}
        allWords.push({
          word,
          isCorrect: false,
          userAnswer: incorrectWordsMap.get(lowerWord) || '[错误]',
          index: getWordIndex(word),
          ...wordData
        })
      }
    })
  }
  
  // Sort by index (vocabulary order)
  allWords.sort((a, b) => {
    if (a.index === null && b.index === null) return 0
    if (a.index === null) return 1
    if (b.index === null) return -1
    return a.index - b.index
  })
  
  return allWords
})

// 单词列表过滤选项
const wordsFilterOptions = computed(() => {
  const correctCount = wordsList.value.filter(w => w.isCorrect === true).length
  const wrongCount = wordsList.value.filter(w => w.isCorrect === false).length
  
  return [
    { value: 'all', label: '全部', count: wordsList.value.length },
    { value: 'correct', label: '正确', icon: 'check-circle', type: 'correct', count: correctCount },
    { value: 'wrong', label: '错误', icon: 'close-circle', type: 'wrong', count: wrongCount }
  ]
})

// 过滤后的单词列表
const filteredWordsList = computed(() => {
  let words = [...wordsList.value]
  const { filter, keyword } = wordsToolbar.value
  
  // 按类型过滤
  if (filter === 'correct') {
    words = words.filter(w => w.isCorrect === true)
  } else if (filter === 'wrong') {
    words = words.filter(w => w.isCorrect === false)
  }
  
  // 按关键词搜索
  if (keyword.trim()) {
    const kw = keyword.trim().toLowerCase()
    words = words.filter(w => 
      w.word.toLowerCase().includes(kw) ||
      w.definition_cn?.toLowerCase().includes(kw) ||
      w.definition?.toLowerCase().includes(kw)
    )
  }
  
  return words.map((w, i) => ({ ...w, _displayIndex: i + 1 }))
})

// 分页后的单词列表
const paginatedWordsList = computed(() => {
  const { page, pageSize } = wordsToolbar.value
  const start = (page - 1) * pageSize
  return filteredWordsList.value.slice(start, start + pageSize)
})

// Error words for review
const errorWords = computed(() => {
  return wordsList.value.filter(w => w.isCorrect === false)
})

// 过滤后的错误单词
const filteredErrorWords = computed(() => {
  let words = [...errorWords.value]
  const { keyword } = errorWordsToolbar.value
  
  // 按关键词搜索
  if (keyword.trim()) {
    const kw = keyword.trim().toLowerCase()
    words = words.filter(w => 
      w.word.toLowerCase().includes(kw) ||
      w.definition_cn?.toLowerCase().includes(kw) ||
      w.definition?.toLowerCase().includes(kw)
    )
  }
  
  return words.map((w, i) => ({ ...w, _displayIndex: i + 1 }))
})

// 分页后的错误单词
const paginatedErrorWords = computed(() => {
  const { page, pageSize } = errorWordsToolbar.value
  const start = (page - 1) * pageSize
  return filteredErrorWords.value.slice(start, start + pageSize)
})

// 单词列表分页处理
function handleWordsPageChange(pageInfo) {
  wordsToolbar.value.page = pageInfo.current
  wordsToolbar.value.pageSize = pageInfo.pageSize
}

// 错误单词分页处理
function handleErrorWordsPageChange(pageInfo) {
  errorWordsToolbar.value.page = pageInfo.current
  errorWordsToolbar.value.pageSize = pageInfo.pageSize
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`
}

function getBadgeClass(accuracy) {
  if (accuracy >= 90) return 'badge-gold'
  if (accuracy >= 70) return 'badge-silver'
  if (accuracy >= 50) return 'badge-bronze'
  return 'badge-iron'
}

function getBadgeText(accuracy) {
  if (accuracy >= 90) return '优秀'
  if (accuracy >= 70) return '良好'
  if (accuracy >= 50) return '及格'
  return '加油'
}

function getDifficultyTheme(level) {
  const themes = { 1: 'success', 2: 'primary', 3: 'warning', 4: 'danger', 5: 'danger' }
  return themes[level] || 'default'
}

function speakWord(word) {
  speechStore.speakWord(word)
}

onMounted(async () => {
  await wordsStore.init()
  await competitionStore.loadRecords()
  
  const recordId = route.params.id
  record.value = competitionStore.records.find(r => r.id === recordId)
})
</script>

<style lang="scss" scoped>
.competition-record-page {
  max-width: 1000px;
  margin: 0 auto;

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;

    h1 {
      font-size: 1.75rem;
    }

    .header-placeholder {
      width: 100px;
    }
  }

  .summary-card {
    background: var(--bg-card);
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    box-shadow: var(--shadow-sm);

    .summary-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;

      .record-date {
        color: var(--text-secondary);
        font-size: 0.9rem;
      }

      .record-badge {
        padding: 0.5rem 1rem;
        border-radius: 20px;
        font-size: 0.9rem;
        font-weight: 600;

        &.badge-gold {
          background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
          color: white;
        }

        &.badge-silver {
          background: linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%);
          color: white;
        }

        &.badge-bronze {
          background: linear-gradient(135deg, #CD7F32 0%, #B87333 100%);
          color: white;
        }

        &.badge-iron {
          background: var(--charcoal-200);
          color: var(--charcoal-600);
        }
      }
    }

    .summary-stats {
      display: flex;
      justify-content: space-around;
      flex-wrap: wrap;
      gap: 1rem;

      .stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 80px;

        .stat-value {
          font-size: 1.75rem;
          font-weight: 700;
          font-family: Georgia, 'Times New Roman', serif;
          color: var(--charcoal-800);

          &.text-success { color: var(--success); }
          &.text-error { color: var(--error); }
        }

        .stat-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
      }
    }
  }

  .words-section {
    margin-bottom: 2rem;

    h2 {
      font-size: 1.25rem;
      margin-bottom: 1rem;
    }

    .words-table-container {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 1rem;
      box-shadow: var(--shadow-sm);
      margin-top: 1rem;
    }
    
    .empty-filter-result {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2rem;
      color: var(--text-muted);
      background: var(--bg-card);
      border-radius: 12px;
      margin-top: 1rem;
    }
    
    .list-pagination {
      display: flex;
      justify-content: center;
      padding-top: 1rem;
      margin-top: 1rem;
      border-top: 1px solid var(--charcoal-100);
    }
  }

  .word-index {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .status-cell {
    display: flex;
    align-items: center;
    justify-content: center;

    .status-correct {
      color: var(--success);
    }

    .status-wrong {
      color: var(--error);
    }

    .status-unknown {
      color: var(--text-muted);
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

  .user-answer-wrong {
    color: var(--error);
    text-decoration: line-through;
  }

  .user-answer-correct {
    color: var(--success);
  }

  .user-answer-unknown {
    color: var(--text-muted);
  }

  .error-words-section {
    margin-bottom: 2rem;

    h2 {
      font-size: 1.25rem;
      margin-bottom: 1rem;
    }
    
    .empty-filter-result {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2rem;
      color: var(--text-muted);
      background: var(--bg-card);
      border-radius: 12px;
      margin-top: 1rem;
    }
    
    .list-pagination {
      display: flex;
      justify-content: center;
      padding-top: 1rem;
      margin-top: 1rem;
      border-top: 1px solid var(--charcoal-100);
    }

    .error-words-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }

    .error-word-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1rem;
      border-left: 4px solid var(--error);
      box-shadow: var(--shadow-sm);

      .error-word-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;

        .word-index-badge {
          background: var(--charcoal-100);
          color: var(--charcoal-600);
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.8rem;
        }
      }

      .error-word-content {
        .correct-word {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--charcoal-800);
          margin-bottom: 0.25rem;
        }

        .pronunciation {
          color: var(--honey-600);
          font-size: 0.9rem;
          margin-bottom: 0.5rem;
        }

        .user-input {
          margin-bottom: 0.5rem;
          font-size: 0.9rem;

          .label {
            color: var(--text-secondary);
          }

          .wrong-text {
            color: var(--error);
            text-decoration: line-through;
            margin-left: 0.25rem;
          }
        }

        .definition {
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.4;
        }
      }
    }
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-top: 2rem;
  }

  .not-found {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-secondary);

    .t-icon {
      color: var(--honey-400);
      margin-bottom: 1rem;
    }

    h3 {
      margin-bottom: 0.5rem;
      color: var(--text-primary);
    }

    p {
      margin-bottom: 1.5rem;
    }
  }
}

@media (max-width: 768px) {
  .competition-record-page {
    .page-header {
      flex-direction: column;
      gap: 1rem;
      text-align: center;

      .header-placeholder {
        display: none;
      }
    }

    .summary-card .summary-stats {
      .stat-item .stat-value {
        font-size: 1.5rem;
      }
    }

    .error-words-section .error-words-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
