import test from 'node:test'
import assert from 'node:assert/strict'
import { addOps, ann, bob, call, fakeUpstash, getStore, makeBoard, newGuest, note, opsRoute, patch, published, snapshot } from './helpers/summary-harness.mjs'
import { defaultRetro } from '../src/lib/retro.js'
import { viewerBoard } from '../src/lib/access.js'

const ops = (code, cookie, ...o) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops: o } })
const action = (id, text = 'Fix CI') => ({ op: 'add', item: { id, kind: 'action', x: 0, y: 0, w: 280, h: 200, data: { action: text } } })

test('a new retro board starts with the default workflow; other types and old boards have none', async () => {
  const code = await makeBoard(ann)
  const snap = await snapshot(code, ann.cookie)
  assert.deepEqual(snap.data.board.retro, defaultRetro())
  for (const body of [{ type: 'workshop', template: 'blank', title: 'W' }, { type: 'celebration', template: 'birthday', title: 'C', recipient: { name: 'Zed' } }]) {
    const c = await makeBoard(ann, body)
    assert.equal('retro' in (await snapshot(c, ann.cookie)).data.board, false, body.type)
  }
})

test('custom columns at creation still work with the workflow', async () => {
  const code = await makeBoard(ann, { type: 'retro', template: 'retro-wwci', title: 'R', columns: [{ title: 'One' }, { title: 'Two' }] })
  const snap = await snapshot(code, ann.cookie)
  assert.ok(snap.data.board.retro)
  assert.deepEqual(snap.data.items.filter((i) => i.kind === 'frame').map((f) => f.data.title), ['One', 'Two'])
})

test('only the owner can drive the workflow', async () => {
  const code = await makeBoard(ann)
  const guest = await newGuest(code)
  assert.ok([401, 403].includes((await patch(code, { retro: { type: 'next' } }, guest)).status))
  assert.ok([401, 403].includes((await patch(code, { retro: { type: 'next' } }, undefined)).status))
  assert.ok([401, 403].includes((await patch(code, { retro: { type: 'next' } }, bob.cookie)).status))
  assert.equal((await snapshot(code, ann.cookie)).data.board.retro.current, 0)
  const ok = await patch(code, { retro: { type: 'start' } }, ann.cookie)
  assert.equal(ok.status, 200)
  assert.equal(ok.data.board.retro.stageStartedAt > 0, true)
  assert.equal((await patch(code, { retro: { type: 'goto', index: 99 } }, ann.cookie)).status, 400)
  assert.equal((await patch(code, { retro: { current: 4 } }, ann.cookie)).status, 400)
  assert.equal((await patch(code, { retro: { type: 'next', ownerId: 'x' } }, ann.cookie)).status, 400)
})

test('stage rules end to end: notes, votes and actions follow the stage', async () => {
  const code = await makeBoard(ann)
  const guest = await newGuest(code)
  const stage = async (index) => assert.equal((await patch(code, { retro: { type: 'goto', index } }, ann.cookie)).status, 200)
  const first = async (r) => r.data.rejected?.[0]?.error ?? 'ok'

  assert.equal(await first(await ops(code, guest, note('g1', 10, 10, 'early'))), 'This stage is closed for notes') // Join
  await stage(1) // Collect
  assert.equal(await first(await ops(code, guest, note('g1', 10, 10, 'ok'))), 'ok')
  assert.equal((await patch(code, { retro: { type: 'setEditing', value: false } }, ann.cookie)).status, 200)
  assert.equal(await first(await ops(code, guest, note('g2', 10, 10, 'locked'))), 'This stage is closed for notes')
  await addOps(code, ann.cookie, note('o1', 300, 10, 'owner always'))
  assert.equal(await first(await ops(code, guest, { op: 'vote', id: 'o1' })), 'Voting is not open')

  await stage(3) // Vote opens the shared vote and starts the timer
  const snap = (await snapshot(code, guest)).data.board
  assert.deepEqual(snap.vote, { active: true, perPerson: 3 })
  assert.ok(snap.timer?.endsAt > Date.now())
  assert.equal(await first(await ops(code, guest, { op: 'vote', id: 'o1' })), 'ok')
  assert.equal(await first(await ops(code, guest, action('a1'))), 'Actions are not open yet')

  await stage(4) // leaving Vote closes it
  assert.equal((await snapshot(code, guest)).data.board.vote.active, false)
  await stage(5) // Actions, 3 allowed
  assert.equal((await patch(code, { retro: { type: 'config', maxActions: 2 } }, ann.cookie)).status, 200)
  assert.equal(await first(await ops(code, guest, action('a1'))), 'ok')
  assert.equal(await first(await ops(code, guest, action('a2'))), 'ok')
  assert.equal(await first(await ops(code, guest, action('a3'))), 'Action limit reached')
  assert.equal(await first(await ops(code, ann.cookie, action('a3'))), 'ok')
  assert.equal((await getStore().listItems(code)).filter((i) => i.kind === 'action').length, 3)
})

test('the broadcast carries retro to guests and nothing private', async () => {
  const code = await makeBoard(ann)
  await fakeUpstash(async (cmds) => {
    assert.equal((await patch(code, { retro: { type: 'next' } }, ann.cookie, { cid: 'c'.repeat(8) })).status, 200)
    const msg = published(cmds).find((m) => m.t === 'board')
    assert.ok(msg, 'a board envelope was published')
    assert.equal(msg.board.retro.current, 1)
    assert.equal('ownerId' in msg.board || 'createdBy' in msg.board || 'passcodeHash' in msg.board, false)
  })
})

test('viewerBoard is unchanged apart from carrying retro through', () => {
  const base = { code: 'ABC123', type: 'retro', title: 'T', ownerId: 'u1', createdBy: 'u1', passcodeHash: 'h', status: 'open', ai: { enabled: false }, vote: { active: false, perPerson: 3 } }
  const withRetro = { ...base, retro: defaultRetro() }
  const { retro, ...rest } = viewerBoard(withRetro, 'guest')
  assert.deepEqual(rest, viewerBoard(base, 'guest'))
  assert.deepEqual(retro, defaultRetro())
  assert.equal('ownerId' in viewerBoard(withRetro, 'guest'), false)
})
