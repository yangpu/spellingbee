<template>
  <div class="app-container">
    <nav class="app-nav">
      <div class="nav-brand" @click="$router.push('/')" style="cursor: pointer;">
        <img :src="`${baseUrl}bee.svg`" alt="Bee" class="brand-icon" />
        <span class="brand-text">Spelling Bee</span>
      </div>
      <div class="nav-links">
        <router-link to="/" class="nav-link home-link">
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
        <router-link to="/challenge" class="nav-link" :class="{ 'router-link-active': isChallengeActive }">
          <t-icon name="usergroup" />
          <span>挑战</span>
        </router-link>
        <router-link to="/words" class="nav-link">
          <t-icon name="book" />
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
        <t-button v-else variant="text" class="user-avatar-btn" @click="showProfileDialog = true">
          <t-avatar size="small" :image="authStore.profile?.avatar_url">
            {{ avatarText }}
          </t-avatar>
          <span class="user-name">{{ displayName }}</span>
        </t-button>
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
      <span>©️版权所有({{ new Date().getFullYear()}})：杨若即 · yangruoji@outlook.com</span>
      <span class="version" @click="forceRefresh" title="点击刷新应用">v{{ appVersion }}</span>
    </footer>

    <!-- Auth Dialog -->
    <t-dialog
      v-model:visible="showAuthDialog"
      :header="dialogHeader()"
      :footer="false"
      width="400px"
      @close="authMode = 'login'"
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
        <t-form-item v-if="authMode !== 'forgot'" name="password" label="密码">
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
            {{ authMode === 'login' ? '登录' : authMode === 'register' ? '注册' : '发送重置邮件' }}
          </t-button>
          <div class="auth-links">
            <t-button variant="text" @click="toggleAuthMode">
              {{ authMode === 'login' ? '没有账号？去注册' : authMode === 'register' ? '已有账号？去登录' : '返回登录' }}
            </t-button>
            <t-button v-if="authMode === 'login'" variant="text" @click="showForgotPassword">
              忘记密码？
            </t-button>
          </div>
        </div>
      </t-form>
    </t-dialog>

    <!-- User Profile Dialog -->
    <UserProfile 
      v-model:visible="showProfileDialog" 
      @logout="handleLogout"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next';
import { useAuthStore } from '@/stores/auth';
import { useWordsStore } from '@/stores/words';
import { useCompetitionStore } from '@/stores/competition';
import { useLearningStore } from '@/stores/learning';
import { useSpeechStore } from '@/stores/speech';
import { notificationService } from '@/lib/network';
import UserProfile from '@/components/UserProfile.vue';

const baseUrl = import.meta.env.BASE_URL;
const appVersion = __APP_VERSION__;

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const wordsStore = useWordsStore();
const competitionStore = useCompetitionStore();
const learningStore = useLearningStore();
const speechStore = useSpeechStore();

// 挑战赛通知取消订阅函数
let unsubscribeNotification = null;
// 通知服务是否已初始化
let notificationInitialized = false;

// 判断挑战路由是否激活（包括 /challenge 和 /challenge/:id）
const isChallengeActive = computed(() => {
  return route.path === '/challenge' || route.path.startsWith('/challenge/')
});

const showAuthDialog = ref(false);
const showProfileDialog = ref(false);
const authMode = ref('login'); // 'login', 'register', 'forgot'
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

// 显示名称
const displayName = computed(() => {
  if (authStore.profile?.nickname) {
    return authStore.profile.nickname;
  }
  return authStore.user?.email?.split('@')[0] || '';
});

// 头像文字
const avatarText = computed(() => {
  if (authStore.profile?.nickname) {
    return authStore.profile.nickname.charAt(0).toUpperCase();
  }
  return authStore.user?.email?.charAt(0).toUpperCase() || '';
});

const toggleAuthMode = () => {
  if (authMode.value === 'login') {
    authMode.value = 'register';
  } else if (authMode.value === 'register') {
    authMode.value = 'login';
  } else {
    authMode.value = 'login';
  }
};

const showForgotPassword = () => {
  authMode.value = 'forgot';
};

const handleAuth = async ({ validateResult }) => {
  if (validateResult !== true) return;

  authLoading.value = true;
  try {
    if (authMode.value === 'login') {
      await authStore.login(authData.email, authData.password);
      MessagePlugin.success('登录成功');
      showAuthDialog.value = false;
      // Sync data after login
      await syncAllData();
    } else if (authMode.value === 'register') {
      await authStore.register(authData.email, authData.password);
      MessagePlugin.success('注册成功，请查收验证邮件后登录');
      authMode.value = 'login';
    } else if (authMode.value === 'forgot') {
      await authStore.resetPassword(authData.email);
      MessagePlugin.success('重置密码邮件已发送，请查收');
      authMode.value = 'login';
    }
  } catch (error) {
    MessagePlugin.error(error.message || '操作失败');
  } finally {
    authLoading.value = false;
  }
};

