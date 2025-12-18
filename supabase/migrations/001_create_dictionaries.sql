-- 创建词典表
CREATE TABLE IF NOT EXISTS dictionaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  author VARCHAR(255),
  cover_image TEXT,
  level VARCHAR(50) DEFAULT 'intermediate',
  type VARCHAR(50) DEFAULT 'vocabulary',
  word_count INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT false,
  creator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建词典单词关联表
CREATE TABLE IF NOT EXISTS dictionary_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dictionary_id UUID NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
  word VARCHAR(255) NOT NULL,
  pronunciation VARCHAR(255),
  definition TEXT NOT NULL,
  definition_cn TEXT,
  part_of_speech VARCHAR(50),
  example_sentence TEXT,
  difficulty INTEGER DEFAULT 3 CHECK (difficulty >= 1 AND difficulty <= 5),
  category VARCHAR(100),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(dictionary_id, word)
);

-- 创建用户词典选择表
CREATE TABLE IF NOT EXISTS user_dictionary_selections (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dictionary_id UUID NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
  selected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_dictionaries_creator ON dictionaries(creator_id);
CREATE INDEX IF NOT EXISTS idx_dictionaries_public ON dictionaries(is_public);
CREATE INDEX IF NOT EXISTS idx_dictionary_words_dict ON dictionary_words(dictionary_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_words_word ON dictionary_words(word);

-- 更新词典单词数量的触发器函数
CREATE OR REPLACE FUNCTION update_dictionary_word_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE dictionaries SET word_count = word_count + 1, updated_at = NOW()
    WHERE id = NEW.dictionary_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE dictionaries SET word_count = word_count - 1, updated_at = NOW()
    WHERE id = OLD.dictionary_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
DROP TRIGGER IF EXISTS trigger_update_word_count ON dictionary_words;
CREATE TRIGGER trigger_update_word_count
AFTER INSERT OR DELETE ON dictionary_words
FOR EACH ROW EXECUTE FUNCTION update_dictionary_word_count();

-- RLS 策略
ALTER TABLE dictionaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dictionary_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_dictionary_selections ENABLE ROW LEVEL SECURITY;

-- 词典策略：公开词典所有人可读，私有词典只有创建者可读写
CREATE POLICY "Public dictionaries are viewable by everyone" ON dictionaries
  FOR SELECT USING (is_public = true);

CREATE POLICY "Users can view their own dictionaries" ON dictionaries
  FOR SELECT USING (auth.uid() = creator_id);

CREATE POLICY "Users can create dictionaries" ON dictionaries
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Users can update their own dictionaries" ON dictionaries
  FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "Users can delete their own dictionaries" ON dictionaries
  FOR DELETE USING (auth.uid() = creator_id);

-- 词典单词策略
CREATE POLICY "Words in public dictionaries are viewable" ON dictionary_words
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM dictionaries WHERE id = dictionary_id AND is_public = true)
  );

CREATE POLICY "Users can view words in their dictionaries" ON dictionary_words
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM dictionaries WHERE id = dictionary_id AND creator_id = auth.uid())
  );

CREATE POLICY "Users can manage words in their dictionaries" ON dictionary_words
  FOR ALL USING (
    EXISTS (SELECT 1 FROM dictionaries WHERE id = dictionary_id AND creator_id = auth.uid())
  );

-- 用户词典选择策略
CREATE POLICY "Users can manage their dictionary selection" ON user_dictionary_selections
  FOR ALL USING (auth.uid() = user_id);
