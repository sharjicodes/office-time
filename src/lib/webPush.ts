import { Platform } from 'react-native';
import { supabase } from './supabase';

function decodeVapidKey(value: string): Uint8Array {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export async function subscribeToMiloPush(): Promise<string> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window))
    throw new Error('Web push is not supported in this browser.');
  const { data: { user } } = await supabase?.auth.getUser() ?? { data: { user: null } };
  if (!supabase || !user) throw new Error('Sign in before enabling notifications.');
  const key = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error('The PWA push public key is not configured for this build.');
  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to continue.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(key) });
  const serialized = subscription.toJSON();
  const { error } = await supabase.from('milo_push_subscriptions').upsert({
    user_id: user.id,
    endpoint: subscription.endpoint,
    subscription: serialized,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) { await subscription.unsubscribe(); throw new Error(error.message); }
  return 'Push notifications are enabled on this device.';
}

export async function unsubscribeFromMiloPush(): Promise<string> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'Web push is unavailable here.';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return 'Push notifications are already off on this device.';
  const endpoint = subscription.endpoint;
  const { error } = await supabase?.from('milo_push_subscriptions').delete().eq('endpoint', endpoint) ?? { error: null };
  if (error) throw new Error(error.message);
  await subscription.unsubscribe();
  return 'Push notifications are off on this device.';
}

export async function getMiloPushEnabled(): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  return !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription());
}
