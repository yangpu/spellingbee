<template>
  <t-dialog
    v-model:visible="dialogVisible"
    header="个人信息"
    :footer="false"
    width="500px"
  >
    <div class="user-profile">
      <!-- 用户信息展示 -->
      <div v-if="!isEditing" class="profile-view">
        <div class="profile-header">
          <t-avatar size="80px" :image="authStore.profile?.avatar_url">
            {{ avatarText }}
          </t-avatar>
          <div class="profile-info">
            <h3 class="nickname">{{ displayName }}</h3>
            <p class="email">{{ authStore.user?.email }}</p>
          </div>
          <t-button 
            variant="text" 
            shape="circle" 
            class="network-status-btn"
            @click="showNetworkStatus = true"
          >
            <template #icon>
              <span 
                class="connection-dot" 
                :class="{ connected: supabaseConnected }"
              ></span>
            </template>
          </t-button>
        </div>
        
        <div class="profile-details">
          <div class="detail-item" v-if="authStore.profile?.city">
            <t-icon name="location" />
            <span>{{ authStore.profile.city }}</span>
          </div>
          <div class="detail-item" v-if="authStore.profile?.school">
            <t-icon name="education" />
            <span>{{ authStore.profile.school }}</span>
          </div>
          <div class="detail-item bio" v-if="authStore.profile?.bio">
            <t-icon name="chat" />
            <span>{{ authStore.profile.bio }}</span>
          </div>
          <div class="detail-item user-id">
            <t-icon name="user" />
            <span class="id-text">ID: {{ authStore.user?.id?.slice(0, 8) }}...</span>
          </div>
        </div>
        
        <t-divider />
        
        <div class="profile-actions">
          <t-button variant="outline" @click="isEditing = true">
            <template #icon><t-icon name="edit" /></template>
            编辑资料
          </t-button>
          <t-button variant="outline" @click="handleSync" :loading="syncing">
            <template #icon><t-icon name="refresh" /></template>
            同步数据
          </t-button>
          <t-button variant="outline" theme="danger" @click="handleLogout">
            <template #icon><t-icon name="logout" /></template>
            退出登录
          </t-button>
        </div>

        <t-divider />

        <!-- 系统配置区域 -->
        <SystemSettings 
          @open-speech-settings="showSpeechSettings = true"
          @open-announcer="showAnnouncer = true"
        />
      </div>
      
      <!-- 用户信息编辑 -->
      <div v-else class="profile-edit">
        <div class="edit-header">
          <div class="avatar-section">
            <div class="avatar-upload-wrapper">
              <t-avatar size="80px" :image="profileData.avatar_url || undefined">
                {{ editAvatarText }}
              </t-avatar>
              <t-upload
                :action="''"
                theme="custom"
                accept="image/*"
                :auto-upload="false"
                :show-upload-progress="false"
                :request-method="customUpload"
                @change="handleFileChange"
              >
                <div class="upload-trigger">
                  <t-icon name="camera" />
                </div>
              </t-upload>
              <t-loading v-if="uploading" size="small" class="upload-loading" />
            </div>
            <span class="avatar-tip">点击相机图标上传头像</span>
          </div>
        </div>
        
        <t-form :data="profileData" label-width="80px" class="edit-form">
          <t-form-item label="用户ID">
            <t-input :value="authStore.user?.id" disabled />
          </t-form-item>
          <t-form-item label="邮箱">
            <t-input :value="authStore.user?.email" disabled />
          </t-form-item>
          <t-form-item label="昵称">
            <t-input v-model="profileData.nickname" placeholder="请输入昵称" />
          </t-form-item>
          <t-form-item label="城市">
            <t-input v-model="profileData.city" placeholder="请输入所在城市" />
          </t-form-item>
          <t-form-item label="学校/单位">
            <t-input v-model="profileData.school" placeholder="请输入学校或单位名称" />
          </t-form-item>
          <t-form-item label="个人简介">
            <t-textarea 
              v-model="profileData.bio" 
              placeholder="介绍一下自己吧..." 
              :maxlength="200"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </t-form-item>
        </t-form>
        
        <div class="edit-actions">
          <t-button variant="outline" @click="cancelEdit">取消</t-button>
          <t-button theme="primary" :loading="saving" @click="saveProfile">保存</t-button>
        </div>
      </div>
    </div>

    <!-- 语音配置弹窗 -->
    <SpeechSettings v-model="showSpeechSettings" />
    
    <!-- 播音员弹窗 -->
    <AnnouncerSettings v-model="showAnnouncer" />
    
    <!-- 网络状态弹窗 -->
    <NetworkStatus 
      v-model:visible="showNetworkStatus" 
      :is-logged-in="!!authStore.user" 
    />
  </t-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { UploadFile, RequestMethodResponse } from 'tdesign-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useCompetitionStore } from '@/stores/competition'
