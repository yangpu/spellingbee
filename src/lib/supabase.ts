import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ctsxrhgjvkeyokaejwqb.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3hyaGdqdmtleW9rYWVqd3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MjU2MTUsImV4cCI6MjA4MDUwMTYxNX0.L2Xt2kkBw-2LRfHEF-uZQhYU8b5gDnZZNjpBEpZMkSc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
