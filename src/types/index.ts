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

// Auth event types
declare global {
  interface WindowEventMap {
    'auth:signed_in': CustomEvent<{ user: User }>
    'auth:signed_out': CustomEvent
  }
}

export {}
