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
  created_at?: string
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
}

export interface LearningSession {
  learnWords: Word[]
  currentIndex: number
  savedAt: number
  autoLearn?: boolean
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
}

// Speech types
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

// Announcer types
export interface AnnouncerSettings {
  type: 'human' | 'animal'
  human: {
    correctPhrase: string
    incorrectPhrase: string
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
  word_mode?: string // 出题模式：simulate, new, random, sequential, reverse
  challenge_number?: number // 比赛序号
  show_chinese?: boolean // 显示中文词义，默认 true
  show_english?: boolean // 显示英文释义，默认 true
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
}

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
  type: 'join' | 'leave' | 'ready' | 'start' | 'word' | 'answer' | 'round_end' | 'game_end' | 'sync' | 'exit_game' | 'heartbeat'
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