import { useLearningStore } from '@/stores/learning'
import { useSpeechStore } from '@/stores/speech'
import { useChallengeNotifications } from '@/lib/network'
import { supabase } from '@/lib/supabase'
import SystemSettings from './SystemSettings.vue'
import SpeechSettings from './SpeechSettings.vue'
import AnnouncerSettings from './AnnouncerSettings.vue'
import NetworkStatus from './NetworkStatus.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'logout'): void
}>()

const authStore = useAuthStore()
const competitionStore = useCompetitionStore()
const learningStore = useLearningStore()
const speechStore = useSpeechStore()

// Supabase 连接状态
const { isConnected: supabaseConnected } = useChallengeNotifications()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const isEditing = ref(false)
const saving = ref(false)
const syncing = ref(false)
const uploading = ref(false)
const showSpeechSettings = ref(false)
const showAnnouncer = ref(false)
const showNetworkStatus = ref(false)

const profileData = reactive({
  nickname: '',
  avatar_url: '',
  city: '',
  school: '',
  bio: ''
})

// 显示名称
const displayName = computed(() => {
  if (authStore.profile?.nickname) {
    return authStore.profile.nickname
  }
  return authStore.user?.email?.split('@')[0] || ''
})

// 头像文字
const avatarText = computed(() => {
  if (authStore.profile?.nickname) {
    return authStore.profile.nickname.charAt(0).toUpperCase()
  }
  return authStore.user?.email?.charAt(0).toUpperCase() || ''
})

// 编辑时的头像文字
const editAvatarText = computed(() => {
  if (profileData.nickname) {
    return profileData.nickname.charAt(0).toUpperCase()
  }
  return authStore.user?.email?.charAt(0).toUpperCase() || ''
})

// 初始化编辑数据
const initEditData = () => {
  if (authStore.profile) {
    profileData.nickname = authStore.profile.nickname || ''
    profileData.avatar_url = authStore.profile.avatar_url || ''
    profileData.city = authStore.profile.city || ''
    profileData.school = authStore.profile.school || ''
    profileData.bio = authStore.profile.bio || ''
  } else {
    profileData.nickname = authStore.user?.email?.split('@')[0] || ''
    profileData.avatar_url = ''
    profileData.city = ''
    profileData.school = ''
    profileData.bio = ''
  }
}

// 监听 isEditing 变化，初始化数据
watch(isEditing, (val) => {
  if (val) {
    initEditData()
  }
})

// 监听 visible 变化，重置状态
watch(() => props.visible, (val) => {
  if (!val) {
    isEditing.value = false
  }
})

// 自定义上传方法（返回空，实际上传在 handleFileChange 中处理）
const customUpload = (): Promise<RequestMethodResponse> => {
  return Promise.resolve({ status: 'success', response: {} })
}

// 处理文件选择
const handleFileChange = async (value: UploadFile[]) => {
  if (!value || value.length === 0) return
  
  const file = value[0]
  if (!file.raw) return
  
  // 检查文件大小（限制 2MB）
  if (file.raw.size > 2 * 1024 * 1024) {
    MessagePlugin.error('图片大小不能超过 2MB')
    return
  }
  
  // 检查文件类型
  if (!file.raw.type.startsWith('image/')) {
    MessagePlugin.error('请选择图片文件')
    return
  }
  
  await uploadAvatar(file.raw)
}

