<template>
  <t-dialog
    v-model:visible="dialogVisible"
    header="网络状态"
    :footer="false"
    width="320px"
  >
    <div class="network-status-content">
      <div class="status-item">
        <template v-if="showLoading">
          <t-loading size="small" />
        </template>
        <template v-else>
          <t-icon 
            :name="supabaseConnected ? 'check-circle-filled' : 'close-circle-filled'" 
            :class="supabaseConnected ? 'status-ok' : 'status-error'" 
          />
        </template>
        <span>Supabase 实时服务</span>
        <span class="status-text" :class="supabaseConnected ? 'text-ok' : showLoading ? 'text-reconnecting' : 'text-error'">
          {{ supabaseConnected ? '已连接' : showLoading ? '连接中' : '未连接' }}
        </span>
      </div>
      <div class="status-item">
        <t-icon 
          :name="isOnline ? 'check-circle-filled' : 'close-circle-filled'" 
          :class="isOnline ? 'status-ok' : 'status-error'" 
        />
        <span>网络连接</span>
        <span class="status-text" :class="isOnline ? 'text-ok' : 'text-error'">
          {{ isOnline ? '在线' : '离线' }}
        </span>
      </div>
      <div v-if="!isLoggedIn" class="login-hint-small">
        <t-icon name="info-circle" />
        <span>登录后才能连接实时服务</span>
      </div>
      <t-button 
        v-else-if="!supabaseConnected && isOnline" 
        theme="primary" 
        block 
        style="margin-top: 16px;" 
        :loading="reconnecting"
        :disabled="reconnecting"
        @click="handleReconnect"
      >
        <template #icon><t-icon name="refresh" /></template>
        立即重连
      </t-button>
    </div>
  </t-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useChallengeNotifications, notificationService } from '@/lib/network'
import { realtimeManager } from '@/lib/realtime-manager'

const props = defineProps<{
  visible: boolean
  isLoggedIn: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

// Supabase 连接状态
const { isConnected: supabaseConnected, isReconnecting: supabaseReconnecting } = useChallengeNotifications()

// 额外的状态检查，确保 UI 正确显示
const isActuallyReconnecting = computed(() => {
  return supabaseReconnecting.value || realtimeManager.status.value === 'reconnecting'
})

const isActuallyConnecting = computed(() => {
  return realtimeManager.status.value === 'connecting'
})

const showLoading = computed(() => {
  return isActuallyReconnecting.value || isActuallyConnecting.value || reconnecting.value
})

// 网络状态
const isOnline = ref(navigator.onLine)
const reconnecting = ref(false)

// 监听网络状态
const updateOnlineStatus = () => {
  isOnline.value = navigator.onLine
}

// 手动重连
const handleReconnect = async () => {
  if (!reconnecting.value) {
    reconnecting.value = true
    try {
      await notificationService.forceReconnect()
    } catch (e) {
      console.error('[NetworkStatus] Reconnect error:', e)
    } finally {
      // 延迟重置状态，让用户看到重连过程
      setTimeout(() => {
        reconnecting.value = false
      }, 1000)
    }
  }
}

onMounted(() => {
  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)
})

onUnmounted(() => {
  window.removeEventListener('online', updateOnlineStatus)
  window.removeEventListener('offline', updateOnlineStatus)
})
</script>

<style lang="scss" scoped>
.network-status-content {
  .status-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border-color);
    
    &:last-of-type {
      border-bottom: none;
    }
    
    .status-ok {
      color: #22c55e;
      font-size: 1.25rem;
    }
    
    .status-error {
      color: #ef4444;
      font-size: 1.25rem;
    }
    
    .status-text {
      margin-left: auto;
      font-weight: 500;
      
      &.text-ok {
        color: #22c55e;
      }
      
      &.text-error {
        color: #ef4444;
      }
      
      &.text-reconnecting {
        color: #f59e0b;
      }
    }
  }
  
  .login-hint-small {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding: 0.75rem;
    background: var(--warning-light, #fef3c7);
    border-radius: 8px;
    color: var(--warning, #d97706);
    font-size: 0.875rem;
  }
}
</style>
