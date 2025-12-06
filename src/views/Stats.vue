<template>
  <div class="stats-page">
    <div class="page-header">
      <h1>学习统计</h1>
      <p>追踪你的学习进度和比赛成绩</p>
    </div>

    <!-- Learning Stats -->
    <div class="learning-section" v-if="learningStats.totalPracticed > 0">
      <h2>学习进度</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon learning">
            <t-icon name="book-open" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ learningStats.totalPracticed }}</span>
            <span class="stat-label">总练习次数</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon success">
            <t-icon name="check-circle" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ learningStats.accuracy }}%</span>
            <span class="stat-label">学习正确率</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">
            <t-icon name="layers" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ totalLearned }}</span>
            <span class="stat-label">已学单词</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon highlight">
            <t-icon name="star" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ masteredCount }}</span>
            <span class="stat-label">已掌握</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon warning">
            <t-icon name="time" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ reviewCount }}</span>
            <span class="stat-label">待复习</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">
            <t-icon name="calendar" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ learningStats.todayPracticed }}</span>
            <span class="stat-label">今日练习</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Competition Overview Stats -->
    <div class="overview-section">
      <h2>比赛统计</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">
            <t-icon name="play-circle" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.totalGames }}</span>
            <span class="stat-label">比赛场次</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon highlight">
            <t-icon name="star" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.bestScore }}</span>
            <span class="stat-label">最高分数</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">
            <t-icon name="chart-bar" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.averageScore }}</span>
            <span class="stat-label">平均分数</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">
            <t-icon name="check-circle" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.totalCorrect }}</span>
            <span class="stat-label">正确单词</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon success">
            <t-icon name="chart-pie" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.bestAccuracy }}%</span>
            <span class="stat-label">最高正确率</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">
            <t-icon name="chart-line" size="32px" />
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.averageAccuracy }}%</span>
            <span class="stat-label">平均正确率</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Records -->
    <div class="records-section">
      <div class="section-header">
        <h2>比赛记录</h2>
        <t-button variant="text" @click="clearRecords" v-if="records.length > 0">
          清空记录
        </t-button>
      </div>

      <div class="records-list" v-if="records.length > 0">
        <div class="record-card" v-for="record in records" :key="record.id" @click="viewRecordDetail(record.id)">
          <div class="record-date">
            {{ formatDate(record.created_at) }}
          </div>
          <div class="record-content">
            <div class="record-score">
              <span class="score-value">{{ record.score }}</span>
              <span class="score-label">分</span>
            </div>
            <div class="record-details">
              <div class="detail-item">
                <t-icon name="check-circle" class="text-success" />
                <span>{{ record.correct_words }}/{{ record.total_words }} 正确</span>
              </div>
              <div class="detail-item">
                <t-icon name="chart-pie" />
                <span>{{ record.accuracy }}% 正确率</span>
              </div>
              <div class="detail-item">
                <t-icon name="time" />
                <span>{{ formatDuration(record.duration) }}</span>
              </div>
            </div>
          </div>
          <div class="record-badge" :class="getBadgeClass(record.accuracy)">
            {{ getBadgeText(record.accuracy) }}
          </div>
          <t-icon name="chevron-right" class="record-arrow" />
        </div>
      </div>

      <div class="empty-state" v-else>
        <t-icon name="chart-bubble" size="64px" />
        <h3>暂无比赛记录</h3>
        <p>完成一场比赛后，你的成绩将显示在这里</p>
        <t-button theme="primary" @click="$router.push('/competition')">
          开始比赛
        </t-button>
      </div>
    </div>

    <!-- Achievement Section -->
    <div class="achievements-section" v-if="stats.totalGames > 0">
      <h2>成就徽章</h2>
      <div class="achievements-grid">
        <div class="achievement" :class="{ unlocked: stats.totalGames >= 1 }">
          <div class="achievement-icon">🎯</div>
          <div class="achievement-name">初次挑战</div>
          <div class="achievement-desc">完成第一场比赛</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.totalGames >= 10 }">
          <div class="achievement-icon">🔥</div>
          <div class="achievement-name">勤奋练习</div>
          <div class="achievement-desc">完成10场比赛</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.bestAccuracy >= 80 }">
          <div class="achievement-icon">⭐</div>
          <div class="achievement-name">拼写高手</div>
          <div class="achievement-desc">单场正确率达到80%</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.bestAccuracy >= 100 }">
          <div class="achievement-icon">🏆</div>
          <div class="achievement-name">完美无瑕</div>
          <div class="achievement-desc">单场正确率达到100%</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.bestScore >= 200 }">
          <div class="achievement-icon">💎</div>
          <div class="achievement-name">高分选手</div>
          <div class="achievement-desc">单场得分超过200</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.totalCorrect >= 100 }">
          <div class="achievement-icon">📚</div>
          <div class="achievement-name">词汇大师</div>
          <div class="achievement-desc">累计正确拼写100个单词</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { useCompetitionStore } from '@/stores/competition'
import { useLearningStore } from '@/stores/learning'

const router = useRouter()
const competitionStore = useCompetitionStore()
const learningStore = useLearningStore()

const stats = computed(() => competitionStore.stats)
const records = computed(() => competitionStore.records)

