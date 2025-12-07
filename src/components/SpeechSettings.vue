<template>
  <t-dialog
    v-model:visible="visible"
    header="语音配置"
    :footer="false"
    width="600px"
    :close-on-overlay-click="false"
    @close="handleClose"
  >
    <div class="speech-settings">
      <!-- 平台信息 -->
      <div class="platform-info">
        <t-tag theme="primary" variant="light">
          {{ platformLabel }}
        </t-tag>
        <div class="voice-counts">
          <span class="voice-count">英文: {{ speechStore.englishVoiceCount }} 个</span>
          <span class="voice-count">中文: {{ speechStore.chineseVoiceCount }} 个</span>
        </div>
      </div>

      <!-- 标签页切换 -->
      <t-tabs v-model="activeTab">
        <t-tab-panel value="english" label="英文语音">
          <div class="voice-config">
            <!-- 语音选择 -->
            <div class="config-item">
              <label>语音音色</label>
              <t-select
                v-model="englishSettings.voice"
                placeholder="选择英文语音"
                filterable
                :loading="speechStore.loading"
                @change="handleEnglishVoiceChange"
              >
                <t-option
                  v-for="voice in speechStore.englishVoices"
                  :key="voice.name"
                  :value="voice.name"
                  :label="`${voice.name} (${voice.lang})`"
                />
              </t-select>
              <span class="config-hint">推荐用于教育场景的清晰发音语音</span>
            </div>

            <!-- 语速 -->
            <div class="config-item slider-item">
              <label>语速 (Rate): {{ englishSettings.rate.toFixed(2) }}</label>
              <t-slider
                v-model="englishSettings.rate"
                :min="0.5"
                :max="1.5"
                :step="0.05"
                :marks="rateMarks"
              />
              <span class="config-hint">学习单词建议使用 0.7-0.9 的较慢语速</span>
            </div>

            <!-- 音高 -->
            <div class="config-item slider-item">
              <label>音高 (Pitch): {{ englishSettings.pitch.toFixed(2) }}</label>
              <t-slider
                v-model="englishSettings.pitch"
                :min="0.5"
                :max="1.5"
                :step="0.05"
                :marks="pitchMarks"
              />
              <span class="config-hint">标准音高为 1.0</span>
            </div>

            <!-- 音量 -->
            <div class="config-item slider-item">
              <label>音量 (Volume): {{ Math.round(englishSettings.volume * 100) }}%</label>
              <t-slider
                v-model="englishSettings.volume"
                :min="0.1"
                :max="1"
                :step="0.1"
                :marks="volumeMarks"
              />
            </div>

            <!-- 试听按钮 -->
            <div class="preview-section">
              <t-button
                variant="outline"
                @click="previewEnglish"
                :loading="isPreviewing"
              >
                <template #icon><t-icon name="sound" /></template>
                试听英文
              </t-button>
              <t-button
                variant="outline"
                @click="previewEnglishWord"
                :loading="isPreviewing"
              >
                <template #icon><t-icon name="play-circle" /></template>
                试听单词
              </t-button>
            </div>
          </div>
        </t-tab-panel>

        <t-tab-panel value="chinese" label="中文语音">
          <div class="voice-config">
            <!-- 语音选择 -->
            <div class="config-item">
              <label>语音音色</label>
              <t-select
                v-model="chineseSettings.voice"
                placeholder="选择中文语音"
                filterable
                :loading="speechStore.loading"
                @change="handleChineseVoiceChange"
              >
                <t-option
                  v-for="voice in speechStore.chineseVoices"
                  :key="voice.name"
                  :value="voice.name"
                  :label="`${voice.name} (${voice.lang})`"
                />
              </t-select>
              <span class="config-hint">用于朗读中文释义</span>
            </div>

            <!-- 语速 -->
            <div class="config-item">
              <label>语速 (Rate): {{ chineseSettings.rate.toFixed(2) }}</label>
              <t-slider
                v-model="chineseSettings.rate"
                :min="0.5"
                :max="1.5"
                :step="0.05"
                :marks="rateMarks"
              />
            </div>

            <!-- 音高 -->
            <div class="config-item">
              <label>音高 (Pitch): {{ chineseSettings.pitch.toFixed(2) }}</label>
              <t-slider
                v-model="chineseSettings.pitch"
                :min="0.5"
                :max="1.5"
                :step="0.05"
                :marks="pitchMarks"
              />
            </div>

            <!-- 音量 -->
            <div class="config-item">
              <label>音量 (Volume): {{ Math.round(chineseSettings.volume * 100) }}%</label>
              <t-slider
                v-model="chineseSettings.volume"
                :min="0.1"
                :max="1"
                :step="0.1"
                :marks="volumeMarks"
              />
            </div>

            <!-- 试听按钮 -->
            <div class="preview-section">
              <t-button
                variant="outline"
                @click="previewChinese"
                :loading="isPreviewing"
              >
                <template #icon><t-icon name="sound" /></template>
                试听中文
              </t-button>
            </div>
          </div>
        </t-tab-panel>
      </t-tabs>

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
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useSpeechStore } from '@/stores/speech'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'saved'])

