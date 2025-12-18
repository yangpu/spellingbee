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
      <!-- 语音源选择 -->
      <div class="provider-section">
        <div class="section-header">
          <span class="section-title">语音源</span>
          <div class="cache-info" v-if="cacheStats && cacheStats.count > 0">
            <span class="cache-text">缓存: {{ formatSize(cacheStats.totalSize) }}</span>
            <t-button variant="text" size="small" @click="handleClearCache" :loading="clearingCache">
              <template #icon><t-icon name="delete" size="14px" /></template>
            </t-button>
          </div>
        </div>
        <div class="provider-list">
          <div 
            class="provider-item" 
            :class="{ active: currentProvider === 'browser' }"
            @click="selectProvider('browser')"
          >
            <t-icon name="laptop" />
            <span class="provider-name">浏览器语音</span>
            <t-tag theme="default" size="small" variant="light">默认</t-tag>
          </div>
          
          <div 
            class="provider-item" 
            :class="{ active: currentProvider === 'online' }"
            @click="selectProvider('online')"
          >
            <t-icon name="cloud" />
            <span class="provider-name">在线语音</span>
            <t-tag v-if="!hasOnlineApiKey" theme="warning" size="small" variant="light">需配置</t-tag>
            <t-tag v-else theme="success" size="small" variant="light">已配置</t-tag>
          </div>
          
          <div 
            class="provider-item" 
            :class="{ active: currentProvider === 'ai' }"
            @click="selectProvider('ai')"
          >
            <t-icon name="root-list" />
            <span class="provider-name">AI 语音</span>
            <t-tag v-if="!hasAIApiKey" theme="warning" size="small" variant="light">需配置</t-tag>
            <t-tag v-else theme="success" size="small" variant="light">已配置</t-tag>
          </div>
        </div>
      </div>

      <!-- 浏览器语音配置 -->
      <div class="config-panel" v-show="currentProvider === 'browser'">
        <!-- 平台信息 -->
        <div class="platform-info">
          <t-tag theme="primary" variant="light" size="small">
            {{ platformLabel }}
          </t-tag>
          <div class="voice-counts">
            <span>英文: {{ speechStore.englishVoiceCount }} 个</span>
            <span>中文: {{ speechStore.chineseVoiceCount }} 个</span>
          </div>
        </div>

        <t-tabs v-model="browserLangTab">
          <t-tab-panel value="english" label="英文语音">
            <div class="lang-config">
              <div class="config-item">
                <label>语音音色</label>
                <t-select
                  v-model="browserEnglishConfig.voiceName"
                  placeholder="选择英文语音"
                  filterable
                  :loading="speechStore.loading"
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
              
              <div class="config-item">
                <label>语速: {{ browserEnglishConfig.rate.toFixed(2) }}</label>
                <t-slider v-model="browserEnglishConfig.rate" :min="0.5" :max="1.5" :step="0.05" />
                <span class="config-hint">学习单词建议使用 0.7-0.9 的较慢语速</span>
              </div>
              
              <div class="config-item">
                <label>音高: {{ browserEnglishConfig.pitch.toFixed(2) }}</label>
                <t-slider v-model="browserEnglishConfig.pitch" :min="0.5" :max="1.5" :step="0.05" />
              </div>
              
              <div class="config-item">
                <label>音量: {{ Math.round(browserEnglishConfig.volume * 100) }}%</label>
                <t-slider v-model="browserEnglishConfig.volume" :min="0.1" :max="1" :step="0.1" />
              </div>
              
              <div class="preview-section">
                <t-button variant="outline" size="small" @click="previewBrowserEnglish" :loading="isPreviewing">
                  <template #icon><t-icon name="sound" /></template>
                  试听英文
                </t-button>
                <t-button variant="outline" size="small" @click="previewWord" :loading="isPreviewing">
                  <template #icon><t-icon name="play-circle" /></template>
                  试听单词
                </t-button>
              </div>
            </div>
          </t-tab-panel>
          
          <t-tab-panel value="chinese" label="中文语音">
            <div class="lang-config">
              <div class="config-item">
                <label>语音音色</label>
                <t-select
                  v-model="browserChineseConfig.voiceName"
                  placeholder="选择中文语音"
                  filterable
                  :loading="speechStore.loading"
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
              
              <div class="config-item">
                <label>语速: {{ browserChineseConfig.rate.toFixed(2) }}</label>
                <t-slider v-model="browserChineseConfig.rate" :min="0.5" :max="1.5" :step="0.05" />
              </div>
              
              <div class="config-item">
                <label>音高: {{ browserChineseConfig.pitch.toFixed(2) }}</label>
                <t-slider v-model="browserChineseConfig.pitch" :min="0.5" :max="1.5" :step="0.05" />
              </div>
              
              <div class="config-item">
                <label>音量: {{ Math.round(browserChineseConfig.volume * 100) }}%</label>
                <t-slider v-model="browserChineseConfig.volume" :min="0.1" :max="1" :step="0.1" />
              </div>
              
              <div class="preview-section">
                <t-button variant="outline" size="small" @click="previewBrowserChinese" :loading="isPreviewing">
                  <template #icon><t-icon name="sound" /></template>
                  试听中文
                </t-button>
              </div>
            </div>
          </t-tab-panel>
          
          <t-tab-panel value="spelling" label="字母拼读">
            <div class="lang-config">
              <div class="spelling-intro">
                <t-icon name="info-circle" />
                <span>自动学习模式下逐个字母拼读的语音配置</span>
              </div>
              
              <div class="config-item">
                <label>字母语速: {{ spellingConfig.rate.toFixed(2) }}</label>
                <t-slider v-model="spellingConfig.rate" :min="0.8" :max="2.0" :step="0.05" />
                <span class="config-hint">Windows 建议 1.3-1.6，macOS/iOS 建议 1.0-1.2</span>
              </div>
              
              <div class="config-item">
                <label>字母音高: {{ spellingConfig.pitch.toFixed(2) }}</label>
                <t-slider v-model="spellingConfig.pitch" :min="0.8" :max="1.5" :step="0.05" />
                <span class="config-hint">稍高的音高让字母发音更清晰</span>
              </div>
              
              <div class="config-item">
                <label>字母间隔: {{ spellingConfig.interval }}ms</label>
                <t-slider v-model="spellingConfig.interval" :min="50" :max="400" :step="10" />
                <span class="config-hint">字母之间的停顿时间，Windows 建议 60-100ms</span>
              </div>
              
              <div class="preview-section">
                <t-button variant="outline" size="small" @click="previewSpelling" :loading="isPreviewing">
                  <template #icon><t-icon name="sound" /></template>
                  试听拼读 "APPLE"
                </t-button>
              </div>
            </div>
          </t-tab-panel>
        </t-tabs>
      </div>

      <!-- 在线语音配置 -->
      <div class="config-panel" v-show="currentProvider === 'online'">
        <div class="provider-select">
          <label>选择供应商</label>
          <t-select v-model="onlineProvider" placeholder="选择在线语音供应商">
            <t-option
              v-for="provider in onlineProviders"
              :key="provider.id"
              :value="provider.id"
              :label="provider.name"
            >
              <div class="provider-option">
                <span>{{ provider.name }}</span>
                <t-tag v-if="provider.free" theme="success" size="small" variant="light">免费试用</t-tag>
              </div>
            </t-option>
          </t-select>
        </div>
        
        <div class="provider-detail" v-if="selectedOnlineProvider">
          <div class="provider-meta">
            <a :href="selectedOnlineProvider.website" target="_blank" class="provider-link">
              <t-icon name="link" size="14px" />
              {{ selectedOnlineProvider.name }} 官网
            </a>
            <span class="provider-desc">{{ selectedOnlineProvider.description }}</span>
          </div>
          
          <div class="api-config" v-if="!selectedOnlineProvider.free">
            <div class="config-item">
              <label>API Key</label>
              <t-input
                v-model="onlineEnglishConfig.apiKey"
                type="password"
                :placeholder="getOnlineApiKeyPlaceholder"
                clearable
              />
              <span class="config-hint">{{ getOnlineApiKeyHint }}</span>
            </div>
          </div>
          
          <t-tabs v-model="onlineLangTab">
            <t-tab-panel value="english" label="英文语音">
              <div class="lang-config">
                <div class="config-item">
                  <label>语音音色</label>
                  <t-select v-model="onlineEnglishConfig.voiceId" placeholder="选择语音">
                    <t-option
                      v-for="voice in onlineEnglishVoices"
                      :key="voice.id"
                      :value="voice.id"
                      :label="voice.name"
                    />
                  </t-select>
                </div>
                
                <div class="config-item">
                  <label>语速: {{ onlineEnglishConfig.rate.toFixed(2) }}</label>
                  <t-slider v-model="onlineEnglishConfig.rate" :min="0.5" :max="2.0" :step="0.1" />
                </div>
                
                <div class="preview-section">
                  <t-button 
                    variant="outline" 
                    size="small"
                    @click="previewOnlineEnglish" 
                    :loading="isPreviewing"
                  >
                    <template #icon><t-icon name="sound" /></template>
                    试听英文
                  </t-button>
                </div>
              </div>
            </t-tab-panel>
            
            <t-tab-panel value="chinese" label="中文语音">
              <div class="lang-config">
                <div class="config-item">
                  <label>语音音色</label>
                  <t-select v-model="onlineChineseConfig.voiceId" placeholder="选择语音">
                    <t-option
                      v-for="voice in onlineChineseVoices"
                      :key="voice.id"
                      :value="voice.id"
                      :label="voice.name"
                    />
                  </t-select>
                </div>
                
                <div class="config-item">
                  <label>语速: {{ onlineChineseConfig.rate.toFixed(2) }}</label>
                  <t-slider v-model="onlineChineseConfig.rate" :min="0.5" :max="2.0" :step="0.1" />
                </div>
                
                <div class="preview-section">
                  <t-button 
                    variant="outline" 
                    size="small"
                    @click="previewOnlineChinese" 
                    :loading="isPreviewing"
                  >
                    <template #icon><t-icon name="sound" /></template>
                    试听中文
                  </t-button>
                </div>
              </div>
            </t-tab-panel>
          </t-tabs>
        </div>
      </div>

      <!-- AI 语音配置 -->
      <div class="config-panel" v-show="currentProvider === 'ai'">
        <div class="provider-select">
          <label>选择供应商</label>
          <t-select v-model="aiProvider" placeholder="选择 AI 语音供应商">
            <t-option
              v-for="provider in aiProviders"
              :key="provider.id"
              :value="provider.id"
              :label="provider.name"
            >
              <div class="provider-option">
                <span>{{ provider.name }}</span>
                <t-tag v-if="provider.free" theme="success" size="small" variant="light">免费试用</t-tag>
              </div>
            </t-option>
          </t-select>
        </div>
        
        <div class="provider-detail" v-if="selectedAIProvider">
          <div class="provider-meta">
            <a :href="selectedAIProvider.website" target="_blank" class="provider-link">
              <t-icon name="link" size="14px" />
              {{ selectedAIProvider.name }} 官网
            </a>
            <span class="provider-desc">{{ selectedAIProvider.description }}</span>
          </div>
          
          <div class="api-config" v-if="!selectedAIProvider.free">
            <div class="config-item">
              <label>API Key</label>
              <t-input
                v-model="aiEnglishConfig.apiKey"
                type="password"
                :placeholder="getAIApiKeyPlaceholder"
                clearable
              />
              <span class="config-hint">{{ getAIApiKeyHint }}</span>
            </div>
          </div>
          
          <t-tabs v-model="aiLangTab">
            <t-tab-panel value="english" label="英文语音">
              <div class="lang-config">
                <div class="config-item">
                  <label>语音音色</label>
                  <t-select v-model="aiEnglishConfig.voiceId" placeholder="选择语音">
                    <t-option
                      v-for="voice in aiEnglishVoices"
                      :key="voice.id"
                      :value="voice.id"
                      :label="voice.name"
                    />
                  </t-select>
                </div>
                
                <div class="config-item">
                  <label>语速: {{ aiEnglishConfig.rate.toFixed(2) }}</label>
                  <t-slider v-model="aiEnglishConfig.rate" :min="0.5" :max="2.0" :step="0.1" />
                </div>
                
                <div class="preview-section">
                  <t-button 
                    variant="outline" 
                    size="small"
                    @click="previewAIEnglish" 
                    :loading="isPreviewing"
                  >
                    <template #icon><t-icon name="sound" /></template>
                    试听英文
                  </t-button>
                </div>
              </div>
            </t-tab-panel>
            
            <t-tab-panel value="chinese" label="中文语音">
              <div class="lang-config">
                <div class="config-item">
                  <label>语音音色</label>
                  <t-select v-model="aiChineseConfig.voiceId" placeholder="选择语音">
                    <t-option
                      v-for="voice in aiChineseVoices"
                      :key="voice.id"
                      :value="voice.id"
                      :label="voice.name"
                    />
                  </t-select>
                </div>
                
                <div class="config-item">
                  <label>语速: {{ aiChineseConfig.rate.toFixed(2) }}</label>
                  <t-slider v-model="aiChineseConfig.rate" :min="0.5" :max="2.0" :step="0.1" />
                </div>
                
                <div class="preview-section">
                  <t-button 
                    variant="outline" 
                    size="small"
                    @click="previewAIChinese" 
                    :loading="isPreviewing"
                  >
                    <template #icon><t-icon name="sound" /></template>
                    试听中文
                  </t-button>
                </div>
              </div>
            </t-tab-panel>
          </t-tabs>
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

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useSpeechStore } from '@/stores/speech'
import type { 
  TTSProviderType, 
  BrowserTTSConfig, 
  OnlineTTSConfig, 
  AITTSConfig,
  OnlineTTSProvider,
  AITTSProvider
} from '@/lib/tts'

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