// 处理退出登录
const handleLogout = () => {
  MessagePlugin.success('已退出登录');
};

// Sync all data from cloud
const syncAllData = async () => {
  if (!authStore.user) return;
  
  try {
    await Promise.all([
      competitionStore.loadRecords(),
      learningStore.syncFromCloud(),
      speechStore.loadFromCloud()
    ]);
  } catch (error) {
    console.error('Sync error:', error);
  }
};

// 初始化挑战赛通知服务
const initNotificationService = async () => {
  if (!authStore.user) return;
  
  // 防止重复初始化
  if (notificationInitialized) {
    return;
  }
  notificationInitialized = true;
  
  try {
    await notificationService.init(authStore.user.id);
    
    // 订阅新挑战赛通知
    unsubscribeNotification = notificationService.addHandler(async (notification) => {
      if (notification.type === 'new_challenge') {
        // 显示新挑战赛通知弹窗
        const challenge = notification.challenge;
        const creatorName = notification.fromUser?.nickname || '未知用户';
        
        const dialog = DialogPlugin.confirm({
          header: '新的挑战赛',
          body: `${creatorName} 创建了挑战赛「${challenge.name}」\n参赛费：${challenge.entry_fee} 积分 | 人数：${challenge.max_participants}人\n是否立即加入？`,
          confirmBtn: '加入挑战',
          cancelBtn: '稍后再说',
          onConfirm: async () => {
            dialog.destroy();
            try {
              // 先导入 challengeStore
              const { useChallengeStore } = await import('@/stores/challenge');
              const challengeStore = useChallengeStore();
              // 加入挑战赛
              await challengeStore.joinChallenge(challenge.id);
              // 跳转到挑战赛房间
              router.push(`/challenge/${challenge.id}`);
              MessagePlugin.success('加入成功');
            } catch (error) {
              MessagePlugin.error(error.message || '加入失败');
            }
          },
          onClose: () => {
            dialog.destroy();
          }
        });
      }
    });
    
    // console.log('[App] Challenge notification service initialized');
  } catch (error) {
    console.error('[App] Failed to init notification service:', error);
    notificationInitialized = false; // 失败时重置，允许重试
  }
};

// 销毁通知服务
const destroyNotificationService = async () => {
  if (unsubscribeNotification) {
    unsubscribeNotification();
    unsubscribeNotification = null;
  }
  await notificationService.disconnect();
  notificationInitialized = false; // 重置初始化标志
};

// Initialize
onMounted(async () => {
  await authStore.init();
  await speechStore.init();
  await wordsStore.init();
  await learningStore.init();
  await competitionStore.loadRecords();
  
  // 初始化挑战赛通知服务（用户已登录时）
  if (authStore.user) {
    await initNotificationService();
  }
});

// Cleanup
onUnmounted(async () => {
  await destroyNotificationService();
});

// Watch for auth changes
watch(() => authStore.user, async (newUser, oldUser) => {
  if (newUser && !oldUser) {
    // User just logged in
    await syncAllData();
    // 初始化挑战赛通知服务
    await initNotificationService();
  } else if (!newUser && oldUser) {
    // User logged out
    await destroyNotificationService();
  }
});

// Dialog header computed
const dialogHeader = () => {
  if (authMode.value === 'login') return '登录';
  if (authMode.value === 'register') return '注册';
  return '忘记密码';
};

// 强制刷新页面
const forceRefresh = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister();
      });
    });
  }
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => {
        caches.delete(name);
      });
    });
  }
  setTimeout(() => {
    window.location.reload(true);
  }, 100);
};
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

  .nav-user {
    .user-avatar-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      
      .user-name {
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.9rem;
        color: var(--text-primary);
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
  padding: 1.5rem;
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
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: var(--accent-bg);
      color: var(--accent-color);
    }

    &:active {
      transform: scale(0.95);
    }
  }
}

.auth-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
  
  .auth-links {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
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

    .nav-links {
      .nav-link span {
        display: none;
      }
      
      .home-link {
        display: none;
      }
    }

    .nav-user .user-avatar-btn .user-name {
      display: none;
    }
  }

  .app-main {
    padding: 1rem;
  }
}
</style>
