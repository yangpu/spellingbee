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
      const { data: { session } } = await supabase.auth.getSession()
      user.value = toUser(session?.user)

      // Load profile if user is logged in
      if (user.value) {
        await loadProfile()
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange(async (event, session) => {
        const previousUser = user.value
        user.value = toUser(session?.user)
        
        // Load profile when user signs in
        if (event === 'SIGNED_IN' && user.value) {
          await loadProfile()
        } else if (event === 'SIGNED_OUT') {
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
    } catch (error) {
      console.error('Auth init error:', error)
    } finally {
      loading.value = false
    }
  }

  async function loadProfile(): Promise<void> {
    if (!user.value) return
    
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.value.id)
        .single()
      
      if (!error && data) {
        profile.value = data as UserProfile
      } else if (error?.code === 'PGRST116') {
        // No profile found, create one
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
