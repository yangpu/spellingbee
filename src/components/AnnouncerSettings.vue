<template>
  <t-dialog
    v-model:visible="visible"
    header="播音员配置"
    :footer="false"
    width="550px"
    :close-on-overlay-click="false"
    @close="handleClose"
  >
    <div class="announcer-settings">
      <!-- 类型选择 -->
      <div class="type-selector">
        <div 
          class="type-card" 
          :class="{ active: localSettings.type === 'human' }"
          @click="localSettings.type = 'human'"
        >
          <div class="type-icon">👤</div>
          <div class="type-label">人物播音员</div>
          <div class="type-desc">使用语音朗读反馈</div>
        </div>
        <div 
          class="type-card" 
          :class="{ active: localSettings.type === 'animal' }"
          @click="localSettings.type = 'animal'"
        >
          <div class="type-icon">🐾</div>
          <div class="type-label">动物播音员</div>
          <div class="type-desc">使用动物音效反馈</div>
        </div>
      </div>

      <!-- 人物配置 -->
      <div class="config-section" v-if="localSettings.type === 'human'">
        <h4>语音反馈设置</h4>
        
        <div class="config-item">
          <label>
            <t-icon name="check-circle" class="icon-success" />
            拼写正确时朗读
          </label>
          <div class="input-with-preview">
            <t-input 
              v-model="localSettings.human.correctPhrase" 
              placeholder="例如: Correct!" 
            />
            <t-button variant="outline" size="small" @click="previewHuman('correct')">
              <template #icon><t-icon name="sound" /></template>
            </t-button>
          </div>
        </div>
        
        <div class="config-item">
          <label>
            <t-icon name="close-circle" class="icon-error" />
            拼写错误时朗读
          </label>
          <div class="input-with-preview">
            <t-input 
              v-model="localSettings.human.incorrectPhrase" 
              placeholder="例如: Incorrect." 
            />
            <t-button variant="outline" size="small" @click="previewHuman('incorrect')">
              <template #icon><t-icon name="sound" /></template>
            </t-button>
          </div>
        </div>
      </div>

      <!-- 动物配置 -->
      <div class="config-section" v-if="localSettings.type === 'animal'">
        <h4>动物音效设置</h4>
        
        <!-- 成功音效 -->
        <div class="animal-config">
          <div class="animal-header">
            <t-icon name="check-circle" class="icon-success" />
            <span>拼写正确</span>
          </div>
          
          <div class="animal-options">
            <div 
              class="animal-option"
              :class="{ active: localSettings.animal.success.type === 'cat' }"
              @click="selectSuccessAnimal('cat')"
            >
              <span class="animal-emoji">🐱</span>
              <span>小猫</span>
            </div>
            <div 
              class="animal-option"
              :class="{ active: localSettings.animal.success.type === 'custom' }"
              @click="selectSuccessAnimal('custom')"
            >
              <span class="animal-emoji">🎵</span>
              <span>自定义</span>
            </div>
          </div>
          
          <div class="sound-preview">
            <t-button variant="outline" size="small" @click="previewSound('success')">
              <template #icon><t-icon name="play-circle" /></template>
              试听
            </t-button>
            <t-upload
              v-if="localSettings.animal.success.type === 'custom'"
              :request-method="(file) => handleUpload(file, 'success')"
              accept="audio/*"
              theme="custom"
            >
              <t-button variant="outline" size="small">
                <template #icon><t-icon name="upload" /></template>
                上传音效
              </t-button>
            </t-upload>
          </div>
        </div>
        
        <!-- 失败音效 -->
        <div class="animal-config">
          <div class="animal-header">
            <t-icon name="close-circle" class="icon-error" />
            <span>拼写错误</span>
          </div>
          
          <div class="animal-options">
            <div 
              class="animal-option"
              :class="{ active: localSettings.animal.failure.type === 'dog' }"
              @click="selectFailureAnimal('dog')"
            >
              <span class="animal-emoji">🐶</span>
              <span>小狗</span>
            </div>
            <div 
              class="animal-option"
              :class="{ active: localSettings.animal.failure.type === 'custom' }"
              @click="selectFailureAnimal('custom')"
            >
              <span class="animal-emoji">🎵</span>
              <span>自定义</span>
            </div>
          </div>
          
          <div class="sound-preview">
            <t-button variant="outline" size="small" @click="previewSound('failure')">
              <template #icon><t-icon name="play-circle" /></template>
              试听
            </t-button>
            <t-upload
              v-if="localSettings.animal.failure.type === 'custom'"
              :request-method="(file) => handleUpload(file, 'failure')"
              accept="audio/*"
              theme="custom"
            >
              <t-button variant="outline" size="small">
                <template #icon><t-icon name="upload" /></template>
                上传音效
              </t-button>
            </t-upload>
          </div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="dialog-footer">
        <t-button variant="outline" @click="resetToDefaults">
          <template #icon><t-icon name="rollback" /></template>
          恢复默认
        </t-button>
        <div class="footer-right">
          <t-button variant="outline" @click="handleClose">
            <template #icon><t-icon name="close" /></template>
            取消
          </t-button>
          <t-button theme="primary" @click="handleSave" :loading="isSaving">
            <template #icon><t-icon name="check" /></template>
            保存设置
          </t-button>
        </div>
      </div>
    </div>
  </t-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useAnnouncerStore } from '@/stores/announcer'
