import { createClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { createEditor, sample } from './editor.js'
import { connectRoom } from './sync.js'
import { encodeCaret, showCarets } from './carets.js'
import { bindRibbon, ribbon } from './ribbon.js'
import { backendDefaults } from './backend-defaults.js'
import './style.css'

const localConfig = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const url = localConfig ? import.meta.env.VITE_SUPABASE_URL : backendDefaults.url
const key = localConfig ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY : backendDefaults.key
const client = url && key ? createClient(url, key) : null
const root = document.querySelector('#app')
root.innerHTML = `
<header class="top">
  <button id="home" class="brand" aria-label="CTB Junior 协作空间"><span class="logo"><i></i><i></i><i></i></span><b>CTB<span> Junior</span></b></button>
  <span class="top-rule"></span><span class="work-label">协作空间</span>
  <div class="top-actions"><span id="state" class="connection"><i></i><span>本地示例</span></span>
    <button id="account" class="button plain">登录</button><button id="share" class="button primary">邀请成员</button></div>
</header>
<div class="layout">
  <aside class="sidebar">
    <div class="side-head"><span>工作空间</span><button id="rooms" class="plain mini" aria-label="查看或创建协作室" title="查看或创建协作室">＋</button></div>
    <button id="activeRoom" class="active-room"><span class="file-icon">▤</span><span class="room-copy"><b id="side-title"></b><small id="role"></small></span></button>
    <div class="outline"><p class="eyebrow">文稿大纲</p><nav id="outline" aria-label="文稿大纲"></nav></div>
    <button id="guide" class="guide plain"><span>ⓘ</span> 使用说明</button>
  </aside>
  <main class="main" aria-label="文稿">
    <div class="docbar"><div class="crumb"><span>文稿</span><span aria-hidden="true">/</span><b id="crumb-title"></b></div>
      <div class="doc-actions"><button id="import" class="button plain">导入</button><button id="export" class="button secondary">导出 DOCX</button><button id="print" class="button plain">打印 / PDF</button><button id="chatToggle" class="button plain" aria-controls="chat" aria-expanded="true">聊天</button></div>
    </div>
    <div class="toolbar" role="group" aria-label="文字格式">${ribbon}</div>
    <div class="workspace" id="scroller"><article class="paper"><p class="paper-kicker"><span></span> CTB JUNIOR · 研究报告</p><textarea id="title" class="paper-title" rows="1" maxlength="100" aria-label="文稿标题"></textarea><h1 id="print-title" class="paper-title"></h1><div id="editor"></div></article></div>
    <footer class="docfoot"><span id="wordcount"></span><span class="page-format">A4 <span id="zoom"></span></span><span id="permission"></span></footer>
  </main>
  <aside id="chat" class="chat" aria-label="小组聊天">
    <header class="chat-head"><div><h2>小组聊天</h2><p id="chat-subtitle">当前设备 · 示例</p></div><button id="closeChat" class="plain mini" aria-label="收起聊天">×</button></header>
    <div id="messages" class="messages" role="log" aria-label="聊天消息"></div>
    <form id="chat-form" class="chat-form"><input id="chat-input" aria-label="聊天消息" placeholder="写条消息…" maxlength="2000" required><button class="button primary" aria-label="发送消息">发送</button></form>
  </aside>
</div>
<input type="file" id="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>
<dialog id="dialog"><div class="dialog-inner"><header><h2 id="dialog-title"></h2><button id="closeDialog" class="plain mini" aria-label="关闭弹窗">×</button></header><div id="dialog-content"></div><p id="dialog-status" role="status" hidden></p></div></dialog>
<div id="toast" role="status" aria-live="polite"></div>`

const $ = id => document.getElementById(id)
const el = (tag, text, className) => {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  if (className) node.className = className
  return node
}
function button(text, action, style = 'secondary') {
  const node = el('button', text, 'button ' + style)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}
function field(name, value = '', type = 'text', limit = 100) {
  const label = el('label', name, 'field')
  const input = el('input')
  Object.assign(input, {type, value, maxLength:limit, required:true})
  label.append(input)
  return {label,input}
}
function formTask(form, action) {
  const submit = form.querySelector('button[type="submit"],button:not([type])')
  submit.type = 'submit'
  form.addEventListener('submit', async event => {
    event.preventDefault()
    submit.disabled = true
    $('dialog-status').hidden = true
    try { await action() }
    catch(error) { notice(message(error)) }
    finally { submit.disabled = false }
  })
}
const message = error => ({
  'Invalid login credentials':'邮箱或密码不正确。',
  'Email not confirmed':'请先确认注册邮件，或请项目管理员开通账号。',
  'Invitation expired or invalid':'邀请已失效，请向组长索取新链接。',
  'Access revoked':'此账号的访问权限已被撤销。',
  'An account is required to create a room':'请登录正式账号后创建协作室。',
  'You already own a room':'你的账号已经创建过一个协作室。',
  'Failed to fetch':'无法连接服务器，请检查学校网络。',
}[error?.message] || error?.message || '操作未完成，请重试。')
async function checked(request) {
  const {data,error} = await request
  if (error) throw error
  return data
}
let toastTimer
function notice(value) {
  if ($('dialog').open) {
    const status = $('dialog-status')
    status.textContent = value
    status.hidden = false
    return
  }
  clearTimeout(toastTimer)
  $('toast').textContent = value
  $('toast').classList.add('visible')
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4800)
}
function modal(title, nodes) {
  $('dialog-title').textContent = title
  $('dialog-content').replaceChildren(...nodes)
  $('dialog-status').hidden = true
  if (!$('dialog').open) $('dialog').showModal()
}
function close() { $('dialog').close() }
$('closeDialog').onclick = close
$('dialog').onclick = event => { if (event.target === $('dialog')) close() }

