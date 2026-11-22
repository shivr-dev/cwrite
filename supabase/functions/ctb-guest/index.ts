import { createClient } from 'npm:@supabase/supabase-js@2.119.2'

const url = Deno.env.get('SUPABASE_URL')!
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const tokenFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const config = {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
const headers = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Cache-Control':'no-store',
  'Content-Type':'application/json; charset=utf-8',
}
const reply = (status:number, data:Record<string,unknown>) =>
  new Response(JSON.stringify(data),{status,headers})

async function guestEmail(room:string, name:string) {
  const bytes = new TextEncoder().encode(room + '\u001f' + name.normalize('NFKC').toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256',bytes)
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('')
  return 'g-' + hex.slice(0,48) + '@guest.cwrite.invalid'
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers})
  if (request.method !== 'POST') return reply(405,{error:'请使用网页加入。'})

  try {
    const reader = request.body?.getReader()
    if (!reader) return reply(400,{error:'请填写邀请码、昵称和密码。'})
    const decoder = new TextDecoder()
    let raw = ''
    let bytes = 0
    while (true) {
      const {done,value} = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 4096) {
        await reader.cancel()
        return reply(413,{error:'输入内容过长。'})
      }
      raw += decoder.decode(value,{stream:true})
    }
    raw += decoder.decode()
    let input
    try { input = JSON.parse(raw) } catch { return reply(400,{error:'无法读取加入请求。'}) }
    const token = typeof input?.token === 'string' ? input.token.trim() : ''
    const name = typeof input?.name === 'string' ? input.name.normalize('NFKC').trim().replace(/\s+/gu,' ') : ''
    const password = typeof input?.password === 'string' ? input.password : ''
    if (!tokenFormat.test(token) || !name || [...name].length > 32 || /[\p{Cc}\p{Cf}]/u.test(name) ||
      [...password].length < 8 || new TextEncoder().encode(password).length > 72) {
      return reply(400,{error:'请检查邀请码、昵称和密码。密码至少 8 个字符，最多 72 字节。'})
    }

    const admin = createClient(url,secret,config)
    const {data: room,error: lookupError} = await admin.rpc('ctb_guest_invite',{token})
    if (lookupError) return reply(503,{error:'暂时无法验证邀请，请稍后重试。'})
    if (!room) return reply(403,{error:'邀请码已失效或尝试次数过多，请稍后重试或联系组长。'})
    const email = await guestEmail(room,name)
    const cleanAuth = createClient(url,anon,config)
    const {error: createError} = await admin.auth.admin.createUser({
      email,password,email_confirm:true,app_metadata:{ctb_guest_room:room},user_metadata:{guest_name:name},
    })
    if (createError && !['email_exists','user_already_exists'].includes(createError.code || '')) {
      return reply(503,{error:'暂时无法开通游客身份，请稍后重试。'})
    }
    const {data:auth,error: signInError} = await cleanAuth.auth.signInWithPassword({email,password})
    if (signInError || !auth.session || auth.user?.app_metadata.ctb_guest_room !== room) {
      return reply(401,{error:'昵称已使用，或密码不正确。'})
    }
    const {data: joined,error: joinError} = await cleanAuth.rpc('ctb_join_room',{token,display_name:name})
    if (joinError || joined !== room) {
      await cleanAuth.auth.signOut({scope:'local'})
      return reply(403,{error:'无法加入此协作室，请向组长确认邀请和访问权限。'})
    }
    return reply(200,{room,access_token:auth.session.access_token,refresh_token:auth.session.refresh_token})
  } catch {
    return reply(503,{error:'游客入口暂时不可用，请稍后重试。'})
  }
})
