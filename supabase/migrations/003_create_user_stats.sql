-- 用户统计表
-- 存储用户的学习进度、比赛统计、挑战赛统计、等级和成就信息

CREATE TABLE IF NOT EXISTS user_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- 等级和积分
  total_points INTEGER DEFAULT 0,
  current_level VARCHAR(50) DEFAULT '见习生',
  level_unlocks JSONB DEFAULT '{}',  -- 等级解锁时间记录 { "见习生": "2024-01-01", ... }
  
  -- 学习统计
  learning_total_practiced INTEGER DEFAULT 0,
  learning_total_correct INTEGER DEFAULT 0,
  learning_total_incorrect INTEGER DEFAULT 0,
  learning_today_practiced INTEGER DEFAULT 0,
  learning_today_correct INTEGER DEFAULT 0,
  learning_today_date DATE,  -- 用于重置今日统计
  learning_mastered_count INTEGER DEFAULT 0,
  learning_review_count INTEGER DEFAULT 0,
  learning_total_learned INTEGER DEFAULT 0,
  
  -- 比赛统计
  competition_total_games INTEGER DEFAULT 0,
  competition_total_words INTEGER DEFAULT 0,
  competition_total_correct INTEGER DEFAULT 0,
  competition_best_score INTEGER DEFAULT 0,
  competition_best_accuracy DECIMAL(5,2) DEFAULT 0,
  competition_average_score DECIMAL(10,2) DEFAULT 0,
  competition_average_accuracy DECIMAL(5,2) DEFAULT 0,
  
  -- 挑战赛统计
  challenge_total_games INTEGER DEFAULT 0,
  challenge_wins INTEGER DEFAULT 0,
  challenge_total_earned INTEGER DEFAULT 0,
  challenge_total_spent INTEGER DEFAULT 0,
  challenge_net_points INTEGER DEFAULT 0,
  
  -- 成就徽章 (存储已解锁的成就ID列表)
  achievements JSONB DEFAULT '[]',
  
  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_stats_user_id ON user_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stats_total_points ON user_stats(total_points DESC);

-- 启用 RLS
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能查看和更新自己的统计
CREATE POLICY "Users can view own stats" ON user_stats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stats" ON user_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stats" ON user_stats
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role 可以访问所有数据（用于 Edge Function）
CREATE POLICY "Service role can access all stats" ON user_stats
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_user_stats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_stats_updated_at
  BEFORE UPDATE ON user_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_user_stats_updated_at();

-- 成就定义表（可选，用于动态管理成就）
CREATE TABLE IF NOT EXISTS achievements (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(10),
  category VARCHAR(50),  -- 'learning', 'competition', 'challenge', 'points'
  condition_type VARCHAR(50),  -- 'total_games', 'best_accuracy', 'total_points', etc.
  condition_value INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 插入默认成就
INSERT INTO achievements (id, name, description, icon, category, condition_type, condition_value, sort_order) VALUES
  -- 入门成就
  ('first_game', '初次挑战', '完成第一场比赛', '🎯', 'competition', 'competition_total_games', 1, 1),
  ('first_learn', '学习起步', '完成第一次学习', '📖', 'learning', 'learning_total_practiced', 1, 2),
  -- 勤奋成就
  ('games_10', '勤奋练习', '完成10场比赛', '🔥', 'competition', 'competition_total_games', 10, 10),
  ('games_50', '坚持不懈', '完成50场比赛', '💪', 'competition', 'competition_total_games', 50, 11),
  ('games_100', '百战老将', '完成100场比赛', '🏅', 'competition', 'competition_total_games', 100, 12),
  -- 正确率成就
  ('accuracy_80', '拼写高手', '单场正确率达到80%', '⭐', 'competition', 'competition_best_accuracy', 80, 20),
  ('accuracy_100', '完美无瑕', '单场正确率达到100%', '🏆', 'competition', 'competition_best_accuracy', 100, 21),
  ('avg_accuracy_70', '稳定发挥', '平均正确率达到70%', '📊', 'competition', 'competition_average_accuracy', 70, 22),
  -- 高分成就
  ('score_200', '高分选手', '单场得分超过200', '💎', 'competition', 'competition_best_score', 200, 30),
  ('score_500', '分数王者', '单场得分超过500', '👑', 'competition', 'competition_best_score', 500, 31),
  ('score_1000', '传奇选手', '单场得分超过1000', '🌟', 'competition', 'competition_best_score', 1000, 32),
  -- 词汇量成就
  ('words_100', '词汇大师', '累计正确拼写100个单词', '📚', 'competition', 'competition_total_correct', 100, 40),
  ('words_500', '词汇学者', '累计正确拼写500个单词', '🎓', 'competition', 'competition_total_correct', 500, 41),
  ('words_1000', '词汇专家', '累计正确拼写1000个单词', '🧠', 'competition', 'competition_total_correct', 1000, 42),
  -- 学习成就
  ('mastered_50', '初级掌握', '掌握50个单词', '✨', 'learning', 'learning_mastered_count', 50, 50),
  ('mastered_200', '中级掌握', '掌握200个单词', '🌈', 'learning', 'learning_mastered_count', 200, 51),
  ('mastered_500', '高级掌握', '掌握500个单词', '🎖️', 'learning', 'learning_mastered_count', 500, 52),
  -- 积分等级成就
  ('points_1000', '青铜学员', '总积分达到1000', '🥉', 'points', 'total_points', 1000, 60),
  ('points_5000', '白银学员', '总积分达到5000', '🥈', 'points', 'total_points', 5000, 61),
  ('points_10000', '黄金学员', '总积分达到10000', '🥇', 'points', 'total_points', 10000, 62)
ON CONFLICT (id) DO NOTHING;

-- 启用 RLS
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;

-- 成就表所有人可读
CREATE POLICY "Anyone can view achievements" ON achievements
  FOR SELECT USING (true);