let user, room, editor, ydoc, sync, generation = 0, updateFrame, permissions = 'demo'
let roster = new Map(), messages = new Map()
let carets = new Map(), caretTimer
const refreshRibbon = bindRibbon($, () => editor, notice)
let demoTitle = '校园纸张再利用计划'
const canEdit = () => ['owner','editor','demo'].includes(permissions)
const canRename = () => ['owner','demo'].includes(permissions)
const isGuest = () => Boolean(user?.app_metadata?.ctb_guest_room)
const roleText = {owner:'组长',editor:'可编辑',viewer:'只读',demo:'本地示例',blocked:'已移除',loading:'正在连接'}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function address() { return new URLSearchParams(location.hash.slice(1)) }
const invite = () => {
  const token = address().get('invite')
  return uuid.test(token || '') ? token : null
}
function setAddress(params = {}) {
  history.replaceState(null,'',location.pathname + location.search +
    (Object.keys(params).length ? '#' + new URLSearchParams(params) : ''))
}
function stored(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') }
  catch { return null }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true }
  catch { return false }
}
function updateStatus(status) {
  $('state').lastElementChild.textContent = status
  $('state').classList.toggle('warning', /中断|未|失败|错误/.test(status))
}
function title(value) {
  $('title').value = value
  sizeTitle()
  $('side-title').textContent = value
  $('crumb-title').textContent = value
  document.title = value + ' · CTB Junior'
}
function sizeTitle() {
  const field = $('title')
  field.style.height = 'auto'
  field.style.height = field.scrollHeight + 1 + 'px'
  $('print-title').textContent = field.value
}
$('title').addEventListener('input',sizeTitle)
$('title').addEventListener('keydown',event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    event.currentTarget.blur()
  }
})
new ResizeObserver(([entry]) => {
  // Keep the CSS width at 210 mm. Fit the page by scaling it, without changing the line length.
  const scale = Math.min(1, Math.max(.28, (entry.contentRect.width - 2) / (210 * 96 / 25.4)))
  entry.target.style.setProperty('--paper-zoom', String(scale))
  $('zoom').textContent = '· ' + Math.round(scale * 100) + '%'
}).observe($('scroller'))
function updateAccount() {
  $('account').textContent = isGuest() ? '游客' : user ? '账户' : '登录'
  $('share').textContent = room ? '分享与成员' : user && !isGuest() ? '我的协作室' : '加入协作室'
}
function updatePermission() {
  editor?.setEditable(canEdit())
  $('role').textContent = roleText[permissions] || ''
  $('permission').textContent = canEdit() ? '可编辑' : '只读'
  $('title').readOnly = !canRename()
  $('import').disabled = !canEdit()
  $('export').disabled = permissions === 'loading'
  $('print').disabled = permissions === 'loading'
  for (const node of document.querySelectorAll('.toolbar button,.toolbar select')) node.disabled = !canEdit()
  $('chat-input').disabled = permissions === 'loading'
  $('chat-form').lastElementChild.disabled = permissions === 'loading'
}
function refreshDocument() {
  cancelAnimationFrame(updateFrame)
  updateFrame = requestAnimationFrame(() => {
    if (!editor) return
    const headings = [...$('editor').querySelectorAll('h1,h2,h3')]
    $('outline').replaceChildren(...(headings.length ? headings.map(heading => {
      const node = button(heading.textContent || '未命名标题', () => heading.scrollIntoView({block:'start'}), 'outline-link')
      node.classList.add(heading.tagName.toLowerCase())
      return node
    }) : [el('span','添加标题后显示','muted')]))
    $('wordcount').textContent = editor.getText().replace(/\s/g,'').length + ' 字符'
    for (const node of document.querySelectorAll('[data-mark]')) node.setAttribute('aria-pressed', String(editor.isActive(node.dataset.mark)))
    $('heading').value = [1,2,3].find(level => editor.isActive('heading',{level})) || 0
    refreshRibbon(editor)
  })
}
function renderMessages() {
  const panel = $('messages')
  const pinned = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 70
  const all = [...messages.values()].sort((a,b) => a.position - b.position)
  const rows = all.map(row => {
    const mine = row.author_id === (room ? user?.id : 'demo')
    const wrapper = el('div', null, 'message' + (mine ? ' mine' : ''))
    const name = roster.get(row.author_id)?.name || (mine ? '我' : '成员')
    const meta = el('div', null, 'message-meta')
    meta.append(el('span', name), el('time', new Date(row.created_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})))
    wrapper.append(el('span', [...name][0], 'avatar'), meta, el('p', row.body, 'bubble'))
    return wrapper
  })
  if (!rows.length) {
    const empty = el('div',null,'empty-chat')
    empty.append(el('span','▤','empty-icon'),el('b','还没有消息'),el('p','在这里讨论分工、资料和修改意见。'))
    rows.push(empty)
  }
  panel.replaceChildren(...rows)
  if (pinned) panel.scrollTop = panel.scrollHeight
}
function chatEvent(row) {
  if (messages.has(row.event_id)) return
  messages.set(row.event_id, row)
  renderMessages()
}
function updateCarets() {
  clearTimeout(caretTimer)
  const now = Date.now()
  let next = Infinity
  const active = []
  for (const [author,event] of carets) {
    if (event.expires <= now) { carets.delete(author); continue }
    next = Math.min(next,event.expires)
    const member = roster.get(author)
    if (member && member.role !== 'blocked') active.push({author,caret:event.caret,name:member.name})
  }
  showCarets(editor,active)
  if (Number.isFinite(next)) caretTimer = setTimeout(updateCarets,Math.max(20,next - now))
}
function remoteCaret(event) {
  const expires = Date.parse(event.created_at) + 12000
  if (expires <= Date.now() || (carets.get(event.author_id)?.position || 0) >= event.position) return
  carets.set(event.author_id,{caret:event.caret,expires,position:event.position})
  updateCarets()
}
function reset() {
  generation++
  sync?.stop()
  sync = null
  editor?.destroy()
  editor = null
  ydoc?.destroy()
  ydoc = new Y.Doc()
  room = null
  roster = new Map()
  messages = new Map()
  carets = new Map()
  clearTimeout(caretTimer)
  $('chat-input').value = ''
  $('scroller').scrollTop = 0
  return generation
}
function showDemo(clearAddress = false) {
  reset()
  if (clearAddress) setAddress()
  permissions = 'demo'
  const local = stored('ctb:demo')
  demoTitle = local?.title || '校园纸张再利用计划'
  title(demoTitle)
  editor = createEditor($('editor'),ydoc,true,refreshDocument)
  editor.commands.setContent(local?.document || sample)
  editor.on('update', persistDemo)
  for (const row of stored('ctb:demo:chat') || []) messages.set(row.event_id,row)
  $('chat-subtitle').textContent = '当前设备 · 示例'
  updateStatus('本地示例')
  updatePermission()
  updateAccount()
  renderMessages()
  refreshDocument()
}
function persistDemo() {
  if (permissions === 'demo' && editor && !save('ctb:demo',{title:demoTitle,document:editor.getJSON()})) {
    updateStatus('示例未保存')
  }
}