// 状态
const isPreviewing = ref(false)
const isSaving = ref(false)
const clearingCache = ref(false)
const cacheStats = ref<{ count: number; totalSize: number } | null>(null)

// 标签页
const browserLangTab = ref('english')
const onlineLangTab = ref('english')
const aiLangTab = ref('english')

// 当前语音源
const currentProvider = ref<TTSProviderType>('browser')

// 浏览器语音配置
const browserEnglishConfig = reactive<BrowserTTSConfig>({
  voiceName: null,
  rate: 0.85,
  pitch: 1.0,
  volume: 1.0
})

const browserChineseConfig = reactive<BrowserTTSConfig>({
  voiceName: null,
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
})

const spellingConfig = reactive({
  rate: 1.1,
  pitch: 1.1,
  interval: 120
})

// 在线语音配置
const onlineProvider = ref<OnlineTTSProvider>('tencent')
const onlineEnglishConfig = reactive<OnlineTTSConfig>({
  provider: 'tencent',
  voiceId: '101051',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
})

const onlineChineseConfig = reactive<OnlineTTSConfig>({
  provider: 'tencent',
  voiceId: '101001',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
})

// AI 语音配置
const aiProvider = ref<AITTSProvider>('doubao')
const aiEnglishConfig = reactive<AITTSConfig>({
  provider: 'doubao',
  voiceId: 'BV503_streaming',
  model: 'tts-1',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
})

