<template>
  <div class="home-page">
    <!-- Hero Section -->
    <section class="hero">
      <div class="hero-content">
        <div class="hero-icon">
          <img src="/bee.svg" alt="Spelling Bee" class="bee-icon" />
        </div>
        <h1 class="hero-title">Spelling Bee</h1>
        <p class="hero-subtitle">单词拼写大赛模拟器</p>
        <p class="hero-description">
          通过模拟真实比赛场景，帮助你提升单词拼写能力。<br />
          虚拟发音官将朗读单词，你需要在规定时间内正确拼写。
        </p>
        <div class="hero-actions">
          <t-button
            theme="primary"
            size="large"
            @click="$router.push('/competition')"
          >
            <t-icon name="microphone" />
            开始比赛
          </t-button>
          <t-button
            variant="outline"
            size="large"
            @click="$router.push('/learn')"
          >
            <t-icon name="books" />
            学习单词
          </t-button>
        </div>
      </div>
      <div class="hero-decoration">
        <div class="honeycomb"></div>
      </div>
    </section>

    <!-- Features Section -->
    <section class="features">
      <h2 class="section-title">功能特色</h2>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">
            <t-icon name="sound" size="32px" />
          </div>
          <h3>语音发音</h3>
          <p>虚拟发音官使用浏览器语音合成技术，清晰朗读每一个单词</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">
            <t-icon name="time" size="32px" />
          </div>
          <h3>限时挑战</h3>
          <p>每个单词60秒答题时间，模拟真实比赛的紧张氛围</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">
            <t-icon name="help-circle" size="32px" />
          </div>
          <h3>提问功能</h3>
          <p>可以询问单词的发音、定义、词性和例句</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">
            <t-icon name="chart-bar" size="32px" />
          </div>
          <h3>成绩统计</h3>
          <p>记录每次比赛的得分、正确率，追踪学习进步</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">
            <t-icon name="root-list" size="32px" />
          </div>
          <h3>词库管理</h3>
          <p>支持自定义词库，导入导出单词表</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">
            <t-icon name="mobile" size="32px" />
          </div>
          <h3>移动适配</h3>
          <p>响应式设计，在手机和平板上同样流畅使用</p>
        </div>
      </div>
    </section>

    <!-- Rules Section -->
    <section class="rules">
      <h2 class="section-title">比赛规则</h2>
      <div class="rules-container">
        <div class="rule-item">
          <div class="rule-number">1</div>
          <div class="rule-content">
            <h4>口语拼写</h4>
            <p>决赛为现场口语拼写词汇，选手不允许使用任何工具或材料</p>
          </div>
        </div>
        <div class="rule-item">
          <div class="rule-number">2</div>
          <div class="rule-content">
            <h4>限时答题</h4>
            <p>每位选手答题时间为一分钟，未在规定时间内作答将被淘汰</p>
          </div>
        </div>
        <div class="rule-item">
          <div class="rule-number">3</div>
          <div class="rule-content">
            <h4>允许提问</h4>
            <p>答题期间可向发音官提问单词的发音、定义、词性和例句</p>
          </div>
        </div>
        <div class="rule-item">
          <div class="rule-number">4</div>
          <div class="rule-content">
            <h4>重复发音</h4>
            <p>拼读前应重复单词发音，清楚地逐一拼读每个字母</p>
          </div>
        </div>
        <div class="rule-item">
          <div class="rule-number">5</div>
          <div class="rule-content">
            <h4>零容错</h4>
            <p>作答时如出现字母拼错，则直接淘汰</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Quick Stats -->
    <section class="quick-stats" v-if="stats.totalGames > 0">
      <h2 class="section-title">我的成绩</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalGames }}</div>
          <div class="stat-label">比赛场次</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.bestScore }}</div>
          <div class="stat-label">最高分数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.averageAccuracy }}%</div>
          <div class="stat-label">平均正确率</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ wordCount }}</div>
          <div class="stat-label">词库单词</div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue';
import { useWordsStore } from '@/stores/words';
import { useCompetitionStore } from '@/stores/competition';

const wordsStore = useWordsStore();
const competitionStore = useCompetitionStore();

const wordCount = computed(() => wordsStore.wordCount);
const stats = computed(() => competitionStore.stats);

