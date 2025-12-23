/**
 * 用户统计服务
 * 负责与 Supabase Edge Function 通信，更新和获取用户统计数据
 */

import { supabase } from '@/lib/supabase'

// 统计更新类型
export type StatsUpdateType = 'learning' | 'competition' | 'challenge'

// 学习数据
export interface LearningStatsData {
  is_correct: boolean
  mastered_count?: number
  review_count?: number
  total_learned?: number
}

// 比赛数据
export interface CompetitionStatsData {
  score: number
  total_words: number
  correct_words: number
  accuracy: number
}

// 挑战赛数据
export interface ChallengeStatsData {
  is_winner: boolean
  entry_fee: number
  prize_pool?: number
}

// 用户统计数据
export interface UserStats {
  user_id: string
  total_points: number
  current_level: string
  level_unlocks: Record<string, string>
  learning_total_practiced: number
  learning_total_correct: number
  learning_total_incorrect: number
  learning_today_practiced: number
  learning_today_correct: number
  learning_today_date: string | null
  learning_mastered_count: number
  learning_review_count: number
  learning_total_learned: number
  competition_total_games: number
  competition_total_words: number
  competition_total_correct: number
  competition_best_score: number
  competition_best_accuracy: number
  competition_average_score: number
  competition_average_accuracy: number
  challenge_total_games: number
  challenge_wins: number
  challenge_total_earned: number
  challenge_total_spent: number
  challenge_net_points: number
  achievements: string[]
  created_at: string
  updated_at: string
}

// 更新响应
export interface StatsUpdateResponse {
  success: boolean
  stats: UserStats
  newAchievements: string[]
  levelUp: { from: string; to: string } | null
}

// Edge Function URL
const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-stats`

/**
 * 更新用户统计
 */
export async function updateUserStats(
  type: 'learning',
  data: LearningStatsData
): Promise<StatsUpdateResponse | null>
export async function updateUserStats(
  type: 'competition',
  data: CompetitionStatsData
): Promise<StatsUpdateResponse | null>
export async function updateUserStats(
  type: 'challenge',
  data: ChallengeStatsData
): Promise<StatsUpdateResponse | null>
export async function updateUserStats(
  type: StatsUpdateType,
  data: LearningStatsData | CompetitionStatsData | ChallengeStatsData
): Promise<StatsUpdateResponse | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      console.log('用户未登录，跳过统计更新')
      return null
    }

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ type, data }),
    })

    if (!response.ok) {
      const error = await response.json()
      console.error('更新统计失败:', error)
      return null
    }

    const result = await response.json() as StatsUpdateResponse
    
    // 如果有新成就或升级，可以在这里触发通知
    if (result.newAchievements?.length > 0) {
      console.log('🎉 解锁新成就:', result.newAchievements)
    }
    if (result.levelUp) {
      console.log('🎊 等级提升:', result.levelUp.from, '->', result.levelUp.to)
    }

    return result
  } catch (error) {
    console.error('更新统计出错:', error)
    return null
  }
}

/**
 * 获取用户统计数据
 */
export async function getUserStats(): Promise<UserStats | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return null
    }

    const { data, error } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (error) {
      console.error('获取统计失败:', error)
      return null
    }

    // maybeSingle() 在没有记录时返回 null，不会报错
    return data as UserStats | null
  } catch (error) {
    console.error('获取统计出错:', error)
    return null
  }
}

/**
 * 获取成就列表
 */
export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  category: string
  condition_type: string
  condition_value: number
  sort_order: number
}

export async function getAchievements(): Promise<Achievement[]> {
  try {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .order('sort_order')

    if (error) {
      console.error('获取成就列表失败:', error)
      return []
    }

    return data as Achievement[]
  } catch (error) {
    console.error('获取成就列表出错:', error)
    return []
  }
}

/**
 * 批量更新学习统计（用于同步本地数据）
 */
export async function syncLearningStats(
  masteredCount: number,
  reviewCount: number,
  totalLearned: number
): Promise<StatsUpdateResponse | null> {
  return updateUserStats('learning', {
    is_correct: false, // 不增加练习次数，只同步数量
    mastered_count: masteredCount,
    review_count: reviewCount,
    total_learned: totalLearned,
  })
}
