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

        <!-- 当前版本 -->
        <div class="setting-item clickable" @click="showVersionDialog">
          <div class="setting-info">
            <t-icon name="info-circle" />
            <span class="setting-label">当前版本</span>
          </div>
          <div class="setting-control">
            <span class="version-text">v{{ appVersion }}</span>
            <t-icon name="chevron-right" class="arrow-icon" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { versionService } from '@/lib/version-service'

defineEmits<{
  (e: 'open-speech-settings'): void
  (e: 'open-announcer'): void
}>()

const authStore = useAuthStore()

// 应用版本
const appVersion = __APP_VERSION__

// 版本更新订阅
let unsubscribeVersionUpdate: (() => void) | null = null

// 主题存储键
const THEME_KEY = 'spellingbee_theme'

// 获取初始主题（从 localStorage 或系统偏好）
function getInitialTheme(): 'light' | 'dark' {
  const savedTheme = localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null
  if (savedTheme) {
    return savedTheme
  }
  // 检测系统主题偏好
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

// 当前主题（初始值从 localStorage 读取，避免闪烁）
const currentTheme = ref<'light' | 'dark'>(getInitialTheme())

// 显示版本信息对话框
const showVersionDialog = async () => {
  const dialog = DialogPlugin.confirm({
    header: '版本信息',
    body: `当前版本：v${appVersion}\n\n是否检测最新版本？\n\n如遇到更新问题，可点击"立即升级"强制刷新。`,
    confirmBtn: '检测更新',
    cancelBtn: '立即升级',
    onConfirm: async () => {
      dialog.destroy()
      await checkAndPromptUpdate()
    },
    onCancel: () => {
      dialog.destroy()
      startUpgrade()
    },
    onClose: () => {
      dialog.destroy()
    }
  })
}

// 检测并提示更新
const checkAndPromptUpdate = async () => {
  MessagePlugin.loading('正在检测最新版本...')
  
  try {
    const result = await versionService.checkVersion()
    MessagePlugin.closeAll()
    
    if (result.hasUpdate && result.latestVersion) {
      showUpdateDialog(result.latestVersion, result.releaseNotes)
    } else {
      MessagePlugin.success('当前已是最新版本')
    }
  } catch (error) {
    MessagePlugin.closeAll()
    MessagePlugin.error('检测更新失败，请稍后重试')
  }
}

// 显示更新对话框
const showUpdateDialog = (newVersion: string, releaseNotes?: string) => {
  let body = `发现新版本：v${newVersion}\n当前版本：v${appVersion}`
  if (releaseNotes) {
    body += `\n\n更新说明：${releaseNotes}`
  }
  body += '\n\n是否立即更新？'
  
  const dialog = DialogPlugin.confirm({
    header: '发现新版本',
    body,
    confirmBtn: '立即更新',
    cancelBtn: '稍后再说',
    onConfirm: () => {
      dialog.destroy()
      startUpgrade()
    },
    onClose: () => {
      dialog.destroy()
    }
  })
}

// 开始升级
const startUpgrade = () => {
  DialogPlugin({
    header: '正在更新',
    body: '正在清理缓存并刷新页面，请稍候...',
    footer: false,
    closeOnOverlayClick: false,
    closeOnEscKeydown: false
  })
  
  forceRefresh()
}

// 强制刷新页面
const forceRefresh = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister()
      })
    })
  }
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => {
        caches.delete(name)
      })
    })
  }
  setTimeout(() => {
    window.location.reload()
  }, 100)
}

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
  // 1. 应用当前主题到 DOM（初始值已从 localStorage 读取）
  applyTheme(currentTheme.value)
  
  // 2. 如果已登录，从云端加载（可能覆盖本地）
  if (authStore.user) {
    const cloudTheme = await loadFromCloud()
    if (cloudTheme && cloudTheme !== currentTheme.value) {
      currentTheme.value = cloudTheme
      applyTheme(cloudTheme)
      saveToLocal(cloudTheme)
    }
  }
  
  // 3. 初始化版本服务并订阅更新
  await versionService.init()
  unsubscribeVersionUpdate = versionService.onUpdate((versionInfo) => {
    showUpdateDialog(versionInfo.version, versionInfo.release_notes)
  })
})

onUnmounted(async () => {
  if (unsubscribeVersionUpdate) {
    unsubscribeVersionUpdate()
    unsubscribeVersionUpdate = null
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
        display: flex;
        align-items: center;
        gap: 0.5rem;

        .version-text {
          font-family: 'SF Mono', Monaco, monospace;
          font-size: 0.85rem;
          color: var(--text-muted);
        }

        .arrow-icon {
          color: var(--text-muted);
        }
      }
    }
  }
}
</style>
