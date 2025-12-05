<template>
  <div class="app-container">
    <nav class="app-nav">
      <div class="nav-brand">
        <img :src="`${baseUrl}bee.svg`" alt="Bee" class="brand-icon" />
        <span class="brand-text">Spelling Bee</span>
      </div>
      <div class="nav-links">
        <router-link to="/" class="nav-link">
          <t-icon name="home" />
          <span>首页</span>
        </router-link>
        <router-link to="/learn" class="nav-link">
          <t-icon name="book-open" />
          <span>学习</span>
        </router-link>
        <router-link to="/competition" class="nav-link">
          <t-icon name="microphone" />
          <span>比赛</span>
        </router-link>
        <router-link to="/words" class="nav-link">
          <t-icon name="view-list" />
          <span>词库</span>
        </router-link>
        <router-link to="/stats" class="nav-link">
          <t-icon name="chart" />
          <span>统计</span>
        </router-link>
      </div>
      <div class="nav-user">
        <t-button
          v-if="!authStore.user"
          theme="primary"
          @click="showAuthDialog = true"
        >
          登录
        </t-button>
        <t-dropdown v-else :options="userMenuOptions" @click="handleUserMenu">
          <t-button variant="text">
            <t-avatar size="small">{{
              authStore.user.email?.charAt(0).toUpperCase()
            }}</t-avatar>
          </t-button>
        </t-dropdown>
      </div>
    </nav>

    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <footer class="app-footer">
      <span>©️版权所有：杨若即 · yangruoji@outlook.com</span>
      <span class="version">v{{ appVersion }}</span>
    </footer>

    <!-- Auth Dialog -->
    <t-dialog
      v-model:visible="showAuthDialog"
      :header="authMode === 'login' ? '登录' : '注册'"
      :footer="false"
      width="400px"
    >
      <t-form
        ref="authForm"
        :data="authData"
        :rules="authRules"
        @submit="handleAuth"
      >
        <t-form-item name="email" label="邮箱">
          <t-input v-model="authData.email" placeholder="请输入邮箱" />
        </t-form-item>
        <t-form-item name="password" label="密码">
          <t-input
            v-model="authData.password"
            type="password"
            placeholder="请输入密码"
          />
        </t-form-item>
        <t-form-item
          v-if="authMode === 'register'"
          name="confirmPassword"
          label="确认密码"
        >
          <t-input
            v-model="authData.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
          />
        </t-form-item>
        <div class="auth-actions">
          <t-button theme="primary" type="submit" :loading="authLoading" block>
            {{ authMode === 'login' ? '登录' : '注册' }}
          </t-button>
          <t-button variant="text" @click="toggleAuthMode" block>
            {{ authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
          </t-button>
        </div>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { useAuthStore } from '@/stores/auth';

const baseUrl = import.meta.env.BASE_URL;
const appVersion = __APP_VERSION__;

const authStore = useAuthStore();
const showAuthDialog = ref(false);
const authMode = ref('login');
const authLoading = ref(false);

const authData = reactive({
  email: '',
  password: '',
  confirmPassword: '',
});

const authRules = {
  email: [
    { required: true, message: '请输入邮箱', type: 'error' },
    { email: true, message: '请输入有效的邮箱地址', type: 'error' },
  ],
  password: [
    { required: true, message: '请输入密码', type: 'error' },
    { min: 6, message: '密码至少6个字符', type: 'error' },
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', type: 'error' },
    {
      validator: (val) => val === authData.password,
      message: '两次密码不一致',
      type: 'error',
    },
  ],
};

const userMenuOptions = [{ content: '退出登录', value: 'logout' }];

const toggleAuthMode = () => {
  authMode.value = authMode.value === 'login' ? 'register' : 'login';
};

const handleAuth = async ({ validateResult }) => {
  if (validateResult !== true) return;

  authLoading.value = true;
  try {
    if (authMode.value === 'login') {
      await authStore.login(authData.email, authData.password);
      MessagePlugin.success('登录成功');
    } else {
      await authStore.register(authData.email, authData.password);
      MessagePlugin.success('注册成功，请查收验证邮件');
    }
    showAuthDialog.value = false;
  } catch (error) {
    MessagePlugin.error(error.message || '操作失败');
  } finally {
    authLoading.value = false;
  }
};

const handleUserMenu = (data) => {
  if (data.value === 'logout') {
    authStore.logout();
    MessagePlugin.success('已退出登录');
  }
};

// Initialize auth state
authStore.init();
</script>

<style lang="scss" scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-main);
}

.app-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  height: 64px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(10px);

  .nav-brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    .brand-icon {
      width: 36px;
      height: 36px;
      animation: float 3s ease-in-out infinite;
    }

    .brand-text {
      font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.5px;
    }
  }

  .nav-links {
    display: flex;
    gap: 0.5rem;

    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      color: var(--text-secondary);
      text-decoration: none;
      transition: all 0.2s;
      font-weight: 500;

      &:hover {
        background: var(--hover-bg);
        color: var(--text-primary);
      }

      &.router-link-active {
        background: var(--accent-bg);
        color: var(--accent-color);
      }
    }
  }
}

.app-main {
  flex: 1;
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.app-footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  border-top: 1px solid var(--border-color);
  background: var(--bg-card);
  
  .version {
    padding: 0.15rem 0.5rem;
    background: var(--hover-bg);
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.75rem;
  }
}

.auth-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.2s ease;
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

// Mobile responsive
@media (max-width: 768px) {
  .app-nav {
    padding: 0 1rem;

    .nav-brand .brand-text {
      display: none;
    }

    .nav-links .nav-link span {
      display: none;
    }
  }

  .app-main {
    padding: 1rem;
  }
}
</style>
