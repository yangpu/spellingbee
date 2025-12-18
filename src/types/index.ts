// Word types
export interface Word {
  id: string
  word: string
  pronunciation?: string
  definition: string
  definition_cn?: string
  part_of_speech?: string
  example_sentence?: string
  difficulty: number
  category?: string
  sort_order?: number  // 排序顺序
  created_at?: string
  dictionary_id?: string  // 所属词典ID
}

// Dictionary types - 词典
export interface Dictionary {
  id: string
  name: string
  description?: string
  author?: string
  cover_image?: string
  level: DictionaryLevel
  type: DictionaryType
  word_count: number
  is_public: boolean
  creator_id?: string
  created_at: string
  updated_at: string
}

export type DictionaryLevel = 'primary' | 'junior' | 'senior' | 'cet4' | 'cet6' | 'toefl' | 'ielts' | 'gre' | 'custom'
export type DictionaryType = 'vocabulary' | 'exam' | 'topic' | 'custom'

// 词典等级标签映射
export const DictionaryLevelLabels: Record<DictionaryLevel, string> = {
  'primary': '小学',
  'junior': '初中',
  'senior': '高中',
  'cet4': '大学四级',
  'cet6': '大学六级',
  'toefl': '托福',
  'ielts': '雅思',
  'gre': 'GRE',
  'custom': '自定义'
}

// 词典类型标签映射
export const DictionaryTypeLabels: Record<DictionaryType, string> = {
  'vocabulary': '词汇表',
  'exam': '考试词库',
  'topic': '主题词库',
  'custom': '自定义'
}

// 用户词典选择记录
export interface UserDictionarySelection {
  user_id: string
  dictionary_id: string
  selected_at: string
}

// User types
export interface User {
  id: string
  email?: string
  [key: string]: unknown
}

// User profile
export interface UserProfile {
  id?: string
  user_id: string
  nickname?: string
  avatar_url?: string
  city?: string
  school?: string
  bio?: string
  created_at?: string
  updated_at?: string
}

// Competition types
export interface CompetitionRecord {
  id: string
  score: number
  total_words: number
  correct_words: number
  correct_words_list: string[]
  incorrect_words: string[]
  incorrect_words_detail: { word: string; userAnswer: string }[]
  accuracy: number
  duration: number
  created_at: string
  user_id?: string
  dictionary_id?: string  // 使用的词典ID
  dictionary_name?: string  // 词典名称（冗余存储，便于显示）
}

export interface IncorrectWord extends Word {
  userAnswer: string
}

// Learning types
export interface WordProgress {
  correct_count: number
  incorrect_count: number
  mastery_level: number
  last_practiced_at: string | null
  next_review_at: string | null
  updated_at?: string
}

export interface LearningRecord {
  id: string
  word: string
  is_correct: boolean
  user_answer: string
  study_mode: string
  created_at: string
  user_id?: string
  dictionary_id?: string  // 使用的词典ID
}

export interface LearningSession {
  learnWords: Word[]
  currentIndex: number
  savedAt: number
  autoLearn?: boolean
  masteredWords?: Word[]
  reviewWords?: Word[]
  isFlipped?: boolean
  flipCount?: number
  isAutoLearning?: boolean
  dictionaryId?: string  // 学习时使用的词典ID
  dictionaryName?: string  // 词典名称
}

// Competition session
export interface CompetitionSession {
  words: Word[]
  currentWordIndex: number
  score: number
  correctWords: Word[]
  incorrectWords: IncorrectWord[]
  timeRemaining: number
  totalTime: number
  startTime: number | null
  streak: number
  savedAt: number
  userInput?: string  // 当前单词用户已输入的字母
  dictionaryId?: string  // 比赛时使用的词典ID
  dictionaryName?: string  // 词典名称
}

// Speech types (Legacy - 保持向后兼容)
export interface SpeechSettings {
  english: VoiceSettings
  chinese: VoiceSettings
  spelling: SpellingSettings  // 字母拼读配置
  platform: { os: string; browser: string }
}

export interface VoiceSettings {
  voice: string | null
  rate: number
  pitch: number
  volume: number
}

// 字母拼读配置
export interface SpellingSettings {
  rate: number      // 字母朗读语速 (0.5-2.0)
  pitch: number     // 字母音高 (0.5-1.5)
  interval: number  // 字母之间间隔时间 (毫秒, 50-500)
}

// 新版 TTS 类型从 lib/tts 导出
export type { 
  TTSProviderType,
  TTSLanguage,
  TTSSettings,
  BrowserTTSConfig,
  OnlineTTSConfig,
  AITTSConfig,
  TTSVoice,
  OnlineTTSProvider,
  AITTSProvider
} from '@/lib/tts'

// Announcer types
export interface AnnouncerSettings {
  type: 'human' | 'animal'
  human: {
    correctPhrase: string
    incorrectPhrase: string
    newChallengePhrase?: string
  }
  animal: {
    success: {
      type: string
      soundFile: string
    }
    failure: {
      type: string
      soundFile: string
    }
    newChallenge?: {
      type: string
      soundFile: string
    }
  }
}

// Challenge types
export interface Challenge {
  id: string
  name: string
  description?: string
  image_url?: string
  creator_id: string
  creator_name?: string
  creator_avatar?: string
  max_participants: number
  entry_fee: number // 参赛积分
  word_count: number
  time_limit: number
  difficulty: number | null
  word_mode?: string // 出题模式：simulate, new, wrong, random, sequential, reverse
  challenge_number?: number // 比赛序号
  show_chinese?: boolean // 显示中文词义，默认 true
  show_english?: boolean // 显示英文释义，默认 true
  assisted_input?: boolean // 辅助输入模式，默认 true
  network_mode?: NetworkConnectionType // 网络连接模式
  dictionary_id?: string  // 使用的词典ID
  dictionary_name?: string  // 词典名称
  status: 'waiting' | 'ready' | 'in_progress' | 'finished' | 'cancelled'
  participants: ChallengeParticipant[]
  winner_id?: string
  winner_name?: string
  prize_pool?: number
  game_words?: ChallengeWord[] // 比赛单词记录
  created_at: string
  started_at?: string
  finished_at?: string
}

export interface ChallengeParticipant {
  user_id: string
  nickname: string
  avatar_url?: string
  is_online: boolean
  is_ready: boolean
  score: number
  peer_id?: string
  joined_at: string
  has_left?: boolean // 是否中途退出比赛
  offline_since?: number // 离线开始时间戳（用于显示退赛倒计时）
  exit_countdown?: number // 退赛倒计时剩余秒数（由房主广播，所有客户端同步显示）
}

// 网络连接类型
export type NetworkConnectionType = 'supabase' | 'peerjs'

// 网络连接状态
export type NetworkConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ChallengeWord {
  word: Word
  round: number
  status: 'pending' | 'active' | 'finished'
  winner_id?: string
  results: ChallengeWordResult[]
}

export interface ChallengeWordResult {
  user_id: string
  answer: string
  is_correct: boolean
  time_taken: number // 毫秒
  submitted_at: string
}

export interface ChallengeMessage {
  type: 'join' | 'leave' | 'ready' | 'start' | 'word' | 'answer' | 'round_end' | 'game_end' | 'sync' | 'exit_game' | 'heartbeat' | 'status_broadcast' | 'player_offline' | 'player_online' | 'request_game_state' | 'game_state'
  data: unknown
  sender_id: string
  timestamp: number
}

// Auth event types
declare global {
  interface WindowEventMap {
    'auth:signed_in': CustomEvent<{ user: User }>
    'auth:signed_out': CustomEvent
  }
}

export {}
