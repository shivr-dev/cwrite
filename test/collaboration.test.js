import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import * as Y from 'yjs'

const owner = '10000000-0000-4000-8000-000000000001'
const viewer = '10000000-0000-4000-8000-000000000002'
const editor = '10000000-0000-4000-8000-000000000003'
const outsider = '10000000-0000-4000-8000-000000000004'
const guest = '10000000-0000-4000-8000-000000000005'
const event = '20000000-0000-4000-8000-000000000001'
const migrationPath = new URL('../supabase/migrations/20261122072142_ctb_workspace.sql', import.meta.url)
const guestPath = new URL('../supabase/migrations/20261122073729_ctb_guest_access.sql', import.meta.url)

test('room isolation, invite lifecycle, editing roles, chat, and backup access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      grant usage on schema auth to anon, authenticated;
      create publication supabase_realtime;
    `)
    for (const id of [owner,viewer,editor,outsider,guest]) await db.query('insert into auth.users values ($1)',[id])
    await db.exec(await readFile(migrationPath, 'utf8'))
    await db.exec(await readFile(guestPath, 'utf8'))
    const act = async (id,claims = {}) => {
      await db.exec('reset role; set role authenticated;')
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)])
    }
    const scalar = async (sql, args = []) => Object.values((await db.query(sql,args)).rows[0])[0]
    await act(owner)
    const room = await scalar("select public.ctb_create_room('Report','Owner')")
    await assert.rejects(db.query("select public.ctb_create_room('Second','Owner')"),/already own/i)
    const old = await scalar("select public.ctb_issue_invite($1,'viewer')",[room])
    const reading = await scalar("select public.ctb_issue_invite($1,'viewer')",[room])
    const writing = await scalar("select public.ctb_issue_invite($1,'editor')",[room])
    await db.query("insert into ctb_backups (room_id,label,document) values ($1,'stage','{\"type\":\"doc\"}')",[room])
    await act(outsider)
    assert.equal(await scalar('select count(*)::int from ctb_rooms'),0)
    assert.equal(await scalar('select count(*)::int from ctb_members'),0)
    assert.equal(await scalar('select count(*)::int from ctb_events'),0)
    await assert.rejects(db.query("select public.ctb_join_room($1,'Outsider')",[old]),/expired or invalid/i)
    await assert.rejects(db.query("select public.ctb_issue_invite($1,'editor')",[room]),/owner required/i)
    await act(viewer)
    assert.equal(await scalar("select public.ctb_join_room($1,'Viewer')",[reading]),room)
    assert.equal(await scalar("select public.ctb_join_room($1,'Viewer')",[writing]),room)
    assert.equal(await scalar("select role from ctb_members where user_id=$1",[viewer]),'viewer')
    assert.equal(await scalar('select count(*)::int from ctb_backups'),0)
    await assert.rejects(db.query("insert into ctb_events(room_id,event_id,kind,body) values ($1,$2,'edit','a')",[room,event]),/row-level security/)
    await db.query("insert into ctb_events(room_id,event_id,kind,body) values ($1,$2,'chat','hi')",[room,event])
    assert.equal(await scalar('select author_id from ctb_events where event_id=$1',[event]),viewer)
    await act(editor)
    await scalar("select public.ctb_join_room($1,'Editor')",[writing])
    await db.query("insert into ctb_events(room_id,event_id,kind,body) values ($1,gen_random_uuid(),'edit','b')",[room])
    await assert.rejects(db.query("insert into ctb_events(room_id,event_id,kind,body,author_id) values ($1,gen_random_uuid(),'chat','x',$2)",[room,owner]),/permission denied/)
    assert.equal((await db.query("update ctb_rooms set title='No' where id=$1 returning id",[room])).rows.length,0)
    await act(owner)
    assert.equal(await scalar('select count(*)::int from ctb_events'),2)
    assert.equal(await scalar('select count(*)::int from ctb_backups'),1)
    await db.query("select public.ctb_change_member($1,$2,'blocked')",[room,editor])
    await act(editor)
    assert.equal(await scalar('select count(*)::int from ctb_events'),0)
    await assert.rejects(db.query("select public.ctb_join_room($1,'Editor')",[writing]),/access revoked/i)
    await act(outsider)
    const otherRoom = await scalar("select public.ctb_create_room('Other report','Outsider')")
    const otherInvite = await scalar("select public.ctb_issue_invite($1,'editor')",[otherRoom])
    await act(guest,{app_metadata:{ctb_guest_room:room},email:'fixture@guest.cwrite.invalid'})
    await assert.rejects(db.query("select public.ctb_create_room('Guest report','Guest')"),/account is required/i)
    await assert.rejects(db.query('select public.ctb_guest_invite($1)',[writing]),/permission denied/i)
    await assert.rejects(db.query("select public.ctb_join_room($1,'Guest')",[otherInvite]),/expired or invalid/i)
    assert.equal(await scalar("select public.ctb_join_room($1,'Guest')",[writing]),room)
    await db.exec('reset role; set role service_role;')
    assert.equal(await scalar('select public.ctb_guest_invite($1)',[writing]),room)
    assert.equal(await scalar('select public.ctb_guest_invite($1)',[old]),null)
    for (let attempt = 0; attempt < 49; attempt++) await scalar('select public.ctb_guest_invite($1)',[writing])
    assert.equal(await scalar('select public.ctb_guest_invite($1)',[writing]),null)
    await db.exec("reset role; set role anon;")
    await assert.rejects(db.query('select * from ctb_rooms'),/permission denied/)
    await assert.rejects(db.query("select public.ctb_create_room('X','Y')"),/permission denied/)
  } finally { await db.close() }
})

test('concurrent document changes merge after delayed delivery and replay', () => {
  const a = new Y.Doc(), b = new Y.Doc(), reopened = new Y.Doc()
  a.getText('report').insert(0,'前言：')
  const initial = Y.encodeStateAsUpdate(a)
  Y.applyUpdate(b,initial)
  const base = Y.encodeStateVector(a)
  a.getText('report').insert(3,'甲组')
  b.getText('report').insert(3,'乙组')
  const editA = Y.encodeStateAsUpdate(a,base)
  const editB = Y.encodeStateAsUpdate(b,base)
  Y.applyUpdate(a,editB)
  Y.applyUpdate(b,editA)
  for (const update of [editB,initial,editA,editB]) Y.applyUpdate(reopened,update)
  assert.equal(a.getText('report').toString(),b.getText('report').toString())
  assert.equal(reopened.getText('report').toString(),a.getText('report').toString())
  assert.match(reopened.getText('report').toString(),/前言：(甲组乙组|乙组甲组)/)
  a.destroy(); b.destroy(); reopened.destroy()
})