const aiChineseConfig = reactive<AITTSConfig>({
  provider: 'doubao',
  voiceId: 'BV700_streaming',
  model: 'tts-1',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
})

// 供应商列表（免费的排在前面）
const onlineProviders = computed(() => {
  const providers = speechStore.getOnlineProviders()
  // 按 free 属性排序，免费的在前面
  return [...providers].sort((a, b) => {
    if (a.free && !b.free) return -1
    if (!a.free && b.free) return 1
    return 0
  })
})

const aiProviders = computed(() => {
  const providers = speechStore.getAIProviders()
  return [...providers].sort((a, b) => {
    if (a.free && !b.free) return -1
    if (!a.free && b.free) return 1
    return 0
  })
})

// 当前选中的供应商详情
const selectedOnlineProvider = computed(() => 
  onlineProviders.value.find(p => p.id === onlineProvider.value)
)

const selectedAIProvider = computed(() => 
  aiProviders.value.find(p => p.id === aiProvider.value)
)

// 供应商语音列表
const onlineEnglishVoices = computed(() => 
  selectedOnlineProvider.value?.voices.filter(v => v.language === 'en') || []
)

const onlineChineseVoices = computed(() => 
  selectedOnlineProvider.value?.voices.filter(v => v.language === 'zh') || []
)

