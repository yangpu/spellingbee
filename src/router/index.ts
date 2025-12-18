import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue')
  },
  {
    path: '/learn',
    name: 'Learn',
    component: () => import('@/views/Learn.vue')
  },
  {
    path: '/learn/manager',
    name: 'LearningManager',
    component: () => import('@/views/LearningManager.vue')
  },
  {
    path: '/competition',
    name: 'Competition',
    component: () => import('@/views/Competition.vue')
  },
  {
    path: '/challenge',
    name: 'Challenge',
    component: () => import('@/views/Challenge.vue')
  },
  {
    path: '/challenge/:id',
    name: 'ChallengeRoom',
    component: () => import('@/views/Challenge.vue')
  },
  {
    path: '/dictionaries',
    name: 'Dictionaries',
    component: () => import('@/views/Dictionaries.vue')
  },
  {
    path: '/dictionaries/:id',
    name: 'DictionaryWords',
    component: () => import('@/views/Words.vue')
  },
  {
    path: '/words',
    name: 'Words',
    redirect: '/dictionaries'
  },
  {
    path: '/stats',
    name: 'Stats',
    component: () => import('@/views/Stats.vue')
  },
  {
    path: '/stats/record/:id',
    name: 'CompetitionRecord',
    component: () => import('@/views/CompetitionRecord.vue')
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // 浏览器前进/后退时恢复之前的位置（使用 instant 避免看到滚动过程）
    if (savedPosition) {
      return { ...savedPosition, behavior: 'instant' }
    }
    // 其他情况保持当前位置（不滚动）
    // ChallengeRoom 组件会在 onMounted 中自行处理滚动到顶部
    return false
  }
})

export default router
