<template>
  <t-dialog
    v-model:visible="dialogVisible"
    :header="dialogHeader"
    :footer="false"
    width="400px"
    @close="handleClose"
  >
    <t-form ref="authForm" :data="authData" :rules="authRules" @submit="handleAuth">
      <t-form-item name="email" label="邮箱">
        <t-input v-model="authData.email" placeholder="请输入邮箱" />
      </t-form-item>
      <t-form-item v-if="authMode !== 'forgot'" name="password" label="密码">
        <t-input v-model="authData.password" type="password" placeholder="请输入密码" />
      </t-form-item>
      <t-form-item v-if="authMode === 'register'" name="confirmPassword" label="确认密码">
        <t-input v-model="authData.confirmPassword" type="password" placeholder="请再次输入密码" />
      </t-form-item>
      <div class="auth-actions">
        <t-button theme="primary" type="submit" :loading="authLoading" block>
          {{ submitButtonText }}
        </t-button>
        
        <!-- 第三方登录分隔线 -->
        <div v-if="authMode === 'login'" class="oauth-divider">
          <span>或使用以下方式登录</span>
        </div>
        
        <!-- GitHub 登录按钮 -->
        <t-button
          v-if="authMode === 'login'"
          variant="outline"
          block
          :loading="oauthLoading"
          class="github-btn"
          @click="handleGitHubLogin"
        >
          <template #icon>
            <svg class="github-icon" viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </template>
          使用 GitHub 登录
        </t-button>
        
        <div class="auth-links">
          <t-button variant="text" @click="toggleAuthMode">
            {{ toggleModeText }}
          </t-button>
          <t-button v-if="authMode === 'login'" variant="text" @click="showForgotPassword">
            忘记密码？
          </t-button>
        </div>
      </div>
    </t-form>
  </t-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useAuthStore } from '@/stores/auth'

type AuthMode = 'login' | 'register' | 'forgot'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'success'): void
}>()

const authStore = useAuthStore()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const authMode = ref<AuthMode>('login')
const authLoading = ref(false)
const oauthLoading = ref(false)

const authData = reactive({
  email: '',
  password: '',
  confirmPassword: ''
})

const authRules = {
  email: [
    { required: true, message: '请输入邮箱', type: 'error' as const },
    { email: true, message: '请输入有效的邮箱地址', type: 'error' as const }
  ],
  password: [
    { required: true, message: '请输入密码', type: 'error' as const },
    { min: 6, message: '密码至少6个字符', type: 'error' as const }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', type: 'error' as const },
    {
      validator: (val: string) => val === authData.password,
      message: '两次密码不一致',
      type: 'error' as const
    }
  ]
}

const dialogHeader = computed(() => {
  switch (authMode.value) {
    case 'login': return '登录'
    case 'register': return '注册'
    case 'forgot': return '忘记密码'
    default: return '登录'
  }
})

const submitButtonText = computed(() => {
  switch (authMode.value) {
    case 'login': return '登录'
    case 'register': return '注册'
    case 'forgot': return '发送重置邮件'
    default: return '登录'
  }
})

const toggleModeText = computed(() => {
  switch (authMode.value) {
    case 'login': return '没有账号？去注册'
    case 'register': return '已有账号？去登录'
    case 'forgot': return '返回登录'
    default: return ''
  }
})

const toggleAuthMode = () => {
  if (authMode.value === 'login') {
    authMode.value = 'register'
  } else {
    authMode.value = 'login'
  }
}

const showForgotPassword = () => {
  authMode.value = 'forgot'
}

const handleClose = () => {
  authMode.value = 'login'
  authData.email = ''
  authData.password = ''
  authData.confirmPassword = ''
}

const handleAuth = async ({ validateResult }: { validateResult: boolean }) => {
  if (validateResult !== true) return

  authLoading.value = true
  try {
    if (authMode.value === 'login') {
      await authStore.login(authData.email, authData.password)
      MessagePlugin.success('登录成功')
      dialogVisible.value = false
      emit('success')
    } else if (authMode.value === 'register') {
      await authStore.register(authData.email, authData.password)
      MessagePlugin.success('注册成功，请查收验证邮件后登录')
      authMode.value = 'login'
    } else if (authMode.value === 'forgot') {
      await authStore.resetPassword(authData.email)
      MessagePlugin.success('重置密码邮件已发送，请查收')
      authMode.value = 'login'
    }
  } catch (error: any) {
    MessagePlugin.error(error.message || '操作失败')
  } finally {
    authLoading.value = false
  }
}

const handleGitHubLogin = async () => {
  oauthLoading.value = true
  try {
    await authStore.loginWithGitHub()
    // OAuth 会重定向，所以这里不需要处理成功逻辑
  } catch (error: any) {
    MessagePlugin.error(error.message || 'GitHub 登录失败')
    oauthLoading.value = false
  }
}

// 重置状态当对话框打开时
watch(() => props.visible, (val) => {
  if (val) {
    authMode.value = 'login'
  }
})
</script>

<style lang="scss" scoped>
.auth-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;

  .oauth-divider {
    display: flex;
    align-items: center;
    margin: 0.5rem 0;
    
    &::before,
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border-color);
    }
    
    span {
      padding: 0 1rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      white-space: nowrap;
    }
  }

  .github-btn {
    .github-icon {
      margin-right: 0.5rem;
    }
  }

  .auth-links {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