const aiEnglishVoices = computed(() => 
  selectedAIProvider.value?.voices.filter(v => v.language === 'en') || []
)

const aiChineseVoices = computed(() => 
  selectedAIProvider.value?.voices.filter(v => v.language === 'zh') || []
)

// 检查是否配置了 API Key（免费供应商不需要 API Key）
const hasOnlineApiKey = computed(() => {
  const provider = selectedOnlineProvider.value
  if (provider?.free) return true
  return !!onlineEnglishConfig.apiKey
})

const hasAIApiKey = computed(() => {
  const provider = selectedAIProvider.value
  if (provider?.free) return true
  return !!aiEnglishConfig.apiKey
})

// API Key 格式提示
const getOnlineApiKeyPlaceholder = computed(() => {
  // 目前只有腾讯云
  return '格式: AppId:SecretId:SecretKey'
})

const getOnlineApiKeyHint = computed(() => {
  // 目前只有腾讯云
  return '留空则使用默认配置。格式示例: 1234567890:AKIDxxxxx:xxxSecretKeyxxx'
})

const getAIApiKeyPlaceholder = computed(() => {
  // 目前只有豆包
  return '格式: AppId:Token 或 AppId:Token:Cluster'
})

const getAIApiKeyHint = computed(() => {
  // 目前只有豆包
  return '从火山引擎控制台获取 AppId 和 Token'
})

