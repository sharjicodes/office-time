import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@milo.app';
    if (!url || !serviceKey || !publicKey || !privateKey) throw new Error('Push service is not configured.');

    const authorization = request.headers.get('Authorization');
    if (!authorization) return Response.json({ error: 'Sign in required.' }, { status: 401, headers: corsHeaders });
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return Response.json({ error: 'Sign in required.' }, { status: 401, headers: corsHeaders });

    const { room_id: roomId, call_id: callId, title, body, target_url: targetUrl } = await request.json();
    if ((!roomId && !callId) || typeof title !== 'string' || typeof body !== 'string')
      return Response.json({ error: 'Invalid notification.' }, { status: 400, headers: corsHeaders });

    const admin = createClient(url, serviceKey);
    let recipientIds: string[];
    if (roomId) {
      const { data: members, error: memberError } = await admin.from('chat_room_members').select('user_id').eq('room_id', roomId);
      if (memberError) throw memberError;
      if (!members?.some(member => member.user_id === user.id))
        return Response.json({ error: 'You are not a member of this chat.' }, { status: 403, headers: corsHeaders });
      recipientIds = [...new Set((members ?? []).map(member => member.user_id).filter((id: string) => id !== user.id))];
    } else {
      const { data: call, error: callError } = await admin.from('call_sessions').select('created_by,ended_at').eq('id', callId).maybeSingle();
      if (callError) throw callError;
      const { data: callerMembership, error: callerError } = await admin.from('call_session_members').select('status').eq('call_id', callId).eq('user_id', user.id).maybeSingle();
      if (callerError) throw callerError;
      if (!call || call.ended_at || !callerMembership || !['joined', 'invited'].includes(callerMembership.status))
        return Response.json({ error: 'You are not part of this active call.' }, { status: 403, headers: corsHeaders });
      const { data: invited, error: invitedError } = await admin.from('call_session_members').select('user_id').eq('call_id', callId).eq('status', 'invited').neq('user_id', user.id);
      if (invitedError) throw invitedError;
      recipientIds = [...new Set((invited ?? []).map(item => item.user_id))];
    }
    if (!recipientIds.length) return Response.json({ sent: 0 }, { headers: corsHeaders });
    const { data: subscriptions, error: subscriptionsError } = await admin.from('milo_push_subscriptions').select('id,subscription').in('user_id', recipientIds);
    if (subscriptionsError) throw subscriptionsError;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const fallbackUrl = callId ? `/?call=${encodeURIComponent(callId)}` : '/';
    const payload = JSON.stringify({ title: title.slice(0, 100), body: body.slice(0, 240), url: typeof targetUrl === 'string' && targetUrl.startsWith('/') ? targetUrl : fallbackUrl });
    let sent = 0;
    for (const item of subscriptions ?? []) {
      try { await webpush.sendNotification(item.subscription, payload); sent += 1; }
      catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410)
          await admin.from('milo_push_subscriptions').delete().eq('id', item.id);
      }
    }
    return Response.json({ sent }, { headers: corsHeaders });
  } catch (error) {
    console.error('send-chat-push failed', error);
    return Response.json({ error: 'Could not send push notification.' }, { status: 500, headers: corsHeaders });
  }
});