onMounted(async () => {
  await wordsStore.init();
  await competitionStore.loadRecords();
});
</script>

<style lang="scss" scoped>
.home-page {
  max-width: 1200px;
  margin: 0 auto;
}

.hero {
  text-align: center;
  padding: 4rem 2rem;
  position: relative;
  overflow: hidden;

  .hero-content {
    position: relative;
    z-index: 1;
  }

  .hero-icon {
    margin-bottom: 1.5rem;

    .bee-icon {
      width: 80px;
      height: 80px;
      animation: float 3s ease-in-out infinite;
    }
  }

  .hero-title {
    font-family: 'Crimson Pro', serif;
    font-size: 4rem;
    font-weight: 700;
    color: var(--charcoal-900);
    margin-bottom: 0.5rem;
    letter-spacing: -2px;
  }

  .hero-subtitle {
    font-size: 1.5rem;
    color: var(--honey-700);
    font-weight: 500;
    margin-bottom: 1rem;
  }

  .hero-description {
    font-size: 1.1rem;
    color: var(--charcoal-600);
    max-width: 600px;
    margin: 0 auto 2rem;
    line-height: 1.8;
  }

  .hero-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .hero-decoration {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
    opacity: 0.1;

    .honeycomb {
      position: absolute;
      width: 200px;
      height: 200px;
      background: radial-gradient(
        circle at 50% 50%,
        var(--honey-400) 30%,
        transparent 30%
      );
      background-size: 60px 60px;
      top: 10%;
      right: 5%;
    }
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.section-title {
  text-align: center;
  font-size: 2rem;
  margin-bottom: 2rem;
  color: var(--charcoal-900);
}

.features {
  padding: 4rem 1rem;
  background: var(--bg-card);
  border-radius: 24px;
  margin-bottom: 3rem;

  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .feature-card {
    padding: 1.5rem;
    text-align: center;
    border-radius: 16px;
    background: var(--hover-bg);
    transition: all 0.3s;

    &:hover {
      transform: translateY(-4px);
      box-shadow: var(--shadow-md);
    }

    .feature-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 1rem;
      background: linear-gradient(
        135deg,
        var(--honey-400) 0%,
        var(--honey-500) 100%
      );
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    h3 {
      font-size: 1.25rem;
      margin-bottom: 0.5rem;
      color: var(--charcoal-900);
    }

    p {
      color: var(--charcoal-600);
      font-size: 0.95rem;
      line-height: 1.6;
    }
  }
}

.rules {
  padding: 3rem 1rem;
  margin-bottom: 3rem;

  .rules-container {
    max-width: 800px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .rule-item {
    display: flex;
    gap: 1.5rem;
    align-items: flex-start;
    padding: 1.5rem;
    background: var(--bg-card);
    border-radius: 16px;
    border-left: 4px solid var(--honey-500);
    transition: all 0.3s;

    &:hover {
      transform: translateX(8px);
      box-shadow: var(--shadow-md);
    }

    .rule-number {
      width: 40px;
      height: 40px;
      background: linear-gradient(
        135deg,
        var(--honey-400) 0%,
        var(--honey-500) 100%
      );
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 1.25rem;
      flex-shrink: 0;
    }

    .rule-content {
      h4 {
        font-size: 1.1rem;
        margin-bottom: 0.25rem;
        color: var(--charcoal-900);
      }

      p {
        color: var(--charcoal-600);
        line-height: 1.6;
      }
    }
  }
}

.quick-stats {
  padding: 3rem 1rem;
  background: linear-gradient(
    135deg,
    var(--honey-100) 0%,
    var(--honey-200) 100%
  );
  border-radius: 24px;
  margin-bottom: 2rem;

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    max-width: 800px;
    margin: 0 auto;
  }

  .stat-card {
    text-align: center;
    padding: 1.5rem;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 16px;
    backdrop-filter: blur(10px);

    .stat-value {
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--honey-700);
      font-family: 'Crimson Pro', serif;
    }

    .stat-label {
      color: var(--charcoal-600);
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }
  }
}

@media (max-width: 768px) {
  .hero {
    padding: 2rem 1rem;

    .hero-title {
      font-size: 2.5rem;
    }

    .hero-subtitle {
      font-size: 1.25rem;
    }
  }

  .features .features-grid {
    grid-template-columns: 1fr;
  }

  .quick-stats .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
