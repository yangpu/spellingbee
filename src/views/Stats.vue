<template>
  <div class="stats-page">
    <div class="page-header">
      <h1>学习统计</h1>
      <p>追踪你的学习进度和比赛成绩</p>
    </div>

    <!-- 用户等级卡片 -->
    <div class="level-card">
      <div class="level-header">
        <div class="current-level-showcase" :class="currentLevel.class">
          <div class="showcase-badge">
            <span class="badge-icon">{{ currentLevel.icon }}</span>
          </div>
          <div class="showcase-info">
            <span class="showcase-name">{{ currentLevel.name }}</span>
            <span class="showcase-title">当前等级</span>
          </div>
        </div>
        <div class="level-stats">
          <div class="total-points">
            <span class="points-value">{{ totalPoints }}</span>
            <span class="points-label">总积分</span>
          </div>
          <div class="level-progress">
            <div class="progress-text">
              <span v-if="pointsToNextLevel > 0">距离 <strong>{{ nextLevel.name }}</strong> 还差 <strong>{{ pointsToNextLevel }}</strong> 积分</span>
              <span v-else class="max-level">🎉 已达最高等级！</span>
            </div>
            <t-progress 
              :percentage="levelProgress" 
              :color="currentLevel.color"
              :track-color="'var(--charcoal-100)'"
            />
          </div>
        </div>
      </div>
      
      <!-- 等级徽章展示栏 -->
      <div class="levels-showcase">
        <div 
          v-for="(level, index) in levels" 
          :key="level.name"
          class="level-item"
          :class="{
            'unlocked': totalPoints >= level.minPoints,
            'current': currentLevel.name === level.name,
            'locked': totalPoints < level.minPoints
          }"
          @click="showLevelDetail(level, index)"
        >
          <div class="level-item-badge" :class="level.class">
            <span class="item-icon">{{ level.icon }}</span>
          </div>
          <span class="level-item-name">{{ level.name }}</span>
        </div>
      </div>
    </div>
    
    <!-- 等级详情弹窗 -->
    <t-dialog
      v-model:visible="levelDialogVisible"
      :header="false"
      :footer="false"
      width="360px"
      placement="center"
      :close-on-overlay-click="true"
    >
      <div class="level-detail-dialog" v-if="selectedLevel">
        <div class="dialog-badge-showcase" :class="[selectedLevel.class, { unlocked: totalPoints >= selectedLevel.minPoints }]">
          <div class="dialog-badge-glow"></div>
          <div class="dialog-badge-icon">{{ selectedLevel.icon }}</div>
        </div>
        <h3 class="dialog-level-name">{{ selectedLevel.name }}</h3>
        <p class="dialog-level-desc">{{ getLevelDescription(selectedLevelIndex) }}</p>
        <div class="dialog-level-info">
          <div class="info-item">
            <t-icon name="star" />
            <span>需要积分：<strong>{{ selectedLevel.minPoints }}</strong></span>
          </div>
          <div class="info-item" v-if="totalPoints >= selectedLevel.minPoints">
            <t-icon name="check-circle" class="text-success" />
            <span class="text-success">已解锁</span>
          </div>
          <div class="info-item" v-else>
            <t-icon name="lock-on" />
            <span>还差 <strong>{{ selectedLevel.minPoints - totalPoints }}</strong> 积分解锁</span>
          </div>
          <div class="info-item" v-if="getLevelUnlockDate(selectedLevelIndex)">
            <t-icon name="calendar" />
            <span>晋升日期：<strong>{{ getLevelUnlockDate(selectedLevelIndex) }}</strong></span>
          </div>
        </div>
        <t-button theme="primary" block @click="levelDialogVisible = false">知道了</t-button>
      </div>
    </t-dialog>

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
            <div class="record-main">
              <div class="record-score">
                <span class="score-value">{{ record.score }}</span>
                <span class="score-label">分</span>
              </div>
              <div class="record-meta">
                <div class="record-badge" :class="getBadgeClass(record.accuracy)">
                  {{ getBadgeText(record.accuracy) }}
                </div>
                <t-icon name="chevron-right" class="record-arrow" />
              </div>
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
    <div class="achievements-section" v-if="stats.totalGames > 0 || learningStats.totalPracticed > 0">
      <h2>成就徽章</h2>
      <div class="achievements-grid">
        <!-- 入门成就 -->
        <div class="achievement" :class="{ unlocked: stats.totalGames >= 1 }">
          <div class="achievement-icon">🎯</div>
          <div class="achievement-name">初次挑战</div>
          <div class="achievement-desc">完成第一场比赛</div>
        </div>
        <div class="achievement" :class="{ unlocked: learningStats.totalPracticed >= 1 }">
          <div class="achievement-icon">📖</div>
          <div class="achievement-name">学习起步</div>
          <div class="achievement-desc">完成第一次学习</div>
        </div>
        
        <!-- 勤奋成就 -->
        <div class="achievement" :class="{ unlocked: stats.totalGames >= 10 }">
          <div class="achievement-icon">🔥</div>
          <div class="achievement-name">勤奋练习</div>
          <div class="achievement-desc">完成10场比赛</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.totalGames >= 50 }">
          <div class="achievement-icon">💪</div>
          <div class="achievement-name">坚持不懈</div>
          <div class="achievement-desc">完成50场比赛</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.totalGames >= 100 }">
          <div class="achievement-icon">🏅</div>
          <div class="achievement-name">百战老将</div>
          <div class="achievement-desc">完成100场比赛</div>
        </div>
        
        <!-- 正确率成就 -->
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
        <div class="achievement" :class="{ unlocked: stats.averageAccuracy >= 70 }">
          <div class="achievement-icon">📊</div>
          <div class="achievement-name">稳定发挥</div>
          <div class="achievement-desc">平均正确率达到70%</div>
        </div>
        
        <!-- 高分成就 -->
        <div class="achievement" :class="{ unlocked: stats.bestScore >= 200 }">
          <div class="achievement-icon">💎</div>
          <div class="achievement-name">高分选手</div>
          <div class="achievement-desc">单场得分超过200</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.bestScore >= 500 }">
          <div class="achievement-icon">👑</div>
          <div class="achievement-name">分数王者</div>
          <div class="achievement-desc">单场得分超过500</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.bestScore >= 1000 }">
          <div class="achievement-icon">🌟</div>
          <div class="achievement-name">传奇选手</div>
          <div class="achievement-desc">单场得分超过1000</div>
        </div>
        
        <!-- 词汇量成就 -->
        <div class="achievement" :class="{ unlocked: stats.totalCorrect >= 100 }">
          <div class="achievement-icon">📚</div>
          <div class="achievement-name">词汇大师</div>
          <div class="achievement-desc">累计正确拼写100个单词</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.totalCorrect >= 500 }">
          <div class="achievement-icon">🎓</div>
          <div class="achievement-name">词汇学者</div>
          <div class="achievement-desc">累计正确拼写500个单词</div>
        </div>
        <div class="achievement" :class="{ unlocked: stats.totalCorrect >= 1000 }">
          <div class="achievement-icon">🧠</div>
          <div class="achievement-name">词汇专家</div>
          <div class="achievement-desc">累计正确拼写1000个单词</div>
        </div>
        
        <!-- 学习成就 -->
        <div class="achievement" :class="{ unlocked: masteredCount >= 50 }">
          <div class="achievement-icon">✨</div>
          <div class="achievement-name">初级掌握</div>
          <div class="achievement-desc">掌握50个单词</div>
        </div>
        <div class="achievement" :class="{ unlocked: masteredCount >= 200 }">
          <div class="achievement-icon">🌈</div>
          <div class="achievement-name">中级掌握</div>
          <div class="achievement-desc">掌握200个单词</div>
        </div>
        <div class="achievement" :class="{ unlocked: masteredCount >= 500 }">
          <div class="achievement-icon">🎖️</div>
          <div class="achievement-name">高级掌握</div>
          <div class="achievement-desc">掌握500个单词</div>
        </div>
        
        <!-- 积分等级成就 -->
        <div class="achievement" :class="{ unlocked: totalPoints >= 1000 }">
          <div class="achievement-icon">🥉</div>
          <div class="achievement-name">青铜学员</div>
          <div class="achievement-desc">总积分达到1000</div>
        </div>
        <div class="achievement" :class="{ unlocked: totalPoints >= 5000 }">
          <div class="achievement-icon">🥈</div>
          <div class="achievement-name">白银学员</div>
          <div class="achievement-desc">总积分达到5000</div>
        </div>
        <div class="achievement" :class="{ unlocked: totalPoints >= 10000 }">
          <div class="achievement-icon">🥇</div>
          <div class="achievement-name">黄金学员</div>
          <div class="achievement-desc">总积分达到10000</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
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