import { useSpeechStore } from '@/stores/speech'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'saved'])

const announcerStore = useAnnouncerStore()
const speechStore = useSpeechStore()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const isSaving = ref(false)

// 本地设置副本
const localSettings = reactive({
  type: 'animal', // 默认动物播音员
  human: {
    correctPhrase: 'Correct!',
    incorrectPhrase: 'Incorrect.'
  },
  animal: {
    success: {
      type: 'cat',
      soundFile: 'meow.wav'
    },
    failure: {
      type: 'dog',
      soundFile: 'bark.wav'
    }
  }
})

// 初始化本地设置
function initLocalSettings() {
  const s = announcerStore.settings
  localSettings.type = s.type
  localSettings.human = { ...s.human }
  localSettings.animal = {
    success: { ...s.animal.success },
    failure: { ...s.animal.failure }
  }
}

// 监听对话框打开
watch(visible, async (val) => {
  if (val) {
    if (!announcerStore.initialized) {
      await announcerStore.init()
    }
    initLocalSettings()
  }
})

// 选择成功动物
function selectSuccessAnimal(type) {
  localSettings.animal.success.type = type
  if (type === 'cat') {
    localSettings.animal.success.soundFile = 'meow.wav'
  }
}

// 选择失败动物
function selectFailureAnimal(type) {
  localSettings.animal.failure.type = type
  if (type === 'dog') {
    localSettings.animal.failure.soundFile = 'bark.wav'
  }
}

// 试听人物语音
async function previewHuman(type) {
  const text = type === 'correct' 
    ? localSettings.human.correctPhrase 
    : localSettings.human.incorrectPhrase
  
  if (text) {
    await speechStore.speakEnglish(text, { rate: 1.0 })
  }
}

// 获取完整音频 URL（用于试听）
function getFullSoundUrl(soundFile) {
  if (soundFile.startsWith('data:') || soundFile.startsWith('http')) {
    return soundFile
  }
  if (soundFile.startsWith('/sounds/')) {
    soundFile = soundFile.replace('/sounds/', '')
  }
  const baseUrl = import.meta.env.BASE_URL || '/'
  return `${baseUrl}sounds/${soundFile}`
}

// 试听动物音效
async function previewSound(type) {
  const soundFile = type === 'success'
    ? localSettings.animal.success.soundFile
    : localSettings.animal.failure.soundFile
  
  try {
    await announcerStore.playSound(getFullSoundUrl(soundFile))
  } catch (e) {
    MessagePlugin.error('播放失败')
  }
}