// 上传头像到 Supabase Storage
const uploadAvatar = async (file: File) => {
  if (!authStore.user) return
  
  uploading.value = true
  
  try {
    // 生成唯一文件名
    const fileExt = file.name.split('.').pop()
    const fileName = `${authStore.user.id}-${Date.now()}.${fileExt}`
    const filePath = `avatars/${fileName}`
    
    // 删除旧头像（如果存在）
    if (profileData.avatar_url) {
      const oldPath = profileData.avatar_url.split('/').pop()
      if (oldPath) {
        await supabase.storage.from('avatars').remove([`avatars/${oldPath}`])
      }
    }
    
    // 上传新头像
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError) {
      console.error('Upload error:', uploadError)
      MessagePlugin.error('上传失败，请重试')
      return
    }
    
    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)
    
    if (urlData?.publicUrl) {
      profileData.avatar_url = urlData.publicUrl
      MessagePlugin.success('头像上传成功')
    }
  } catch (error) {
    console.error('Upload error:', error)
    MessagePlugin.error('上传失败，请重试')
  } finally {
    uploading.value = false
  }
}

// 取消编辑
const cancelEdit = () => {
  isEditing.value = false
}

// 保存资料
const saveProfile = async () => {
  saving.value = true
  try {
    const success = await authStore.updateProfile({
      nickname: profileData.nickname,
      avatar_url: profileData.avatar_url,
      city: profileData.city,
      school: profileData.school,
      bio: profileData.bio
    })
    
    if (success) {
      MessagePlugin.success('资料保存成功')
      isEditing.value = false
    } else {
      MessagePlugin.error('保存失败，请重试')
    }
  } catch (error) {
    MessagePlugin.error('保存失败，请重试')
  } finally {
    saving.value = false
  }
}

// 同步数据
const handleSync = async () => {
  syncing.value = true
  try {
    await Promise.all([
      competitionStore.loadRecords(),
      learningStore.syncFromCloud(),
      speechStore.loadFromCloud()
    ])
    MessagePlugin.success('数据同步完成')
  } catch (error) {
    console.error('Sync error:', error)
    MessagePlugin.error('同步失败，请重试')
  } finally {
    syncing.value = false
  }
}

// 退出登录
const handleLogout = async () => {
  await authStore.logout()
  emit('update:visible', false)
  emit('logout')
}
</script>

<style lang="scss" scoped>
.user-profile {
  .profile-view {
    .profile-header {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
      
      .profile-info {
        flex: 1;
        
        .nickname {
          margin: 0 0 0.25rem 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        
        .email {
          margin: 0;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
      }
      
      .network-status-btn {
        flex-shrink: 0;
        
        .connection-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ef4444;
          transition: background-color 0.3s;
          
          &.connected {
            background: #22c55e;
          }
        }
      }
    }
    
    .profile-details {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--bg-main);
      border-radius: 8px;
      
      .detail-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: var(--text-secondary);
        
        .t-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        
        &.bio {
          align-items: flex-start;
          
          span {
            line-height: 1.5;
          }
        }
        
        &.user-id {
          .id-text {
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.8rem;
            color: var(--text-muted);
          }
        }
      }
    }
    
    .profile-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
      
      .t-button {
        flex: 1;
        min-width: 0;
        padding: 0 0.5rem;
        
        :deep(.t-button__text) {
          white-space: nowrap;
        }
      }
    }
  }
  
  .profile-edit {
    .edit-header {
      display: flex;
      justify-content: center;
      margin-bottom: 1.5rem;
      
      .avatar-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        
        .avatar-upload-wrapper {
          position: relative;
          display: inline-block;
          
          .upload-trigger {
            position: absolute;
            bottom: 0;
            right: 0;
            width: 28px;
            height: 28px;
            background: var(--td-brand-color);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
            border: 2px solid var(--bg-card);
            
            .t-icon {
              color: #fff;
              font-size: 14px;
            }
            
            &:hover {
              background: var(--td-brand-color-hover);
              transform: scale(1.1);
            }
          }
          
          .upload-loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
          }
        }
        
        .avatar-tip {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
      }
    }
    
    .edit-form {
      margin-bottom: 1.5rem;
    }
    
    .edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }
  }
}

// Mobile responsive
@media (max-width: 768px) {
  .user-profile {
    .profile-view {
      .profile-header {
        flex-direction: row;
        text-align: left;
        gap: 0.75rem;
        
        .network-status-btn {
          align-self: flex-start;
          margin-top: 0.25rem;
        }
      }
      
      .profile-actions {
        gap: 0.25rem;
        
        .t-button {
          padding: 0 0.25rem;
          font-size: 0.8rem;
          
          :deep(.t-icon) {
            font-size: 14px;
          }
        }
      }
    }
  }
}
</style>
