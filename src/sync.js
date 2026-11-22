import * as Y from 'yjs'

export const REMOTE = Symbol('remote')
const bytesToBase64 = bytes => {
  let result = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    result += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return btoa(result)
}
export const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0))

export function connectRoom(client, room, user, doc, callbacks, canEdit) {
  const storageKey = 'ctb:pending:' + user + ':' + room
  let storageAvailable = true
  let pending = []
  try {
    pending = JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch { storageAvailable = false }
  let cursor = 0
  let stopped = false
  let pulling = false
  let flushing = false
  let timer
  let realtime = false
  let networkIssue = false

  function status() {
    if (stopped) return
    callbacks.status(networkIssue
      ? (pending.length ? '未同步 · 等待重连' : '连接中断 · 正在重试')
      : pending.length ? (storageAvailable ? '正在保存…' : '未保存 · 请勿关闭')
        : realtime ? '已同步' : '已同步 · 轮询')
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(pending)); storageAvailable = true }
    catch { storageAvailable = false }
  }
  function receive(event) {
    if (stopped) return
    if (event.kind === 'chat') callbacks.chat(event)
    else {
      try {
        Y.applyUpdate(doc, fromBase64(event.body), REMOTE)
        if (event.caret && event.author_id !== user) callbacks.caret(event)
      }
      catch { callbacks.invalid() }
    }
  }
  async function pull() {
    if (stopped || pulling) return false
    pulling = true
    try {
      while (!stopped) {
        const { data, error } = await client.from('ctb_events').select('*').eq('room_id', room)
          .gt('position', cursor).order('position').limit(40)
        if (error) throw error
        if (stopped) return false
        for (const event of data) {
          receive(event)
          cursor = event.position
        }
        if (data.length < 40) break
      }
      networkIssue = false
      status()
      return true
    } catch {
      networkIssue = true
      status()
      return false
    } finally { pulling = false }
  }
  async function flush() {
    if (stopped || flushing || !pending.length || !canEdit()) return
    flushing = true
    try {
      while (!stopped && pending.length && canEdit()) {
        const event = pending[0]
        if (!Object.hasOwn(event,'caret')) {
          const caret = pending.length === 1 ? callbacks.localCaret() : null
          if (caret) event.caret = caret
        }
        const { error } = await client.from('ctb_events').upsert(event, {
          onConflict: 'room_id,event_id', ignoreDuplicates: true,
        })
        if (error) throw error
        pending.shift()
        persist()
      }
      networkIssue = false
    } catch { networkIssue = true }
    finally { flushing = false; status() }
  }
  function queue(update, origin) {
    if (origin === REMOTE || stopped || !canEdit()) return
    // Persist each edit immediately. Merge a short burst before sending unless a request is in flight.
    const previous = pending.at(-1)
    const merged = previous && (!flushing || pending.length > 1)
      && previous.body.length + update.length * 1.34 < 1050000
    if (merged) {
      previous.body = bytesToBase64(Y.mergeUpdates([fromBase64(previous.body), update]))
    } else {
      pending.push({room_id: room, event_id: crypto.randomUUID(), kind: 'edit', body: bytesToBase64(update)})
    }
    persist()
    status()
    clearTimeout(timer)
    timer = setTimeout(flush, 220)
  }

  const channel = client.channel('ctb:' + room + ':' + crypto.randomUUID())
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'ctb_events', filter:'room_id=eq.' + room},
      ({new: event}) => receive(event))
  const refresh = async () => {
    if (stopped) return
    const access = await callbacks.access()
    if (access === false || stopped) return
    await pull()
    await flush()
  }
  const interval = setInterval(refresh, 4500)
  window.addEventListener('online', refresh)

  return {
    async start() {
      const loaded = await pull()
      if (stopped) return false
      if (!loaded) return false
      if (canEdit()) for (const event of pending) receive(event)
      doc.on('update', queue)
      channel.subscribe(state => {
        realtime = state === 'SUBSCRIBED'
        status()
        if (realtime) void refresh()
      })
      void flush()
      return true
    },
    async chat(body) {
      const event = {room_id: room, event_id: crypto.randomUUID(), kind: 'chat', body}
      const {data, error} = await client.from('ctb_events').insert(event).select().single()
      if (error) throw error
      receive(data)
    },
    get hasPending() { return pending.length > 0 },
    stop() {
      stopped = true
      clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener('online', refresh)
      doc.off('update', queue)
      void client.removeChannel(channel)
    },
  }
}
