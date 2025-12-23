import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// 等级定义
const LEVELS = [
  { name: '见习生', minPoints: 0 },
  { name: '学徒', minPoints: 100 },
  { name: '初学者', minPoints: 300 },
  { name: '进阶者', minPoints: 600 },
  { name: '挑战者', minPoints: 1200 },
  { name: '精英', minPoints: 2000 },
  { name: '专家', minPoints: 3500 },
  { name: '大师', minPoints: 6000 },
  { name: '宗师', minPoints: 10000 },
  { name: '传奇', minPoints: 18000 },
]

// 成就检查条件
const ACHIEVEMENT_CONDITIONS: Record<string, (stats: UserStats) => boolean> = {
  'first_game': (s) => s.competition_total_games >= 1,
  'first_learn': (s) => s.learning_total_practiced >= 1,
  'games_10': (s) => s.competition_total_games >= 10,
  'games_50': (s) => s.competition_total_games >= 50,
  'games_100': (s) => s.competition_total_games >= 100,
  'accuracy_80': (s) => s.competition_best_accuracy >= 80,
  'accuracy_100': (s) => s.competition_best_accuracy >= 100,
  'avg_accuracy_70': (s) => s.competition_average_accuracy >= 70,
  'score_200': (s) => s.competition_best_score >= 200,
  'score_500': (s) => s.competition_best_score >= 500,
  'score_1000': (s) => s.competition_best_score >= 1000,
  'words_100': (s) => s.competition_total_correct >= 100,
  'words_500': (s) => s.competition_total_correct >= 500,
  'words_1000': (s) => s.competition_total_correct >= 1000,
  'mastered_50': (s) => s.learning_mastered_count >= 50,
  'mastered_200': (s) => s.learning_mastered_count >= 200,
  'mastered_500': (s) => s.learning_mastered_count >= 500,
  'points_1000': (s) => s.total_points >= 1000,
  'points_5000': (s) => s.total_points >= 5000,
  'points_10000': (s) => s.total_points >= 10000,
}

interface UserStats {
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
}

interface UpdateRequest {
  type: 'learning' | 'competition' | 'challenge'
  data: LearningData | CompetitionData | ChallengeData
}

interface LearningData {
  is_correct: boolean
  mastered_count?: number
  review_count?: number
  total_learned?: number
}

interface CompetitionData {
  score: number
  total_words: number
  correct_words: number
  accuracy: number
}

interface ChallengeData {
  is_winner: boolean
  entry_fee: number
  prize_pool?: number
}

function getCurrentLevel(points: number): string {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (points >= LEVELS[i].minPoints) {
      return LEVELS[i].name
    }
  }
  return LEVELS[0].name
}

function checkNewAchievements(stats: UserStats, currentAchievements: string[]): string[] {
  const newAchievements: string[] = []
  
  for (const [achievementId, checkFn] of Object.entries(ACHIEVEMENT_CONDITIONS)) {
    if (!currentAchievements.includes(achievementId) && checkFn(stats)) {
      newAchievements.push(achievementId)
    }
  }
  
  return newAchievements
}