async function openRoom(id) {
  const current = reset()
  room = {id}
  permissions = 'loading'
  title('正在打开文稿…')
  updateStatus('正在连接…')
  $('chat-subtitle').textContent = '正在连接'
  renderMessages()
  updateAccount()
  updatePermission()
  async function access(initial = false) {
    try {
      const [data, members] = await Promise.all([
        checked(client.from('ctb_rooms').select('id,title').eq('id',id).maybeSingle()),
        checked(client.from('ctb_members').select('*').eq('room_id',id).order('joined_at')),
      ])
      if (current !== generation) return false
      const role = members.find(member => member.user_id === user?.id)?.role
      if (!data || !role || role === 'blocked') {
        notice('当前账号无法访问该协作室。')
        showDemo(true)
        return false
      }
      room = data
      const changed = JSON.stringify([...roster.values()]) !== JSON.stringify(members)
      roster = new Map(members.map(member => [member.user_id,member]))
      permissions = role
      if (document.activeElement !== $('title')) title(data.title)
      $('chat-subtitle').textContent = [...roster.values()].filter(member => member.role !== 'blocked').length + ' 位成员'
      if (changed) { renderMessages(); updateCarets() }
      updatePermission()
      return true
    } catch (error) {
      if (initial) throw error
      return null
    }
  }
  try {
    if (!await access(true)) return
    setAddress({room:id})
    sync = connectRoom(client,id,user.id,ydoc,{
      status:updateStatus,chat:chatEvent,invalid:() => notice('有一条无法读取的文稿更新。'),access,
      caret:remoteCaret,localCaret:() => encodeCaret(editor),
    },canEdit)
    if (!await sync.start()) {
      if (current !== generation) return
      throw new Error('暂时无法载入文稿，请检查网络后重试。')
    }
    if (current !== generation) return
    editor = createEditor($('editor'),ydoc,canEdit(),refreshDocument)
    updateCarets()
    updatePermission()
    refreshDocument()
    close()
  } catch (error) {
    if (current === generation) { showDemo(); notice(message(error)); }
  }
}

