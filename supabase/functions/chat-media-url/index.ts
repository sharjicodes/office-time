import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });

  const authorization = request.headers.get('Authorization');
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization || !projectUrl || !anonKey || !serviceKey)
    return Response.json({ error: 'Chat media service is not configured.' }, { status: 503, headers: corsHeaders });

  try {
    const { messageId } = await request.json();
    if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(messageId))
      return Response.json({ error: 'Invalid media message.' }, { status: 400, headers: corsHeaders });

    const userClient = createClient(projectUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return Response.json({ error: 'Sign in to view shared media.' }, { status: 401, headers: corsHeaders });

    const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: path, error: claimError } = await admin.rpc('claim_chat_media_view', { message_id_in: messageId, viewer_id_in: user.id });
    if (claimError || typeof path !== 'string')
      return Response.json({ error: claimError?.message || 'Media is unavailable.' }, { status: 403, headers: corsHeaders });

    const { data, error } = await admin.storage.from('chat-media').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return Response.json({ error: 'Could not create a media link.' }, { status: 500, headers: corsHeaders });
    return Response.json({ url: data.signedUrl }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400, headers: corsHeaders });
  }
});