// 平台标签
const platformLabel = computed(() => {
  const p = speechStore.ttsSettings.platform
  const osMap: Record<string, string> = {
    macos: 'macOS',
    windows: 'Windows',
    ios: 'iOS',
    android: 'Android',
    linux: 'Linux'
  }
  const browserMap: Record<string, string> = {
    chrome: 'Chrome',
    safari: 'Safari',
    firefox: 'Firefox',
    edge: 'Edge'
  }
  return `${osMap[p.os] || p.os} / ${browserMap[p.browser] || p.browser}`
})

// 格式化大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 初始化配置
function initConfigs() {
  const settings = speechStore.ttsSettings
  
  currentProvider.value = settings.activeProvider
  
  // 浏览器配置
  Object.assign(browserEnglishConfig, settings.english.browser)
  Object.assign(browserChineseConfig, settings.chinese.browser)
  Object.assign(spellingConfig, settings.spelling)
  
  // 在线配置
  Object.assign(onlineEnglishConfig, settings.english.online)
  Object.assign(onlineChineseConfig, settings.chinese.online)
  onlineProvider.value = settings.english.online.provider
  
  // AI 配置
  Object.assign(aiEnglishConfig, settings.english.ai)
  Object.assign(aiChineseConfig, settings.chinese.ai)
  aiProvider.value = settings.english.ai.provider
}