function login(kind = 'login') {
  const email = field('邮箱','', 'email',254)
  const password = field('密码','', 'password',128)
  email.input.autocomplete = 'email'
  password.input.autocomplete = kind === 'register' ? 'new-password' : 'current-password'
  if (kind === 'register') password.input.minLength = 8
  const form = el('form',null,'stack')
  const submit = el('button',kind === 'register' ? '注册' : '登录','button primary')
  submit.type = 'submit'
  form.append(email.label,password.label,submit)
  formTask(form,async () => {
    if (!client) throw new Error('此预览尚未连接 Supabase，可以先试用本地示例。')
    if (kind === 'register') {
      const data = await checked(client.auth.signUp({email:email.input.value,password:password.input.value,
        options:{emailRedirectTo:location.origin + location.pathname}}))
      if (!data.session) {
        login()
        notice('请查看注册确认邮件，再回来登录。')
        return
      }
      user = data.user
    } else {
      const data = await checked(client.auth.signInWithPassword({email:email.input.value,password:password.input.value}))
      user = data.user
    }
    updateAccount()
    const token = invite()
    const id = address().get('room')
    if (token) join(token)
    else if (uuid.test(id || '')) await openRoom(id)
    else await rooms()
  })
  modal(kind === 'register' ? '注册团队账号' : '登录协作空间',[
    el('p',invite() ? '登录后即可用邀请链接加入团队。' : '用团队账号创建或加入协作室。','muted'),
    form, button(kind === 'register' ? '已有账号，返回登录' : '注册账号', () => login(kind === 'register' ? 'login' : 'register'),'plain'),
    button('使用邀请码，以游客加入', () => guestJoin(invite()),'plain'),
  ])
}
function parseInvite(raw) {
  raw = raw.trim()
  if (uuid.test(raw)) return raw
  try {
    const token = new URLSearchParams(new URL(raw).hash.slice(1)).get('invite')
    return uuid.test(token || '') ? token : null
  } catch { return null }
}

