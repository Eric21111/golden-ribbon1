import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers});
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {headers});
  if (req.method !== 'POST') return reply(405, {message:'Use POST.'});
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_ANON_KEY')!;
    const adminKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const options = {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
    const auth = createClient(url,key,options);
    const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401,{message:'Sign in again.'});
    const {data:{user},error:sessionError} = await auth.auth.getUser(token);
    if (sessionError || !user?.email) return reply(401,{message:'Sign in again.'});
    const {shiftId,credential} = await req.json();
    if (typeof shiftId!=='string' || !/^[0-9a-f-]{36}$/i.test(shiftId) || typeof credential!=='string' || !credential || credential.length>256)
      return reply(400,{message:'Enter your current PIN or beta password.'});
    const challenge = await auth.auth.signInWithPassword({email:user.email,password:credential});
    if (challenge.error || challenge.data.user?.id!==user.id)
      return reply(challenge.error?.status===429?429:403,{message:challenge.error?.status===429?'Too many attempts. Try again later.':'Incorrect PIN or beta password.'});
    // Only dispose of the temporary verification session; the device session stays signed in.
    await auth.auth.signOut({scope:'local'});
    const admin = createClient(url,adminKey,options);
    const {data,error} = await admin.rpc('begin_verified_cashier_close',{p_shift_id:shiftId,p_cashier:user.id});
    if (error) return reply(409,{message:'Unable to start closing this shift. Refresh its status.'});
    return reply(200,data);
  } catch { return reply(503,{message:'Could not confirm End Shift. Refresh the shift status before retrying.'}); }
});
