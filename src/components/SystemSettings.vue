<template>
  <div class="system-settings">
    <div class="settings-section">
      <div class="section-title">
        <t-icon name="setting" />
        <span>系统配置</span>
      </div>
      
      <div class="settings-list">
        <!-- 主题切换 -->
        <div class="setting-item">
          <div class="setting-info">
            <t-icon :name="currentTheme === 'dark' ? 'moon' : 'sunny'" />
            <span class="setting-label">主题模式</span>
          </div>
          <div class="setting-control">
            <t-radio-group v-model="currentTheme" variant="default-filled" size="small">
              <t-radio-button value="light">
                <t-icon name="sunny" />
                浅色
              </t-radio-button>
              <t-radio-button value="dark">
                <t-icon name="moon" />
                深色
              </t-radio-button>
            </t-radio-group>
          </div>
        </div>

        <!-- 语音配置按钮 -->
        <div class="setting-item clickable" @click="$emit('open-speech-settings')">
          <div class="setting-info">
            <t-icon name="sound" />
            <span class="setting-label">语音配置</span>
          </div>
          <div class="setting-control">
            <t-icon name="chevron-right" class="arrow-icon" />
          </div>
        </div>

        <!-- 播音员按钮 -->
        <div class="setting-item clickable" @click="$emit('open-announcer')">
          <div class="setting-info">
            <t-icon name="microphone" />
            <span class="setting-label">播音员</span>
          </div>
          <div class="setting-control">
            <t-icon name="chevron-right" class="arrow-icon" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'

defineEmits<{
  (e: 'open-speech-settings'): void
  (e: 'open-announcer'): void
}>()

const authStore = useAuthStore()

// 主题存储键
const THEME_KEY = 'spellingbee_theme'

// 当前主题
const currentTheme = ref<'light' | 'dark'>('light')

// 应用主题到 DOM
function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme)
}

// 保存主题到本地
function saveToLocal(theme: 'light' | 'dark') {
  localStorage.setItem(THEME_KEY, theme)
}

// 保存主题到云端
async function saveToCloud(theme: 'light' | 'dark') {
  if (!authStore.user) return
  
  try {
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: authStore.user.id,
        theme: theme,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
    
    if (error) {
      console.error('Error saving theme to cloud:', error)
    }
  } catch (e) {
    console.error('Error saving theme:', e)
  }
}

// 从云端加载主题
async function loadFromCloud(): Promise<'light' | 'dark' | null> {
  if (!authStore.user) return null
  
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('theme')
      .eq('user_id', authStore.user.id)
      .maybeSingle()
    
    if (error) {
      console.error('Error loading theme from cloud:', error)
      return null
    }
    
    if (data?.theme) {
      return data.theme as 'light' | 'dark'
    }
  } catch (e) {
    console.error('Error loading theme:', e)
  }
  return null
}

// 监听主题变化
watch(currentTheme, async (newTheme) => {
  applyTheme(newTheme)
  saveToLocal(newTheme)
  await saveToCloud(newTheme)
})

// 初始化主题
onMounted(async () => {
  // 1. 先尝试从本地加载（快速响应）
  const localTheme = localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null
  if (localTheme) {
    currentTheme.value = localTheme
    applyTheme(localTheme)
  } else {
    // 检测系统主题偏好
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    currentTheme.value = prefersDark ? 'dark' : 'light'
    applyTheme(currentTheme.value)
  }
  
  // 2. 如果已登录，从云端加载（可能覆盖本地）
  if (authStore.user) {
    const cloudTheme = await loadFromCloud()
    if (cloudTheme && cloudTheme !== currentTheme.value) {
      currentTheme.value = cloudTheme
      applyTheme(cloudTheme)
      saveToLocal(cloudTheme)
    }
  }
})
</script>

<style lang="scss" scoped>
.system-settings {
  .settings-section {
    .section-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 1rem;
      
      .t-icon {
        color: var(--accent-color);
      }
    }

    .settings-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .setting-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--hover-bg);
      border-radius: 8px;
      transition: all 0.2s;

      &.clickable {
        cursor: pointer;

        &:hover {
          background: var(--accent-bg);
        }
      }

      .setting-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;

        .t-icon {
          font-size: 1.1rem;
          color: var(--text-secondary);
        }

        .setting-label {
          font-size: 0.95rem;
          color: var(--text-primary);
        }
      }

      .setting-control {
        .arrow-icon {
          color: var(--text-muted);
        }
      }
    }
  }
}
</style>
