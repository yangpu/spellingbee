-- 为 challenges 表添加词典相关字段
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS dictionary_id UUID REFERENCES dictionaries(id) ON DELETE SET NULL;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS dictionary_name VARCHAR(255);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_challenges_dictionary ON challenges(dictionary_id);