// 加载缓存统计
async function loadCacheStats() {
  try {
    cacheStats.value = await speechStore.getCacheStats()
  } catch (e) {
    console.error('Failed to load cache stats:', e)
  }
}

// 选择语音源
function selectProvider(provider: TTSProviderType) {
  currentProvider.value = provider
}

// 清理缓存
async function handleClearCache() {
  clearingCache.value = true
  try {
    await speechStore.clearCache()
    await loadCacheStats()
    MessagePlugin.success('缓存已清理')
  } catch (e) {
    MessagePlugin.error('清理缓存失败')
  } finally {
    clearingCache.value = false
  }
}

// 试听方法
async function previewBrowserEnglish() {
  isPreviewing.value = true
  try {
    await speechStore.previewEnglish(
      browserEnglishConfig.voiceName || undefined,
      browserEnglishConfig.rate,
      browserEnglishConfig.pitch,
      browserEnglishConfig.volume
    )
  } finally {
    isPreviewing.value = false
  }
}

async function previewBrowserChinese() {
  isPreviewing.value = true
  try {
    await speechStore.previewChinese(
      browserChineseConfig.voiceName || undefined,
      browserChineseConfig.rate,
      browserChineseConfig.pitch,
      browserChineseConfig.volume
    )
  } finally {
    isPreviewing.value = false
  }
}

async function previewWord() {
  isPreviewing.value = true
  try {
    const wordRate = Math.max(0.6, browserEnglishConfig.rate - 0.15)
    await speechStore.speakEnglish('beautiful', {
      voice: browserEnglishConfig.voiceName || undefined,
      rate: wordRate,
      pitch: browserEnglishConfig.pitch,
      volume: browserEnglishConfig.volume
    })
  } finally {
    isPreviewing.value = false
  }
}

async function previewSpelling() {
  isPreviewing.value = true
  try {
    const letters = 'APPLE'.split('')
    for (let i = 0; i < letters.length; i++) {
      await speechStore.speakEnglish(letters[i], {
        rate: spellingConfig.rate,
        pitch: spellingConfig.pitch
      })
      if (i < letters.length - 1) {
        await new Promise(resolve => setTimeout(resolve, spellingConfig.interval))
      }
    }
  } finally {
    isPreviewing.value = false
  }
}

async function previewOnlineEnglish() {
  isPreviewing.value = true
  try {
    // 临时更新配置（不保存到云端）
    speechStore.updateOnlineSettings('en', onlineEnglishConfig, false)
    speechStore.setLanguageProvider('en', 'online', false)
    await speechStore.speakEnglish('Hello, this is a test of the online English voice.')
  } catch (e: any) {
    MessagePlugin.error(e.message || '试听失败')
  } finally {
    isPreviewing.value = false
  }
}

async function previewOnlineChinese() {
  isPreviewing.value = true
  try {
    // 临时更新配置（不保存到云端）
    speechStore.updateOnlineSettings('zh', onlineChineseConfig, false)
    speechStore.setLanguageProvider('zh', 'online', false)
    await speechStore.speakChinese('你好，这是在线中文语音测试。')
  } catch (e: any) {
    MessagePlugin.error(e.message || '试听失败')
  } finally {
    isPreviewing.value = false
  }
}

async function previewAIEnglish() {
  isPreviewing.value = true
  try {
    // 临时更新配置（不保存到云端）
    speechStore.updateAISettings('en', aiEnglishConfig, false)
    speechStore.setLanguageProvider('en', 'ai', false)
    await speechStore.speakEnglish('Hello, this is a test of the AI English voice.')
  } catch (e: any) {
    MessagePlugin.error(e.message || '试听失败')
  } finally {
    isPreviewing.value = false
  }
}