function guestJoin(token = null) {
  const code = field('邀请码或邀请链接',token || '', 'text',1000)
  const name = field('你的昵称','', 'text',32)
  const password = field('游客密码','', 'password',72)
  name.input.autocomplete = 'nickname'
  password.input.minLength = 8
  password.input.autocomplete = 'off'
  const form = el('form',null,'stack')
  const fields = token ? [name.label,password.label] : [code.label,name.label,password.label]
  form.append(...fields,el('button','以游客身份加入','button primary'))
  formTask(form,async () => {
    if (!client) throw new Error('此预览尚未连接 Supabase。')
    const invitation = token || parseInvite(code.input.value)
    if (!invitation) throw new Error('请粘贴有效的邀请码或邀请链接。')
    const response = await fetch(url + '/functions/v1/ctb-guest',{
      method:'POST',headers:{'Content-Type':'application/json',apikey:key},
      body:JSON.stringify({token:invitation,name:name.input.value,password:password.input.value}),
    })
    const data = await response.json().catch(()=>null)
    if (!response.ok || !data?.room) throw new Error(data?.error || '游客入口暂时不可用，请重试。')
    const auth = await checked(client.auth.setSession({
      access_token:data.access_token,refresh_token:data.refresh_token,
    }))
    user = auth.user
    updateAccount()
    await openRoom(data.room)
  })
  modal('以游客身份加入',[
    el('p','第一次来，请取一个昵称并设置至少 8 个字符的密码。换电脑或重新进入时，使用原来的昵称和密码。','muted'),
    form,button('使用正式账号登录',() => login(),'plain'),
  ])
}
function join(token) {
  if (!user || isGuest()) return guestJoin(token)
  const name = field('团队内的显示名称','', 'text',32)
  const form = el('form',null,'stack')
  const submit = el('button','加入协作室','button primary')
  form.append(name.label,submit)
  formTask(form,async () => {
    const id = await checked(client.rpc('ctb_join_room',{token,display_name:name.input.value.trim()}))
    await openRoom(id)
  })
  modal('加入协作室',[form])
}

function create() {
  if (!user || isGuest()) return login()
  const name = field('你的显示名称','', 'text',32)
  const report = field('报告标题','', 'text',100)
  const form = el('form',null,'stack')
  const submit = el('button','创建协作室','button primary')
  form.append(report.label,name.label,submit)
  formTask(form,async () => {
    const id = await checked(client.rpc('ctb_create_room',{title:report.input.value.trim(),display_name:name.input.value.trim()}))
    await openRoom(id)
  })
  modal('创建协作室',[form])
}