const speechStore = useSpeechStore()

// 对话框可见性
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 当前标签页
const activeTab = ref('english')

// 本地设置副本（用于编辑）
const englishSettings = reactive({
  voice: null,
  rate: 0.85,
  pitch: 1.0,
  volume: 1.0
})

const chineseSettings = reactive({
  voice: null,
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
})

// 状态
const isPreviewing = ref(false)
const isSaving = ref(false)

// 滑块标记
const rateMarks = {
  0.5: '0.5',
  0.75: '0.75',
  1.0: '1.0',
  1.25: '1.25',
  1.5: '1.5'
}

const pitchMarks = {
  0.5: '低',
  1.0: '标准',
  1.5: '高'
}

const volumeMarks = {
  0.1: '10%',
  0.5: '50%',
  1: '100%'
}

// 平台标签
const platformLabel = computed(() => {
  const p = speechStore.settings.platform
  const osMap = {
    macos: 'macOS',
    windows: 'Windows',
    ios: 'iOS',
    android: 'Android',
    linux: 'Linux'
  }
  const browserMap = {
    chrome: 'Chrome',
    safari: 'Safari',
    firefox: 'Firefox',
    edge: 'Edge'
  }
  return `${osMap[p.os] || p.os} / ${browserMap[p.browser] || p.browser}`
})

// 初始化本地设置
function initLocalSettings() {
  Object.assign(englishSettings, speechStore.settings.english)
  Object.assign(chineseSettings, speechStore.settings.chinese)
}

// 监听对话框打开
watch(visible, async (val) => {
  if (val) {
    // 确保 speechStore 已初始化
    if (!speechStore.initialized) {
      await speechStore.init()
    }
    initLocalSettings()
  }
})

// 语音变化处理
function handleEnglishVoiceChange(val) {
  englishSettings.voice = val
}

function handleChineseVoiceChange(val) {
  chineseSettings.voice = val
}

// 试听英文
async function previewEnglish() {
  isPreviewing.value = true
  try {
    await speechStore.previewEnglish(
      englishSettings.voice,
      englishSettings.rate,
      englishSettings.pitch,
      englishSettings.volume
    )
  } catch (e) {
    console.error('Preview error:', e)
  } finally {
    isPreviewing.value = false
  }
}

// 试听英文单词
async function previewEnglishWord() {
  isPreviewing.value = true
  try {
    // 使用稍慢的语速朗读单词
    const wordRate = Math.max(0.6, englishSettings.rate - 0.15)
    await speechStore.speakEnglish('beautiful', {
      voice: englishSettings.voice,
      rate: wordRate,
      pitch: englishSettings.pitch,
      volume: englishSettings.volume
    })
  } catch (e) {
    console.error('Preview error:', e)
  } finally {
    isPreviewing.value = false
  }
}

// 试听中文
async function previewChinese() {
  isPreviewing.value = true
  try {
    await speechStore.previewChinese(
      chineseSettings.voice,
      chineseSettings.rate,
      chineseSettings.pitch,
      chineseSettings.volume
    )
  } catch (e) {
    console.error('Preview error:', e)
  } finally {
    isPreviewing.value = false
  }
}

// 恢复默认
function resetToDefaults() {
  speechStore.resetToDefaults()
  initLocalSettings()
  MessagePlugin.success('已恢复默认设置')
}

// 保存设置
async function handleSave() {
  isSaving.value = true
  try {
    speechStore.updateEnglishSettings(englishSettings)
    speechStore.updateChineseSettings(chineseSettings)
    await speechStore.saveSettings()
    MessagePlugin.success('语音设置已保存')
    emit('saved')
    visible.value = false
  } catch (e) {
    console.error('Save error:', e)
    MessagePlugin.error('保存失败，请重试')
  } finally {
    isSaving.value = false
  }
}

// 关闭对话框
function handleClose() {
  speechSynthesis.cancel()
  visible.value = false
}

// 组件挂载时初始化
onMounted(async () => {
  if (!speechStore.initialized) {
    await speechStore.init()
  }
})
</script>

<style lang="scss" scoped>
.speech-settings {
  .platform-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    background: var(--hover-bg);
    border-radius: 8px;

    .voice-counts {
      display: flex;
      gap: 1rem;
    }

    .voice-count {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
  }

  .voice-config {
    padding: 1rem 0;

    .config-item {
      margin-bottom: 1.5rem;

      label {
        display: block;
        font-weight: 500;
        margin-bottom: 0.5rem;
        color: var(--text-primary);
      }

      .config-hint {
        display: block;
        margin-top: 0.5rem;
        font-size: 0.8rem;
        color: var(--text-muted);
      }

      :deep(.t-slider) {
        margin-top: 0.5rem;
      }

      &.slider-item {
        .config-hint {
          margin-top: 1.5rem;
        }
      }
    }

    .preview-section {
      display: flex;
      gap: 1rem;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px dashed var(--border-color);
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
  .speech-settings {
    .platform-info {
      flex-direction: column;
      gap: 0.5rem;
      text-align: center;
    }

    .voice-config {
      .preview-section {
        flex-direction: column;
      }
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