async function previewAIChinese() {
  isPreviewing.value = true
  try {
    // 临时更新配置（不保存到云端）
    speechStore.updateAISettings('zh', aiChineseConfig, false)
    speechStore.setLanguageProvider('zh', 'ai', false)
    await speechStore.speakChinese('你好，这是AI中文语音测试。')
  } catch (e: any) {
    MessagePlugin.error(e.message || '试听失败')
  } finally {
    isPreviewing.value = false
  }
}

// 恢复默认
function resetToDefaults() {
  speechStore.resetToDefaults()
  initConfigs()
  MessagePlugin.success('已恢复默认设置')
}

// 保存设置
async function handleSave() {
  isSaving.value = true
  try {
    // 更新所有配置（不自动保存，最后统一保存一次）
    speechStore.setActiveProvider(currentProvider.value, false)
    
    // 浏览器配置
    speechStore.updateEnglishSettings(browserEnglishConfig, false)
    speechStore.updateChineseSettings(browserChineseConfig, false)
    speechStore.updateSpellingSettings(spellingConfig, false)
    
    // 在线配置
    onlineEnglishConfig.provider = onlineProvider.value
    onlineChineseConfig.provider = onlineProvider.value
    speechStore.updateOnlineSettings('en', onlineEnglishConfig, false)
    speechStore.updateOnlineSettings('zh', onlineChineseConfig, false)
    
    // AI 配置
    aiEnglishConfig.provider = aiProvider.value
    aiChineseConfig.provider = aiProvider.value
    speechStore.updateAISettings('en', aiEnglishConfig, false)
    speechStore.updateAISettings('zh', aiChineseConfig, false)
    
    // 设置语言对应的语音源
    if (currentProvider.value === 'browser') {
      speechStore.setLanguageProvider('en', 'browser', false)
      speechStore.setLanguageProvider('zh', 'browser', false)
    } else if (currentProvider.value === 'online') {
      speechStore.setLanguageProvider('en', 'online', false)
      speechStore.setLanguageProvider('zh', 'online', false)
    } else if (currentProvider.value === 'ai') {
      speechStore.setLanguageProvider('en', 'ai', false)
      speechStore.setLanguageProvider('zh', 'ai', false)
    }
    
    // 统一保存一次
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
  speechStore.stop()
  visible.value = false
}

// 监听对话框打开
watch(visible, async (val) => {
  if (val) {
    if (!speechStore.initialized) {
      await speechStore.init()
    }
    initConfigs()
    loadCacheStats()
  }
})

// 监听在线供应商变化
watch(onlineProvider, (newProvider) => {
  onlineEnglishConfig.provider = newProvider
  onlineChineseConfig.provider = newProvider
  const provider = onlineProviders.value.find(p => p.id === newProvider)
  if (provider) {
    const enVoice = provider.voices.find(v => v.language === 'en')
    const zhVoice = provider.voices.find(v => v.language === 'zh')
    if (enVoice) onlineEnglishConfig.voiceId = enVoice.id
    if (zhVoice) onlineChineseConfig.voiceId = zhVoice.id
  }
})

// 同步在线语音的 API Key 和 Region（中英文共享同一配置）
watch(() => onlineEnglishConfig.apiKey, (newKey) => {
  onlineChineseConfig.apiKey = newKey
})
watch(() => onlineEnglishConfig.region, (newRegion) => {
  onlineChineseConfig.region = newRegion
})

// 监听 AI 供应商变化
watch(aiProvider, (newProvider) => {
  aiEnglishConfig.provider = newProvider
  aiChineseConfig.provider = newProvider
  const provider = aiProviders.value.find(p => p.id === newProvider)
  if (provider) {
    const enVoice = provider.voices.find(v => v.language === 'en')
    const zhVoice = provider.voices.find(v => v.language === 'zh')
    if (enVoice) aiEnglishConfig.voiceId = enVoice.id
    if (zhVoice) aiChineseConfig.voiceId = zhVoice.id
    if (provider.models.length > 0) {
      aiEnglishConfig.model = provider.models[0]
      aiChineseConfig.model = provider.models[0]
    }
  }
})

// 同步 AI 语音的 API Key 和 baseUrl（中英文共享同一配置）
watch(() => aiEnglishConfig.apiKey, (newKey) => {
  aiChineseConfig.apiKey = newKey
})
watch(() => aiEnglishConfig.baseUrl, (newUrl) => {
  aiChineseConfig.baseUrl = newUrl
})

onMounted(async () => {
  if (!speechStore.initialized) {
    await speechStore.init()
  }
})
</script>

<style lang="scss" scoped>
.speech-settings {
  .provider-section {
    margin-bottom: 1rem;

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;

      .section-title {
        font-weight: 500;
        color: var(--text-secondary);
        font-size: 0.9rem;
      }

      .cache-info {
        display: flex;
        align-items: center;
        gap: 0.25rem;

        .cache-text {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
      }
    }

    .provider-list {
      display: flex;
      gap: 0.5rem;

      .provider-item {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        background: var(--bg-card);

        .t-icon {
          color: var(--text-secondary);
          font-size: 1rem;
        }

        .provider-name {
          flex: 1;
          font-size: 0.85rem;
          white-space: nowrap;
        }

        &:hover {
          border-color: var(--brand-color);
          background: var(--hover-bg);
        }

        &.active {
          border-color: var(--brand-color);
          background: var(--brand-color-light, rgba(var(--brand-color-rgb), 0.1));

          .t-icon {
            color: var(--brand-color);
          }

          .provider-name {
            color: var(--brand-color);
            font-weight: 500;
          }
        }
      }
    }
  }

  .config-panel {
    background: var(--hover-bg);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .platform-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-card);
    border-radius: 6px;

    .voice-counts {
      display: flex;
      gap: 1rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
  }

  .lang-config {
    padding: 0.75rem 0;
  }

  .config-item {
    margin-bottom: 1.25rem;

    label {
      display: block;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: var(--text-primary);
      font-size: 0.9rem;
    }

    .config-hint {
      display: block;
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    :deep(.t-slider) {
      margin-top: 0.5rem;
    }
  }

  .preview-section {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border-color);
  }

  .spelling-intro {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-card);
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.85rem;
    color: var(--text-secondary);

    .t-icon {
      color: var(--brand-color);
    }
  }

  .provider-select {
    margin-bottom: 1rem;

    label {
      display: block;
      font-weight: 500;
      margin-bottom: 0.5rem;
      font-size: 0.9rem;
    }

    .provider-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }
  }

  .provider-detail {
    .provider-meta {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border-color);

      .provider-link {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        color: var(--brand-color);
        font-size: 0.85rem;
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }
      }

      .provider-desc {
        font-size: 0.8rem;
        color: var(--text-muted);
      }
    }

    .api-config {
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border-color);

      .config-item {
        margin-bottom: 0.75rem;

        &:last-child {
          margin-bottom: 0;
        }
      }
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);

    .footer-right {
      display: flex;
      gap: 0.75rem;
    }
  }

  // 修复 tabs 样式
  :deep(.t-tabs) {
    .t-tabs__nav {
      background: transparent;
    }

    .t-tabs__nav-item {
      &.t-is-active {
        background: var(--bg-card);
      }
    }
  }
}

@media (max-width: 640px) {
  .speech-settings {
    .provider-section {
      .provider-list {
        flex-direction: column;

        .provider-item {
          .provider-name {
            flex: 1;
          }
        }
      }
    }

    .platform-info {
      flex-direction: column;
      gap: 0.5rem;
      text-align: center;
    }

    .preview-section {
      flex-direction: column;
    }

    .dialog-footer {
      flex-wrap: wrap;
      gap: 0.5rem;

      > .t-button {
        flex: 1;
        min-width: 100px;
      }

      .footer-right {
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