// 上传自定义音效
async function handleUpload(file, type) {
  try {
    const dataUrl = await announcerStore.uploadCustomSound(file.raw)
    
    if (type === 'success') {
      localSettings.animal.success.soundFile = dataUrl
      localSettings.animal.success.type = 'custom'
    } else {
      localSettings.animal.failure.soundFile = dataUrl
      localSettings.animal.failure.type = 'custom'
    }
    
    MessagePlugin.success('上传成功')
    // TDesign Upload 要求返回 response.url 或 response.files
    return { 
      status: 'success',
      response: {
        url: dataUrl
      }
    }
  } catch (e) {
    MessagePlugin.error('上传失败')
    return { 
      status: 'fail',
      error: e.message || '上传失败'
    }
  }
}

// 恢复默认
function resetToDefaults() {
  localSettings.type = 'animal' // 默认动物播音员
  localSettings.human = {
    correctPhrase: 'Correct!',
    incorrectPhrase: 'Incorrect.'
  }
  localSettings.animal = {
    success: { type: 'cat', soundFile: 'meow.wav' },
    failure: { type: 'dog', soundFile: 'bark.wav' }
  }
  MessagePlugin.success('已恢复默认设置')
}

// 保存设置
async function handleSave() {
  isSaving.value = true
  try {
    announcerStore.updateSettings({
      type: localSettings.type,
      human: { ...localSettings.human },
      animal: {
        success: { ...localSettings.animal.success },
        failure: { ...localSettings.animal.failure }
      }
    })
    
    MessagePlugin.success('播音员设置已保存')
    emit('saved')
    visible.value = false
  } catch (e) {
    MessagePlugin.error('保存失败')
  } finally {
    isSaving.value = false
  }
}

// 关闭
function handleClose() {
  visible.value = false
}
</script>

<style lang="scss" scoped>
.announcer-settings {
  .type-selector {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;

    .type-card {
      flex: 1;
      padding: 1.25rem;
      border: 2px solid var(--border-color);
      border-radius: 12px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        border-color: var(--honey-400);
        background: var(--hover-bg);
      }

      &.active {
        border-color: var(--honey-500);
        background: var(--accent-bg);
      }

      .type-icon {
        font-size: 2.5rem;
        margin-bottom: 0.5rem;
      }

      .type-label {
        font-weight: 600;
        margin-bottom: 0.25rem;
      }

      .type-desc {
        font-size: 0.8rem;
        color: var(--text-secondary);
      }
    }
  }

  .config-section {
    padding: 1rem;
    background: var(--hover-bg);
    border-radius: 12px;
    margin-bottom: 1rem;

    h4 {
      margin: 0 0 1rem 0;
      font-size: 0.95rem;
      color: var(--text-primary);
    }

    .config-item {
      margin-bottom: 1rem;

      &:last-child {
        margin-bottom: 0;
      }

      label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 500;
        margin-bottom: 0.5rem;
        color: var(--text-primary);

        .icon-success {
          color: var(--success);
        }

        .icon-error {
          color: var(--error);
        }
      }

      .input-with-preview {
        display: flex;
        gap: 0.5rem;
      }
    }
  }

  .animal-config {
    padding: 1rem;
    background: var(--bg-card);
    border-radius: 8px;
    margin-bottom: 1rem;

    &:last-child {
      margin-bottom: 0;
    }

    .animal-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 500;
      margin-bottom: 0.75rem;

      .icon-success {
        color: var(--success);
      }

      .icon-error {
        color: var(--error);
      }
    }

    .animal-options {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.75rem;

      .animal-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border: 2px solid var(--border-color);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
          border-color: var(--honey-400);
        }

        &.active {
          border-color: var(--honey-500);
          background: var(--accent-bg);
        }

        .animal-emoji {
          font-size: 1.25rem;
        }
      }
    }

    .sound-preview {
      display: flex;
      gap: 0.5rem;
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1rem;
    margin-top: 1rem;
    border-top: 1px solid var(--border-color);

    .footer-right {
      display: flex;
      gap: 0.75rem;
    }
  }
}

@media (max-width: 640px) {
  .announcer-settings {
    .type-selector {
      flex-direction: column;
    }

    .dialog-footer {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.5rem;

      > .t-button {
        flex: 1;
        min-width: 100px;
      }

      .footer-right {
        display: flex;
        flex: 2;
        gap: 0.5rem;

        .t-button {
          flex: 1;
        }
      }
    }
  }
}
</style>
