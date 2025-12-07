import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'
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
  const loading = ref(true)
  const initialized = ref(false)

  async function init(): Promise<void> {
    if (initialized.value) return
    
    loading.value = true
    try {
      const { data: { session } } = await supabase.auth.getSession()
      user.value = toUser(session?.user)

      // Listen for auth changes
      supabase.auth.onAuthStateChange((event, session) => {
        const previousUser = user.value
        user.value = toUser(session?.user)
        
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

  async function login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    if (error) throw error
    user.value = toUser(data.user)
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
    loading,
    initialized,
    init,
    login,
    register,
    logout,
    resetPassword,
    updatePassword
  }
})
