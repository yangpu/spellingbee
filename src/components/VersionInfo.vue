<template>
  <t-button variant="text" size="small" class="version-btn" @click="showUpgradeConfirm">
    v{{ appVersion }}
  </t-button>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { versionService } from '@/lib/version-service'

const appVersion = __APP_VERSION__

// 版本更新状态
const isUpgrading = ref(false)
let unsubscribeVersionUpdate: (() => void) | null = null

// 显示升级确认对话框
const showUpgradeConfirm = async () => {
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
  isUpgrading.value = true
  
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

// 初始化版本服务
onMounted(async () => {
  await versionService.init()
  
  // 订阅版本更新（实时推送）
  unsubscribeVersionUpdate = versionService.onUpdate((versionInfo) => {
    showUpdateDialog(versionInfo.version, versionInfo.release_notes)
  })
  
  // 如果启动时就检测到有新版本，提示用户
  if (versionService.hasUpdate && versionService.latestVersion) {
    setTimeout(() => {
      showUpdateDialog(versionService.latestVersion!, versionService.releaseNotes ?? undefined)
    }, 2000)
  }
})

onUnmounted(async () => {
  if (unsubscribeVersionUpdate) {
    unsubscribeVersionUpdate()
    unsubscribeVersionUpdate = null
  }
  await versionService.destroy()
})
</script>

<style lang="scss" scoped>
.version-btn {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 0.15rem 0.5rem;
  
  &:hover {
    color: var(--accent-color);
  }
}
</style>