// 等级详情弹窗
const levelDialogVisible = ref(false)
const selectedLevel = ref(null)
const selectedLevelIndex = ref(0)

// 等级系统定义 - 合理递进，前期需努力但可达成，后期逐渐增加难度
// 积分来源：比赛得分 + 学习正确×2 + 掌握单词×5
// 参考：10场比赛约200-500分，学习100个单词约200分，掌握50个约250分
const levels = [
  { name: '见习生', icon: '🐣', minPoints: 0, color: '#9CA3AF', class: 'level-novice' },
  { name: '学徒', icon: '🌱', minPoints: 100, color: '#84CC16', class: 'level-apprentice' },
  { name: '初学者', icon: '📖', minPoints: 300, color: '#22C55E', class: 'level-beginner' },
  { name: '进阶者', icon: '📚', minPoints: 600, color: '#14B8A6', class: 'level-intermediate' },
  { name: '挑战者', icon: '⚡', minPoints: 1200, color: '#3B82F6', class: 'level-challenger' },
  { name: '精英', icon: '🎯', minPoints: 2000, color: '#8B5CF6', class: 'level-elite' },
  { name: '专家', icon: '💎', minPoints: 3500, color: '#EC4899', class: 'level-expert' },
  { name: '大师', icon: '🏆', minPoints: 6000, color: '#F59E0B', class: 'level-master' },
  { name: '宗师', icon: '👑', minPoints: 10000, color: '#EF4444', class: 'level-grandmaster' },
  { name: '传奇', icon: '🌟', minPoints: 18000, color: '#FFD700', class: 'level-legend' }
]

