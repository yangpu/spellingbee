import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { User, UserProfile } from '@/types'
import type { User as SupabaseUser } from '@supabase/supabase-js'

// Helper to convert Supabase User to our User type
function toUser(supabaseUser: SupabaseUser | undefined | null): User | null {
  if (!supabaseUser) return null
  return {
    ...supabaseUser,
    id: supabaseUser.id,
    email: supabaseUser.email
  } as User
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const profile = ref<UserProfile | null>(null)
  const loading = ref(true)
  const initialized = ref(false)

  async function init(): Promise<void> {
    if (initialized.value) return
    
    loading.value = true
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      // 如果获取 session 失败（如 refresh token 无效），清除本地状态
      if (sessionError) {
        console.error('Session error:', sessionError)
        user.value = null
        profile.value = null
        // 尝试登出以清除无效的本地存储
        try {
          await supabase.auth.signOut({ scope: 'local' })
        } catch {}
      } else {
        user.value = toUser(session?.user)

        // Load profile if user is logged in
        if (user.value) {
          await loadProfile()
        }
      }

      // Listen for auth changes
      // 注意：回调函数必须是同步的，不能使用 async
      // 参考：https://github.com/orgs/supabase/discussions/40806
      supabase.auth.onAuthStateChange((event, session) => {
        const previousUser = user.value
        user.value = toUser(session?.user)
        
        // Load profile when user signs in
        // 异步操作放在单独的函数中处理，不在回调中 await
        if (event === 'SIGNED_IN' && user.value) {
          loadProfile() // 不使用 await
        } else if (event === 'SIGNED_OUT') {
          profile.value = null
        } else if (event === 'TOKEN_REFRESHED' && !session) {
          // Token 刷新失败，清除状态
          user.value = null
          profile.value = null
        }
        
        // Emit custom event for other stores to react
        if (event === 'SIGNED_IN' && !previousUser) {
          window.dispatchEvent(new CustomEvent('auth:signed_in', { detail: { user: user.value } }))
        } else if (event === 'SIGNED_OUT') {
          window.dispatchEvent(new CustomEvent('auth:signed_out'))
        }
      })
      
      initialized.value = true
    } catch (error: any) {
      console.error('Auth init error:', error)
      // 如果是 refresh token 相关错误，清除本地状态
      if (error?.message?.includes('Refresh Token') || error?.code === 'invalid_grant') {
        user.value = null
        profile.value = null
        try {
          await supabase.auth.signOut({ scope: 'local' })
        } catch {}
      }
    } finally {
      loading.value = false
    }
  }

  async function loadProfile(): Promise<void> {
    if (!user.value) return
    
    try {
      // 使用 maybeSingle() 而不是 single()，避免在没有记录时抛出 406 错误
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.value.id)
        .maybeSingle()
      
      if (!error && data) {
        profile.value = data as UserProfile
      } else if (!data) {
        // No profile found, create default profile
        profile.value = {
          user_id: user.value.id,
          nickname: user.value.email?.split('@')[0] || '',
          created_at: new Date().toISOString()
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error)
    }
  }

  async function updateProfile(updates: Partial<UserProfile>): Promise<boolean> {
    if (!user.value) return false
    
    try {
      const profileData = {
        user_id: user.value.id,
        ...updates,
        updated_at: new Date().toISOString()
      }
      
      const { error } = await supabase
        .from('user_profiles')
        .upsert(profileData, {
          onConflict: 'user_id'
        })
      
      if (error) {
        console.error('Error updating profile:', error)
        return false
      }
      
      // Update local profile
      profile.value = {
        ...profile.value,
        ...profileData
      } as UserProfile
      
      return true
    } catch (error) {
      console.error('Error updating profile:', error)
      return false
    }
  }

  async function login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    if (error) throw error
    user.value = toUser(data.user)
    await loadProfile()
    return data
  }

  async function register(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`
      }
    })
    if (error) throw error
    return data
  }

  async function logout(): Promise<void> {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    user.value = null
    profile.value = null
  }

  async function resetPassword(email: string) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (error) throw error
    return data
  }

  async function updatePassword(newPassword: string) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword
    })
    if (error) throw error
    return data
  }

  return {
    user,
    profile,
    loading,
    initialized,
    init,
    login,
    register,
    logout,
    resetPassword,
    updatePassword,
    loadProfile,
    updateProfile
  }
})