function updateLevelUnlocks(
  currentUnlocks: Record<string, string>,
  currentLevel: string,
  newLevel: string
): Record<string, string> {
  const unlocks = { ...currentUnlocks }
  const today = new Date().toISOString().split('T')[0]
  
  // 找到当前等级和新等级的索引
  const currentIndex = LEVELS.findIndex(l => l.name === currentLevel)
  const newIndex = LEVELS.findIndex(l => l.name === newLevel)
  
  // 记录所有新解锁的等级
  for (let i = currentIndex + 1; i <= newIndex; i++) {
    const levelName = LEVELS[i].name
    if (!unlocks[levelName]) {
      unlocks[levelName] = today
    }
  }
  
  return unlocks
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 从 Authorization header 获取用户
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { type, data } = await req.json() as UpdateRequest

    // 获取或创建用户统计记录
    let { data: stats, error: fetchError } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (fetchError && fetchError.code === 'PGRST116') {
      // 记录不存在，创建新记录
      const { data: newStats, error: insertError } = await supabase
        .from('user_stats')
        .insert({ user_id: user.id })
        .select()
        .single()
      
      if (insertError) {
        throw new Error(`Failed to create user stats: ${insertError.message}`)
      }
      stats = newStats
    } else if (fetchError) {
      throw new Error(`Failed to fetch user stats: ${fetchError.message}`)
    }

    const today = new Date().toISOString().split('T')[0]
    const updates: Partial<UserStats> = {}

    // 根据类型更新统计
    if (type === 'learning') {
      const learningData = data as LearningData
      
      // 检查是否需要重置今日统计
      if (stats.learning_today_date !== today) {
        updates.learning_today_practiced = 0
        updates.learning_today_correct = 0
        updates.learning_today_date = today
      }
      
      updates.learning_total_practiced = (stats.learning_total_practiced || 0) + 1
      updates.learning_today_practiced = ((updates.learning_today_practiced ?? stats.learning_today_practiced) || 0) + 1
      
      if (learningData.is_correct) {
        updates.learning_total_correct = (stats.learning_total_correct || 0) + 1
        updates.learning_today_correct = ((updates.learning_today_correct ?? stats.learning_today_correct) || 0) + 1
      } else {
        updates.learning_total_incorrect = (stats.learning_total_incorrect || 0) + 1
      }
      
      // 更新掌握数量等
      if (learningData.mastered_count !== undefined) {
        updates.learning_mastered_count = learningData.mastered_count
      }
      if (learningData.review_count !== undefined) {
        updates.learning_review_count = learningData.review_count
      }
      if (learningData.total_learned !== undefined) {
        updates.learning_total_learned = learningData.total_learned
      }
      
    } else if (type === 'competition') {
      const compData = data as CompetitionData
      
      const newTotalGames = (stats.competition_total_games || 0) + 1
      const newTotalWords = (stats.competition_total_words || 0) + compData.total_words
      const newTotalCorrect = (stats.competition_total_correct || 0) + compData.correct_words
      
      updates.competition_total_games = newTotalGames
      updates.competition_total_words = newTotalWords
      updates.competition_total_correct = newTotalCorrect
      updates.competition_best_score = Math.max(stats.competition_best_score || 0, compData.score)
      updates.competition_best_accuracy = Math.max(stats.competition_best_accuracy || 0, compData.accuracy)
      
      // 计算平均值
      const oldTotalScore = (stats.competition_average_score || 0) * (stats.competition_total_games || 0)
      updates.competition_average_score = (oldTotalScore + compData.score) / newTotalGames
      
      const oldTotalAccuracy = (stats.competition_average_accuracy || 0) * (stats.competition_total_games || 0)
      updates.competition_average_accuracy = (oldTotalAccuracy + compData.accuracy) / newTotalGames
      
    } else if (type === 'challenge') {
      const challengeData = data as ChallengeData
      
      updates.challenge_total_games = (stats.challenge_total_games || 0) + 1
      updates.challenge_total_spent = (stats.challenge_total_spent || 0) + challengeData.entry_fee
      
      if (challengeData.is_winner && challengeData.prize_pool) {
        updates.challenge_wins = (stats.challenge_wins || 0) + 1
        updates.challenge_total_earned = (stats.challenge_total_earned || 0) + challengeData.prize_pool
      }
      
      updates.challenge_net_points = ((updates.challenge_total_earned ?? stats.challenge_total_earned) || 0) - 
                                     ((updates.challenge_total_spent ?? stats.challenge_total_spent) || 0)
    }

    // 计算总积分
    // 比赛积分：总分数
    // 学习积分：每次正确学习得2分，掌握一个单词额外得5分
    // 挑战积分：净收益
    const competitionPoints = type === 'competition' 
      ? (stats.competition_average_score || 0) * (stats.competition_total_games || 0) + (data as CompetitionData).score
      : (stats.competition_average_score || 0) * (stats.competition_total_games || 0)
    
    const learningCorrect = updates.learning_total_correct ?? stats.learning_total_correct ?? 0
    const masteredCount = updates.learning_mastered_count ?? stats.learning_mastered_count ?? 0
    const learningPoints = learningCorrect * 2 + masteredCount * 5
    
    const challengeNetPoints = updates.challenge_net_points ?? stats.challenge_net_points ?? 0
    
    updates.total_points = Math.round(competitionPoints + learningPoints + challengeNetPoints)

    // 更新等级
    const newLevel = getCurrentLevel(updates.total_points)
    if (newLevel !== stats.current_level) {
      updates.current_level = newLevel
      updates.level_unlocks = updateLevelUnlocks(
        stats.level_unlocks || {},
        stats.current_level || '见习生',
        newLevel
      )
    }

    // 检查新成就
    const mergedStats = { ...stats, ...updates } as UserStats
    const currentAchievements = stats.achievements || []
    const newAchievements = checkNewAchievements(mergedStats, currentAchievements)
    
    if (newAchievements.length > 0) {
      updates.achievements = [...currentAchievements, ...newAchievements]
    }

    // 更新数据库
    const { error: updateError } = await supabase
      .from('user_stats')
      .update(updates)
      .eq('user_id', user.id)

    if (updateError) {
      throw new Error(`Failed to update user stats: ${updateError.message}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: { ...stats, ...updates },
        newAchievements,
        levelUp: updates.current_level && updates.current_level !== stats.current_level
          ? { from: stats.current_level, to: updates.current_level }
          : null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error updating user stats:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