async function rooms() {
  if (!user) return guestJoin(invite())
  modal('我的协作室',[el('p','正在加载…','muted')])
  try {
    const [data,ownership] = await Promise.all([
      checked(client.from('ctb_rooms').select('id,title').order('created_at',{ascending:false})),
      checked(client.from('ctb_members').select('room_id').eq('user_id',user.id).eq('role','owner')),
    ])
    const listing = el('div',null,'stack')
    listing.append(...data.map(item => button(item.title, () => void openRoom(item.id),'room-list')))
    if (!data.length) listing.append(el('p','你还没有加入协作室。','muted'))
    const token = field('邀请链接或邀请码','', 'text',1000)
    const form = el('form',null,'stack')
    const submit = el('button','使用邀请','button secondary')
    form.append(token.label,submit)
    formTask(form,async () => {
      const value = parseInvite(token.input.value)
      if (!value) throw new Error('请粘贴有效的邀请码或邀请链接。')
      join(value)
    })
    const createButton = !isGuest() && !ownership.length ? [button('创建协作室', create,'primary')] : []
    modal('我的协作室',[listing,...createButton,el('hr'),form,
      button('打开本地示例',() => { close(); showDemo(true) },'plain')])
  } catch (error) {
    modal('我的协作室',[el('p',message(error),'muted'),button('重试',rooms)])
  }
}

async function share() {
  if (!room) return rooms()
  if (permissions === 'loading') return
  const id = room.id
  const controls = []
  const access = el('div',null,'member-list')
  for (const member of roster.values()) {
    const line = el('div',null,'member')
    line.append(el('span',[...member.name][0],'avatar'),el('b',member.name))
    if (permissions === 'owner' && member.role !== 'owner') {
      const select = el('select')
      select.setAttribute('aria-label',member.name + '的权限')
      for (const role of ['editor','viewer','blocked']) {
        const option = el('option',roleText[role])
        option.value = role
        select.append(option)
      }
      select.value = member.role
      select.onchange = async () => {
        select.disabled = true
        try {
          await checked(client.rpc('ctb_change_member',{room:id,member_id:member.user_id,new_role:select.value}))
          member.role = select.value
          renderMessages()
          notice('成员权限已更新。')
        } catch(error) { select.value = member.role; notice(message(error)) }
        finally { select.disabled = false }
      }
      line.append(select)
    } else line.append(el('span',roleText[member.role],'muted'))
    access.append(line)
  }
  if (permissions === 'owner') {
    const type = el('select')
    type.setAttribute('aria-label','邀请权限')
    for (const role of ['editor','viewer']) {
      const option = el('option',roleText[role]); option.value = role; type.append(option)
    }
    const row = el('div',null,'inline')
    const output = el('input')
    output.readOnly = true
    output.setAttribute('aria-label','邀请链接')
    output.placeholder = '生成后可复制'
    const issue = button('生成链接',async () => {
      issue.disabled = true
      try {
        const token = await checked(client.rpc('ctb_issue_invite',{room:id,access_role:type.value}))
        output.value = location.origin + location.pathname + '#invite=' + token
        output.select()
        try { await navigator.clipboard.writeText(output.value); notice('邀请链接已复制。') }
        catch { notice('请复制选中的链接。') }
      } catch(error) { notice(message(error)) }
      finally { issue.disabled = false }
    },'primary')
    row.append(type,issue)
    controls.push(el('p','邀请有效期为 7 天。重新生成会替换同权限的旧链接。','muted'),row,output,el('hr'))
  }
  modal('分享与成员',[...controls,access,...(permissions === 'owner' ? [button('报告备份',backups)] : [])])
}