// Learning stats
const learningStats = computed(() => learningStore.stats)
const totalLearned = computed(() => learningStore.totalLearned)
const masteredCount = computed(() => learningStore.masteredWords.length)
const reviewCount = computed(() => learningStore.wordsToReview.length)

function formatDate(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now - date
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
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

function viewRecordDetail(recordId) {
  router.push(`/stats/record/${recordId}`)
}

function clearRecords() {
  const dialog = DialogPlugin.confirm({
    header: '确认清空',
    body: '确定要清空所有比赛记录吗？此操作不可恢复。',
    confirmBtn: { content: '确认清空', theme: 'danger' },
    onConfirm: () => {
      localStorage.removeItem('spellingbee_records')
      competitionStore.records.splice(0)
      MessagePlugin.success('记录已清空')
      dialog.destroy()
    },
    onClose: () => {
      dialog.destroy()
    }
  })
}

onMounted(() => {
  competitionStore.loadRecords()
})
</script>

<style lang="scss" scoped>
.stats-page {
  max-width: 1000px;
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
  }

  .learning-section {
    margin-bottom: 3rem;

    h2 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
    }

    .stat-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem;
      background: var(--bg-card);
      border-radius: 16px;
      transition: all 0.3s;

      &:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .stat-icon {
        width: 56px;
        height: 56px;
        border-radius: 12px;
        background: var(--honey-100);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--honey-600);

        &.highlight {
          background: linear-gradient(135deg, var(--honey-400) 0%, var(--honey-500) 100%);
          color: white;
        }

        &.success {
          background: #D1FAE5;
          color: var(--success);
        }

        &.learning {
          background: #DBEAFE;
          color: #3B82F6;
        }

        &.warning {
          background: #FEF3C7;
          color: #F59E0B;
        }
      }

      .stat-info {
        display: flex;
        flex-direction: column;

        .stat-value {
          font-size: 1.75rem;
          font-weight: 700;
          font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
          color: var(--charcoal-900);
        }

        .stat-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
      }
    }
  }

  .overview-section {
    margin-bottom: 3rem;

    h2 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
    }

    .stat-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem;
      background: var(--bg-card);
      border-radius: 16px;
      transition: all 0.3s;

      &:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .stat-icon {
        width: 56px;
        height: 56px;
        border-radius: 12px;
        background: var(--honey-100);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--honey-600);

        &.highlight {
          background: linear-gradient(135deg, var(--honey-400) 0%, var(--honey-500) 100%);
          color: white;
        }

        &.success {
          background: #D1FAE5;
          color: var(--success);
        }

        &.learning {
          background: #DBEAFE;
          color: #3B82F6;
        }

        &.warning {
          background: #FEF3C7;
          color: #F59E0B;
        }
      }

      .stat-info {
        display: flex;
        flex-direction: column;

        .stat-value {
          font-size: 1.75rem;
          font-weight: 700;
          font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
          color: var(--charcoal-900);
        }

        .stat-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
      }
    }
  }

  .records-section {
    margin-bottom: 3rem;

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;

      h2 {
        font-size: 1.5rem;
      }
    }

    .records-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .record-card {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      padding: 1.25rem 1.5rem;
      background: var(--bg-card);
      border-radius: 16px;
      transition: all 0.3s;
      cursor: pointer;

      &:hover {
        box-shadow: var(--shadow-md);
        transform: translateX(4px);
      }

      .record-arrow {
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .record-date {
        font-size: 0.85rem;
        color: var(--text-muted);
        min-width: 100px;
      }

      .record-content {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 2rem;
      }

      .record-score {
        display: flex;
        align-items: baseline;
        gap: 0.25rem;

        .score-value {
          font-size: 2rem;
          font-weight: 700;
          font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
          color: var(--honey-600);
        }

        .score-label {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
      }

      .record-details {
        display: flex;
        gap: 1.5rem;
        flex-wrap: wrap;

        .detail-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: var(--text-secondary);

          .text-success {
            color: var(--success);
          }
        }
      }

      .record-badge {
        padding: 0.5rem 1rem;
        border-radius: 20px;
        font-size: 0.85rem;
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

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      background: var(--bg-card);
      border-radius: 16px;
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

  .achievements-section {
    h2 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .achievements-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
    }

    .achievement {
      padding: 1.5rem;
      background: var(--bg-card);
      border-radius: 16px;
      text-align: center;
      opacity: 0.5;
      filter: grayscale(100%);
      transition: all 0.3s;

      &.unlocked {
        opacity: 1;
        filter: none;

        &:hover {
          transform: translateY(-4px);
          box-shadow: var(--shadow-md);
        }
      }

      .achievement-icon {
        font-size: 2.5rem;
        margin-bottom: 0.75rem;
      }

      .achievement-name {
        font-weight: 600;
        margin-bottom: 0.25rem;
        color: var(--charcoal-900);
      }

      .achievement-desc {
        font-size: 0.85rem;
        color: var(--text-secondary);
      }
    }
  }
}

@media (max-width: 768px) {
  .stats-page {
    .overview-section .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .records-section .record-card {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;

      .record-content {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.75rem;
      }

      .record-badge {
        align-self: flex-end;
      }
    }

    .achievements-section .achievements-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
}
</style>

