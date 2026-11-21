<template>
  <div class="reset-password-page">
    <div class="reset-card">
      <template v-if="checking">
        <t-loading size="large" text="正在验证重置链接..." />
      </template>

      <template v-else-if="canReset">
        <div class="reset-header">
          <t-icon name="lock-on" size="36px" />
          <h1>设置新密码</h1>
          <p>请输入新密码以完成重置</p>
        </div>

        <div class="reset-form">
          <div class="field">
            <label>新密码</label>
            <t-input v-model="newPassword" type="password" placeholder="至少 6 位字符" :disabled="submitting" />
          </div>
          <div class="field">
            <label>确认新密码</label>
            <t-input v-model="confirmPassword" type="password" placeholder="请再次输入新密码" :disabled="submitting"
              @enter="submit" />
          </div>
          <t-button theme="primary" block :loading="submitting" @click="submit">确认重置</t-button>
          <t-button variant="text" block :disabled="submitting" @click="goHome">返回首页</t-button>
        </div>
      </template>

      <template v-else>
        <div class="reset-header">
          <t-icon name="error-circle" size="36px" />
          <h1>重置链接无效</h1>
          <p>链接可能已过期或已被使用，请重新申请重置密码。</p>
        </div>
        <t-button theme="primary" block @click="goHome">返回首页</t-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const checking = ref(true)
const canReset = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)

let recoverySubscription: { unsubscribe: () => void } | null = null
let recoveryTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false

onMounted(async () => {
  // supabase-js 默认 detectSessionInUrl：会在 getSession() 时用链接里的 token 换取 session，
  // 并触发 PASSWORD_RECOVERY 事件。子组件先于 App 挂载，因此这里主动取一次 session。
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
      if (!disposed) canReset.value = true
    }
  })
  recoverySubscription = data.subscription

  try {
    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData.session && !disposed) canReset.value = true
  } catch (error) {
    console.error('[ResetPassword] Failed to read session:', error)
  }

  // 给 token 交换留一点时间，避免误判为无效链接
  recoveryTimer = setTimeout(() => {
    if (!disposed) checking.value = false
  }, 1500)
})

onUnmounted(() => {
  disposed = true
  if (recoveryTimer) clearTimeout(recoveryTimer)
  recoverySubscription?.unsubscribe()
})

async function submit() {
  if (newPassword.value.length < 6) {
    MessagePlugin.warning('密码至少 6 位字符')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    MessagePlugin.warning('两次输入的密码不一致')
    return
  }

  submitting.value = true
  try {
    await authStore.updatePassword(newPassword.value)
    MessagePlugin.success('密码已更新')
    goHome()
  } catch (error: any) {
    MessagePlugin.error(error?.message || '重置失败，请重试')
  } finally {
    submitting.value = false
  }
}

function goHome() {
  // 由 vue-router 基于 base（/spellingbee/）生成路径，避免手写地址漏掉前缀
  router.replace({ name: 'Home' })
}
</script>

<style lang="scss" scoped>
.reset-password-page {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 60vh;
}

.reset-card {
  width: 100%;
  max-width: 420px;
  padding: 2.5rem 2rem;
  border-radius: 16px;
  background: var(--bg-card);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.reset-header {
  text-align: center;

  :deep(.t-icon) {
    color: var(--accent-color);
  }

  h1 {
    margin: 0.75rem 0 0.5rem;
    font-size: 1.5rem;
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
}

.reset-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    label {
      color: var(--text-primary);
      font-weight: 500;
      font-size: 0.9rem;
    }
  }
}
</style>