async function docFiles() { return import('./docx.js') }
async function backup(label) {
  await checked(client.from('ctb_backups').insert({room_id:room.id,label,document:editor.getJSON()}))
}
async function backups() {
  if (permissions !== 'owner') return
  const id = room.id
  modal('报告备份',[el('p','正在加载…','muted')])
  try {
    const list = await checked(client.from('ctb_backups').select('id,label,created_at').eq('room_id',id).order('created_at',{ascending:false}).limit(50))
    const content = el('div',null,'member-list')
    for (const item of list) {
      const row = el('div',null,'member')
      row.append(el('span',item.label),el('time',new Date(item.created_at).toLocaleString('zh-CN'),'muted'),
        button('还原',() => modal('还原报告正文',[
          el('p','还原会替换团队当前正文，并先保存当前版本。','muted'),
          button('确认还原',async event => {
            const btn = event.currentTarget
            btn.disabled = true
            try {
              const data = await checked(client.from('ctb_backups').select('document').eq('room_id',id).eq('id',item.id).single())
              await backup('还原前自动备份')
              editor.commands.setContent(data.document,{errorOnInvalidContent:true})
              close()
              notice('已还原正文，正在同步。')
            } catch(error) { notice(message(error)) }
            finally { btn.disabled = false }
          },'primary'),button('取消',backups,'plain'),
        ])))
      content.append(row)
    }
    if (!list.length) content.append(el('p','还没有备份。','muted'))
    const label = field('版本名称','阶段备份')
    const form = el('form',null,'stack')
    form.append(label.label,el('button','保存当前版本','button primary'))
    formTask(form,async () => { await backup(label.input.value.trim()); notice('已保存备份。'); await backups() })
    modal('报告备份',[form,content,button('下载离线备份',async () => {
      const {download} = await docFiles()
      download(new Blob([JSON.stringify({format:'ctb-report-v1',title:$('title').value,document:editor.getJSON()},null,2)],
        {type:'application/json'}),'CTB-Junior-backup.json')
    })])
  } catch(error) { modal('报告备份',[el('p',message(error))]) }
}

