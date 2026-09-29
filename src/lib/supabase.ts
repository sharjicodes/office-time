import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);
const authStorage = Platform.OS === 'web'
  ? {
      getItem: async (key: string) => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
      setItem: async (key: string, value: string) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); },
      removeItem: async (key: string) => { if (typeof window !== 'undefined') window.localStorage.removeItem(key); },
    }
  : AsyncStorage;

export const supabase = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { storage: authStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' },
    })
  : null;

// Never put a Supabase service-role key in a mobile app.
// Use the public anon key plus Row Level Security policies.
