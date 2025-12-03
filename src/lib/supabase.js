import { createClient } from '@supabase/supabase-js'

// Supabase configuration
// Replace with your own Supabase URL and anon key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database table schemas (for reference)
// 
// words:
//   id: uuid (primary key)
//   word: text (unique)
//   pronunciation: text
//   definition: text
//   part_of_speech: text
//   example_sentence: text
//   difficulty: int (1-5)
//   category: text
//   created_at: timestamp
//
// user_words:
//   id: uuid (primary key)
//   user_id: uuid (foreign key to auth.users)
//   word_id: uuid (foreign key to words)
//   familiarity: int (0-5) - 熟悉程度
//   correct_count: int
//   incorrect_count: int
//   last_reviewed: timestamp
//   next_review: timestamp
//   created_at: timestamp
//
// competition_records:
//   id: uuid (primary key)
//   user_id: uuid (foreign key to auth.users)
//   score: int
//   total_words: int
//   correct_words: int
//   incorrect_words: text[] (array of incorrect words)
//   duration: int (seconds)
//   created_at: timestamp

