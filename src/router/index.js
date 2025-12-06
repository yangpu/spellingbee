import { createRouter, createWebHistory } from 'vue-router'

const routes = [
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
    path: '/words',
    name: 'Words',
    component: () => import('@/views/Words.vue')
  },
  {
    path: '/stats',
    name: 'Stats',
    component: () => import('@/views/Stats.vue')
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router