$('home').onclick = rooms
$('rooms').onclick = rooms
$('activeRoom').onclick = rooms
$('share').onclick = share
$('account').onclick = () => {
  if (!user) return login()
  modal(isGuest() ? '游客身份' : '我的账户',[el('p',isGuest() ? user.user_metadata?.guest_name || '游客' : user.email,'muted'),button('退出登录',async () => {
    if (sync?.hasPending) return notice('还有修改等待同步，请先保持此页打开。')
    try { await checked(client.auth.signOut()); user = null; showDemo(true); close() }
    catch(error) { notice(message(error)) }
  })])
}
$('guide').onclick = () => modal('使用说明',[
  el('p','登录正式账号后可创建一个协作室。成员可用邀请码、昵称和密码直接加入，无需注册。'),
  el('p','多人可以同时编辑正文。看到「已同步」后，再关闭网页或在学校公用电脑退出账号。聊天在独立面板中。'),
  el('p','DOCX 适合交换文字、常见格式、表格和小图片。复杂分页、修订记录、脚注和宏可能丢失，请保留原文件。'),
])
$('title').onchange = async () => {
  const value = $('title').value.trim()
  if (!value) { title(room?.title || demoTitle); return notice('报告标题不能为空。') }
  if (!room) { demoTitle = value; title(value); persistDemo(); return }
  const active = room
  try {
    const data = await checked(client.from('ctb_rooms').update({title:value}).eq('id',active.id).select('title').single())
    if (room?.id === active.id) { room.title = data.title; title(data.title) }
  } catch(error) { if (room?.id === active.id) title(room.title); notice(message(error)) }
}
$('link').onclick = () => {
  if (!editor) return
  const link = field('链接地址',editor.getAttributes('link').href || '', 'text',2048)
  const form = el('form',null,'stack')
  form.append(link.label,el('button','应用链接','button primary'))
  formTask(form,async () => {
    const href = link.input.value.trim()
    if (!/^(https?:\/\/|mailto:)/i.test(href)) throw new Error('请输入 https://、http:// 或 mailto: 链接。')
    close()
    editor.chain().focus().extendMarkRange('link').setLink({href}).run()
  })
  modal('设置链接',[form,button('移除链接',() => { close(); editor.chain().focus().extendMarkRange('link').unsetLink().run() },'plain')])
}
$('table').onclick = () => {
  if (!editor) return
  const commands = editor.isActive('table')
    ? [['下方插入行','addRowAfter'],['右侧插入列','addColumnAfter'],['删除行','deleteRow'],['删除列','deleteColumn'],['移除表格','deleteTable']]
    : [['插入 3 × 3 表格','insertTable']]
  modal('表格',commands.map(([label,command]) => button(label,() => {
    close()
    editor.chain().focus()[command]({rows:3,cols:3,withHeaderRow:true}).run()
  })))
}
$('import').onclick = () => $('file').click()
$('file').onchange = async () => {
  const file = $('file').files[0]
  $('file').value = ''
  if (!file || !canEdit()) return
  const current = generation
  try {
    const {importDocx} = await docFiles()
    const result = await importDocx(file)
    if (generation !== current || !canEdit()) return
    modal('导入 DOCX',[el('p','文档会追加到当前正文末尾。' + (result.warnings ? '部分样式或图片可能省略。' : ''),'muted'),
      button('追加到正文',() => {
        if (generation === current && canEdit()) {
          editor.chain().focus('end').insertContentAt(editor.state.doc.content.size,result.html).run()
          notice('已导入正文。')
        }
        close()
      },'primary')])
  } catch(error) { notice(message(error)) }
}
$('export').onclick = async () => {
  if (!editor) return
  const title = $('title').value
  const data = editor.getJSON()
  $('export').disabled = true
  try {
    const {download,exportDocx} = await docFiles()
    download(await exportDocx(title,data),title.replace(/[<>:"/\\|?*]/g,'_') + '.docx')
    notice('DOCX 已下载。')
  } catch(error) { notice(message(error)) }
  finally { $('export').disabled = false }
}
$('print').onclick = () => {
  if (!editor) return
  $('print-title').textContent = $('title').value
  window.print()
}
$('chat-form').onsubmit = async event => {
  event.preventDefault()
  const body = $('chat-input').value.trim()
  if (!body) return
  const submit = event.currentTarget.lastElementChild
  submit.disabled = true
  const current = generation
  try {
    if (sync) await sync.chat(body)
    else if (permissions === 'demo') {
      chatEvent({event_id:crypto.randomUUID(),position:Date.now(),created_at:new Date().toISOString(),author_id:'demo',body})
      save('ctb:demo:chat',[...messages.values()].slice(-60))
    }
    if (generation === current && $('chat-input').value.trim() === body) $('chat-input').value = ''
  } catch(error) { notice(message(error)) }
  finally { submit.disabled = permissions === 'loading' }
}
function chatOpen(open) {
  root.classList.toggle('chat-closed',!open)
  $('chatToggle').setAttribute('aria-expanded',String(open))
  $('chat').inert = !open
}
chatOpen(!matchMedia('(max-width: 850px)').matches)
$('chatToggle').onclick = () => chatOpen(root.classList.contains('chat-closed'))
$('closeChat').onclick = () => { chatOpen(false); $('chatToggle').focus() }
window.addEventListener('beforeunload', event => {
  if (sync?.hasPending) { event.preventDefault(); event.returnValue = '' }
})
async function boot() {
  showDemo()
  if (client) {
    client.auth.onAuthStateChange((event, session) => {
      user = session?.user || null
      updateAccount()
      if (event === 'SIGNED_OUT' && room) showDemo(true)
    })
    try { user = (await checked(client.auth.getSession())).session?.user || null }
    catch(error) { notice(message(error)) }
    updateAccount()
  }
  if (invite()) join(invite())
  else if (uuid.test(address().get('room') || '')) {
    if (user) await openRoom(address().get('room'))
    else login()
  }
}
window.addEventListener('hashchange', () => {
  if (invite()) join(invite())
  else if (uuid.test(address().get('room') || '')) user ? void openRoom(address().get('room')) : login()
})
void boot()