// 等级描述
const levelDescriptions = [
  '欢迎加入拼写蜜蜂！每一个大师都是从这里起步的。',
  '你已经迈出了第一步，继续保持学习的热情！',
  '基础扎实，正在稳步成长中。',
  '词汇量不断积累，拼写能力显著提升！',
  '敢于挑战自我，勇往直前！',
  '脱颖而出的精英，实力不容小觑。',
  '专业水准，词汇达人非你莫属！',
  '登峰造极，拼写技艺炉火纯青。',
  '一代宗师，令人敬仰的存在！',
  '传奇人物，拼写界的巅峰！'
]

function getLevelDescription(index) {
  return levelDescriptions[index] || ''
}

// 获取等级解锁日期（模拟，实际需要存储）
function getLevelUnlockDate(index) {
  const level = levels[index]
  if (totalPoints.value < level.minPoints) return null
  
  // 从localStorage读取等级解锁记录
  const unlockRecords = JSON.parse(localStorage.getItem('spellingbee_level_unlocks') || '{}')
  return unlockRecords[level.name] || null
}

// 保存等级解锁记录
function saveLevelUnlock(levelName) {
  const unlockRecords = JSON.parse(localStorage.getItem('spellingbee_level_unlocks') || '{}')
  if (!unlockRecords[levelName]) {
    unlockRecords[levelName] = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    localStorage.setItem('spellingbee_level_unlocks', JSON.stringify(unlockRecords))
  }
}

// 检查并记录新解锁的等级
function checkAndSaveLevelUnlocks() {
  levels.forEach(level => {
    if (totalPoints.value >= level.minPoints) {
      saveLevelUnlock(level.name)
    }
  })
}

function showLevelDetail(level, index) {
  selectedLevel.value = level
  selectedLevelIndex.value = index
  levelDialogVisible.value = true
}

// 计算总积分
const totalPoints = computed(() => {
  // 比赛积分：总分数
  const competitionPoints = records.value.reduce((sum, r) => sum + (r.score || 0), 0)
  // 学习积分：每次正确学习得2分，掌握一个单词额外得5分
  const learningPoints = (learningStats.value.totalCorrect || 0) * 2 + masteredCount.value * 5
  return competitionPoints + learningPoints
})

