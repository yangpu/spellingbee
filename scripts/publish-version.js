#!/usr/bin/env node

/**
 * 发布版本到 Supabase
 * 在部署完成后调用，将新版本号写入数据库
 */

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 加载 .env 文件
function loadEnv() {
  const envPath = join(__dirname, '..', '.env')
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8')
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=')
        const value = valueParts.join('=')
        if (key && value && !process.env[key]) {
          process.env[key] = value
        }
      }
    })
  }
}

loadEnv()

// 从环境变量获取 Supabase 配置
// 前端使用同源代理路径 /spellingbee/sb/，Node 脚本需要绝对地址
const rawSupabaseUrl = process.env.VITE_SUPABASE_DIRECT_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_URL = rawSupabaseUrl && /^https?:\/\//.test(rawSupabaseUrl)
  ? rawSupabaseUrl
  : rawSupabaseUrl
    ? `https://yangruoji.com${rawSupabaseUrl}`
    : 'https://yangruoji.com/spellingbee/sb/'
// 优先使用 service key，如果没有则使用 anon key（需要确保 RLS 允许插入）
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing environment variables:')
  if (!SUPABASE_URL) console.error('   - VITE_SUPABASE_URL')
  if (!SUPABASE_KEY) console.error('   - SUPABASE_SERVICE_KEY or VITE_SUPABASE_ANON_KEY')
  console.error('\nPlease set these in your .env file')
  process.exit(1)
}

async function publishVersion() {
  try {
    // 读取 package.json 获取版本号
    const packageJsonPath = join(__dirname, '..', 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    const version = packageJson.version
    
    // 获取发布说明（可选，从命令行参数获取）
    const releaseNotes = process.argv[2] || null
    
    console.log(`📦 Publishing version: ${version}`)
    if (releaseNotes) {
      console.log(`📝 Release notes: ${releaseNotes}`)
    }
    
    // 创建 Supabase 客户端
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    
    // 检查是否已存在相同版本
    const { data: existing } = await supabase
      .from('app_versions')
      .select('version')
      .eq('version', version)
      .single()
    
    if (existing) {
      console.log(`⚠️ Version ${version} already published, skipping`)
      return
    }
    
    // 插入新版本
    const { error } = await supabase
      .from('app_versions')
      .insert({
        version,
        release_notes: releaseNotes
      })
    
    if (error) {
      throw error
    }
    
    console.log(`✅ Version ${version} published successfully!`)
  } catch (error) {
    console.error('❌ Failed to publish version:', error.message)
    process.exit(1)
  }
}

publishVersion()