// 当前等级
const currentLevel = computed(() => {
  const points = totalPoints.value
  for (let i = levels.length - 1; i >= 0; i--) {
    if (points >= levels[i].minPoints) {
      return levels[i]
    }
  }
  return levels[0]
})

// 下一等级
const nextLevel = computed(() => {
  const currentIndex = levels.findIndex(l => l.name === currentLevel.value.name)
  if (currentIndex < levels.length - 1) {
    return levels[currentIndex + 1]
  }
  return { name: '已满级', minPoints: totalPoints.value, icon: '🌟' }
})

// 距离下一等级还差多少积分
const pointsToNextLevel = computed(() => {
  return Math.max(0, nextLevel.value.minPoints - totalPoints.value)
})

// 等级进度百分比（取整数）
const levelProgress = computed(() => {
  const currentMin = currentLevel.value.minPoints
  const nextMin = nextLevel.value.minPoints
  if (nextMin === currentMin) return 100
  const progress = ((totalPoints.value - currentMin) / (nextMin - currentMin)) * 100
  return Math.round(Math.min(100, Math.max(0, progress)))
})

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
  // 检查并保存等级解锁记录
  setTimeout(() => {
    checkAndSaveLevelUnlocks()
  }, 100)
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

      .record-date {
        font-size: 0.85rem;
        color: var(--text-muted);
        min-width: 80px;
      }

      .record-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .record-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
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

      .record-meta {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-shrink: 0;
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

      .record-arrow {
        color: var(--text-muted);
        flex-shrink: 0;
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

  // 等级卡片样式
  .level-card {
    background: linear-gradient(135deg, var(--honey-50) 0%, var(--honey-100) 100%);
    border-radius: 20px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    border: 2px solid var(--honey-200);

    .level-header {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .current-level-showcase {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1.5rem;
      min-width: 130px;

      .showcase-badge {
        position: relative;
        z-index: 1;
        width: 72px;
        height: 72px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: white;
        border-radius: 50%;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        margin-bottom: 0.75rem;

        .badge-icon {
          font-size: 2.75rem;
        }

        // 圆环作为徽章的伪元素，确保居中对齐
        &::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 90px;
          height: 90px;
          border-radius: 50%;
          border: 3px solid currentColor;
          opacity: 0.3;
          animation: ring-pulse 2.5s ease-in-out infinite;
          pointer-events: none;
        }
      }

      .showcase-info {
        position: relative;
        z-index: 1;
        text-align: center;

        .showcase-name {
          display: block;
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--charcoal-800);
          margin-bottom: 0.125rem;
        }

        .showcase-title {
          display: block;
          font-size: 0.75rem;
          color: var(--text-muted);
        }
      }

      // 等级颜色
      &.level-novice { color: #9CA3AF; }
      &.level-apprentice { color: #84CC16; }
      &.level-beginner { color: #22C55E; }
      &.level-intermediate { color: #14B8A6; }
      &.level-challenger { color: #3B82F6; }
      &.level-elite { 
        color: #8B5CF6;
        .showcase-badge { box-shadow: 0 8px 24px rgba(139, 92, 246, 0.25); }
      }
      &.level-expert { 
        color: #EC4899;
        .showcase-badge { box-shadow: 0 8px 24px rgba(236, 72, 153, 0.25); }
      }
      &.level-master { 
        color: #F59E0B;
        .showcase-badge { box-shadow: 0 8px 24px rgba(245, 158, 11, 0.35); }
      }
      &.level-grandmaster { 
        color: #EF4444;
        .showcase-badge { box-shadow: 0 8px 24px rgba(239, 68, 68, 0.35); }
      }
      &.level-legend { 
        color: #FFD700;
        .showcase-badge { 
          background: linear-gradient(135deg, #FFF9E6 0%, #FFE066 100%);
          box-shadow: 0 8px 32px rgba(255, 215, 0, 0.5); 

          &::before {
            opacity: 0.5;
            border-width: 4px;
          }
        }
      }
    }

    .level-stats {
      flex: 1;

      .total-points {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        margin-bottom: 0.75rem;

        .points-value {
          font-size: 2.5rem;
          font-weight: 700;
          font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
          color: var(--honey-600);
        }

        .points-label {
          font-size: 1rem;
          color: var(--text-secondary);
        }
      }

      .level-progress {
        .progress-text {
          font-size: 0.9rem;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;

          strong {
            color: var(--honey-600);
          }

          .max-level {
            color: var(--honey-600);
            font-weight: 600;
          }
        }
      }
    }

    // 等级徽章展示栏 - 自适应多行
    .levels-showcase {
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      gap: 0.5rem;
      padding: 1rem;
      background: white;
      border-radius: 16px;

      .level-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 0.5rem 0.25rem;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.3s ease;

        &.locked {
          opacity: 0.4;
          filter: grayscale(100%);

          .level-item-badge {
            background: var(--charcoal-100);
            border-color: var(--charcoal-200);
          }
        }

        &.unlocked {
          opacity: 1;
          filter: none;

          &:hover {
            background: var(--honey-50);
            transform: translateY(-2px);
          }
        }

        &.current {
          transform: scale(1.1);
          z-index: 10;
          
          .level-item-badge {
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
            animation: badge-pulse 2s ease-in-out infinite;
          }

          .level-item-name {
            font-weight: 700;
            color: var(--honey-600);
          }
        }

        .level-item-badge {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: white;
          border: 2px solid var(--charcoal-200);
          transition: all 0.3s ease;

          .item-icon {
            font-size: 1.35rem;
          }

          // 各等级边框颜色
          &.level-novice { border-color: #9CA3AF; }
          &.level-apprentice { border-color: #84CC16; }
          &.level-beginner { border-color: #22C55E; }
          &.level-intermediate { border-color: #14B8A6; }
          &.level-challenger { border-color: #3B82F6; }
          &.level-elite { border-color: #8B5CF6; background: linear-gradient(135deg, #fff 0%, #F3E8FF 100%); }
          &.level-expert { border-color: #EC4899; background: linear-gradient(135deg, #fff 0%, #FCE7F3 100%); }
          &.level-master { border-color: #F59E0B; background: linear-gradient(135deg, #fff 0%, #FEF3C7 100%); }
          &.level-grandmaster { border-color: #EF4444; background: linear-gradient(135deg, #fff 0%, #FEE2E2 100%); }
          &.level-legend { border-color: #FFD700; background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); }
        }

        .level-item-name {
          font-size: 0.65rem;
          color: var(--text-secondary);
          white-space: nowrap;
          text-align: center;
        }
      }
    }
  }

  // 等级详情弹窗样式
  .level-detail-dialog {
    text-align: center;
    padding: 1rem 0;

    .dialog-badge-showcase {
      position: relative;
      width: 100px;
      height: 100px;
      margin: 0 auto 1rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--charcoal-100);
      border: 4px solid var(--charcoal-200);
      filter: grayscale(100%);
      opacity: 0.5;

      .dialog-badge-glow {
        position: absolute;
        top: -20%;
        left: -20%;
        width: 140%;
        height: 140%;
        background: radial-gradient(circle, currentColor 0%, transparent 70%);
        opacity: 0;
        animation: none;
      }

      .dialog-badge-icon {
        font-size: 3.5rem;
      }

      &.unlocked {
        filter: none;
        opacity: 1;

        .dialog-badge-glow {
          opacity: 0.2;
          animation: pulse-glow 3s ease-in-out infinite;
        }

        &.level-novice { border-color: #9CA3AF; background: white; color: #9CA3AF; }
        &.level-apprentice { border-color: #84CC16; background: white; color: #84CC16; }
        &.level-beginner { border-color: #22C55E; background: white; color: #22C55E; }
        &.level-intermediate { border-color: #14B8A6; background: white; color: #14B8A6; }
        &.level-challenger { border-color: #3B82F6; background: white; color: #3B82F6; }
        &.level-elite { border-color: #8B5CF6; background: linear-gradient(135deg, #fff 0%, #F3E8FF 100%); color: #8B5CF6; }
        &.level-expert { border-color: #EC4899; background: linear-gradient(135deg, #fff 0%, #FCE7F3 100%); color: #EC4899; }
        &.level-master { border-color: #F59E0B; background: linear-gradient(135deg, #fff 0%, #FEF3C7 100%); color: #F59E0B; box-shadow: 0 4px 30px rgba(245, 158, 11, 0.4); }
        &.level-grandmaster { border-color: #EF4444; background: linear-gradient(135deg, #fff 0%, #FEE2E2 100%); color: #EF4444; box-shadow: 0 4px 30px rgba(239, 68, 68, 0.4); }
        &.level-legend { border-color: #FFD700; background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #FFD700; box-shadow: 0 4px 30px rgba(255, 215, 0, 0.6); }
      }
    }

    .dialog-level-name {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: var(--charcoal-900);
    }

    .dialog-level-desc {
      font-size: 0.95rem;
      color: var(--text-secondary);
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }

    .dialog-level-info {
      background: var(--charcoal-50);
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1.5rem;

      .info-item {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 0;
        font-size: 0.9rem;
        color: var(--text-secondary);

        &:not(:last-child) {
          border-bottom: 1px solid var(--charcoal-100);
        }

        strong {
          color: var(--honey-600);
        }

        .text-success {
          color: var(--success);
        }
      }
    }
  }

  @keyframes ring-pulse {
    0%, 100% { 
      opacity: 0.3; 
      transform: translate(-50%, -50%) scale(1); 
    }
    50% { 
      opacity: 0.5; 
      transform: translate(-50%, -50%) scale(1.1); 
    }
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 0.1; transform: scale(1); }
    50% { opacity: 0.2; transform: scale(1.05); }
  }

  @keyframes badge-pulse {
    0%, 100% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2); }
    50% { box-shadow: 0 4px 24px rgba(255, 193, 7, 0.5); }
  }
}

@media (max-width: 768px) {
  .stats-page {
    .level-card {
      padding: 1rem;
      
      .level-header {
        flex-direction: column;
        align-items: stretch;
        gap: 1rem;
      }

      .current-level-showcase {
        flex-direction: row;
        justify-content: center;
        gap: 1rem;
        padding: 1rem;
        min-width: auto;

        .showcase-badge {
          width: 56px;
          height: 56px;
          margin-bottom: 0;

          .badge-icon {
            font-size: 2rem;
          }

          &::before {
            width: 70px;
            height: 70px;
          }
        }

        .showcase-info {
          text-align: left;
        }
      }

      .level-stats .total-points {
        justify-content: center;

        .points-value {
          font-size: 2rem;
        }
      }

      // 移动端5列2行布局
      .levels-showcase {
        grid-template-columns: repeat(5, 1fr);
        gap: 0.375rem;
        padding: 0.75rem;

        .level-item {
          padding: 0.25rem;

          &.current {
            transform: scale(1.08);
          }

          .level-item-badge {
            width: 36px;
            height: 36px;

            .item-icon {
              font-size: 1.2rem;
            }
          }

          .level-item-name {
            font-size: 0.55rem;
          }
        }
      }
    }

    .overview-section .stats-grid,
    .learning-section .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .records-section .record-card {
      padding: 1rem;
      gap: 0.5rem;

      .record-date {
        font-size: 0.8rem;
      }

      .record-main {
        .record-score .score-value {
          font-size: 1.75rem;
        }
      }

      .record-details {
        gap: 0.75rem;

        .detail-item {
          font-size: 0.8rem;
        }
      }
    }

    .achievements-section .achievements-grid {
      grid-template-columns: repeat(2, 1fr);

      .achievement {
        padding: 1rem;

        .achievement-icon {
          font-size: 2rem;
        }

        .achievement-name {
          font-size: 0.9rem;
        }

        .achievement-desc {
          font-size: 0.75rem;
        }
      }
    }
  }
}

// 超小屏幕适配
@media (max-width: 380px) {
  .stats-page {
    .level-card .levels-showcase {
      .level-item {
        .level-item-badge {
          width: 32px;
          height: 32px;

          .item-icon {
            font-size: 1rem;
          }
        }

        .level-item-name {
          font-size: 0.5rem;
        }
      }
    }
  }
}
</style>

