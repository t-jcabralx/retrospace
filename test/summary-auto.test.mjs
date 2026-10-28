import test from 'node:test'
import assert from 'node:assert/strict'
import { KEY, logged, setBackgroundRunner, addOps, ann, background, board, call, drain, fakeUpstash, generate, getStore, getSummary, makeBoard, net, note, patch, published, readyBoard, reply, requests, signUp, snapshot, status, windowHit, assertCleanLogs } from './helpers/summary-harness.mjs'

test('state: generating is visible to everyone as such, a second press is 409 "Already writing", then it is idle', async () => {
  const owner = await signUp('Sol Owner')
  const { code, guest } = await readyBoard(owner)
  let release
  const gate = new Promise((r) => { release = r })
  net.behave = async () => { await gate; return reply('Late summary') }
  const first = generate(code, owner.cookie)
  await new Promise((r) => setTimeout(r, 30))
  const mid = await getSummary(code, owner.cookie)
  assert.deepEqual([mid.data.summaryState, mid.data.summary], ['generating', null])
  assert.equal((await snapshot(code, guest)).data.board.summaryState, 'generating')
  assert.equal((await snapshot(code, owner.cookie)).data.board.summaryState, 'generating')
  const again = await generate(code, owner.cookie)
  assert.deepEqual([again.status, again.data.error], [409, 'Already writing'])
  const calls = requests.length
  release()
  const done = await first
  assert.equal(done.status, 200)
  assert.equal(requests.length, calls, 'the second press never reached the provider')
  assert.deepEqual([(await getSummary(code, owner.cookie)).data.summaryState, (await snapshot(code, guest)).data.board.summaryState], ['idle', 'idle'])
  net.behave = () => reply('Summary from the stub')
})

test('a generating flag older than a minute is stale: the owner sees it failed and can generate again', async () => {
  const { code, guest } = await readyBoard(ann)
  await getStore().updateBoard(code, { summaryState: 'generating', summaryStartedAt: Date.now() - 61_000 })
  const seen = await getSummary(code, ann.cookie)
  assert.deepEqual([seen.data.summaryState, seen.data.summaryError], ['failed', 'timeout'])
  assert.equal((await snapshot(code, guest)).data.board.summaryState, 'idle')
  assert.equal((await generate(code, ann.cookie)).status, 200)
  assert.equal((await getSummary(code, ann.cookie)).data.summaryState, 'idle')
})

test('the sixth summary on a board in an hour is 429 with Retry-After, and it never reaches the provider', async () => {
  const owner = await signUp('Tim Owner')
  const { code } = await readyBoard(owner)
  const other = await readyBoard(owner)
  for (let i = 0; i < 5; i++) assert.equal((await generate(code, owner.cookie)).status, 200, `request ${i + 1}`)
  const before = requests.length
  const sixth = await generate(code, owner.cookie)
  assert.equal(sixth.status, 429)
  assert.ok(Number(sixth.res.headers.get('retry-after')) >= 1)
  assert.equal(requests.length, before)
  assert.equal((await generate(other.code, owner.cookie)).status, 200, 'another board has its own allowance')
})

test('40 summaries a day per owner: the 41st is 429 whatever the board', async () => {
  const owner = await signUp('Una Owner')
  const { code } = await readyBoard(owner)
  for (let i = 0; i < 40; i++) await windowHit(`aisum:u:${owner.id}`, 24 * 60 * 60_000, { localFallback: true })
  const before = requests.length
  const r = await generate(code, owner.cookie)
  assert.equal(r.status, 429)
  assert.ok(Number(r.res.headers.get('retry-after')) >= 1)
  assert.equal(requests.length, before)
  // the board's own slot was given back
  for (let i = 0; i < 6; i++) assert.equal((await generate(code, owner.cookie)).status, 429)
})

test('provider failures become friendly codes and leak neither the key nor the provider text; only a rejected request gives its slot back', async () => {
  const owner = await signUp('Vic Owner')
  const { code, guest } = await readyBoard(owner)
  const cases = [
    [() => status(401), 503, 'misconfigured'], // rejected: the slot comes back
    [() => status(400), 503, 'misconfigured'], // rejected: the slot comes back
    [() => status(429), 503, 'busy'],
    [() => status(500), 503, 'unavailable'],
    [() => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }) }, 504, 'timeout'],
    [() => new Response(JSON.stringify({ content: [{ type: 'text', text: '  ' }] }), { status: 200 }), 502, 'empty'],
  ]
  for (const [make, httpStatus, errCode] of cases) {
    net.behave = make
    const r = await generate(code, owner.cookie)
    assert.deepEqual([r.status, r.data.code], [httpStatus, errCode], errCode)
    assert.equal(typeof r.data.error, 'string')
    assert.ok(!r.text.includes('PROVIDER-SECRET') && !r.text.includes(KEY))
    assert.ok(!/unavailable/i.test(r.data.error) || errCode === 'unavailable', 'a rejected request is not reported as an outage')
    const state = await getSummary(code, owner.cookie)
    assert.deepEqual([state.data.summaryState, state.data.summaryError, state.data.summary], ['failed', errCode, null])
    const g = await snapshot(code, guest)
    assert.equal(g.data.board.summaryState, 'idle', 'a failure is never shown to guests')
    assert.ok(!g.text.includes(errCode) && !g.text.includes('summaryError'))
  }
  // busy, unavailable, timeout and empty were possibly billed and kept their slot (4 used); the two rejected ones did not count.
  net.behave = () => reply('Recovered')
  assert.equal((await generate(code, owner.cookie)).status, 200, 'the fifth slot is still there')
  assert.equal((await getSummary(code, owner.cookie)).data.summaryState, 'idle')
  const sixth = await generate(code, owner.cookie)
  assert.equal(sixth.status, 429, 'the possibly-billed failures did use their slots')
  net.behave = () => reply('Summary from the stub')
})

test('a failed generation publishes only idle and generating: no failure, no code, no provider text', async () => {
  const owner = await signUp('Fay Owner')
  const { code } = await readyBoard(owner)
  net.behave = () => status(500)
  await fakeUpstash(async (cmds) => {
    const r = await generate(code, owner.cookie)
    assert.equal(r.status, 503)
    const envs = published(cmds)
    assert.ok(envs.length >= 2, 'generating, then back to idle')
    assert.ok(envs.every((e) => e.t === 'board' && (e.board.summaryState === 'idle' || e.board.summaryState === 'generating') && e.board.summary === null))
    assert.equal(envs.at(-1).board.summaryState, 'idle')
    const bytes = cmds.filter((c) => c[0] === 'publish').map((c) => c[2]).join('\n')
    for (const needle of ['failed', 'summaryError', 'unavailable', 'busy', 'misconfigured', 'PROVIDER-SECRET']) assert.ok(!bytes.includes(needle), `${needle} must not be published`)
  })
  net.behave = () => reply('Summary from the stub')
})

// A generation that is slow on purpose, so the owner can act while it runs.
function gated(text = 'Slow summary') {
  let open
  const gate = new Promise((r) => { open = r })
  net.behave = async () => { await gate; return reply(text) }
  return open
}

test('an owner\'s own edit made while the model is writing is never overwritten: the late result is dropped', async () => {
  const owner = await signUp('Gil Owner')
  const { code } = await readyBoard(owner)
  const open = gated()
  const slow = generate(code, owner.cookie)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal((await patch(code, { summary: { text: 'Written by hand meanwhile' } }, owner.cookie)).status, 200)
  open()
  const r = await slow
  assert.deepEqual([r.status, r.data.code], [409, 'discarded'])
  const now = await getSummary(code, owner.cookie)
  assert.deepEqual([now.data.summary.text, now.data.summary.source, now.data.summaryState], ['Written by hand meanwhile', 'manual', 'idle'])
  net.behave = () => reply('Summary from the stub')
})

test('AI switched off while the model is writing: the result is dropped and the state goes back to idle', async () => {
  const owner = await signUp('Hal Owner')
  const { code } = await readyBoard(owner)
  const open = gated()
  const slow = generate(code, owner.cookie)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal((await patch(code, { ai: { enabled: false } }, owner.cookie)).status, 200)
  open()
  const r = await slow
  assert.deepEqual([r.status, r.data.code], [409, 'discarded'])
  const now = await getSummary(code, owner.cookie)
  assert.deepEqual([now.data.summary, now.data.summaryState], [null, 'idle'])
  net.behave = () => reply('Summary from the stub')
})

test('an automatic summary uses autoShare as it is when it finishes, not as it was when the board was closed', async () => {
  for (const [at, later, expected] of [[true, false, 'draft'], [false, true, 'shared']]) {
    const owner = await signUp('Ida Owner')
    const { code } = await readyBoard(owner, { ai: { autoSummary: true, autoShare: at } })
    const open = gated()
    assert.equal((await patch(code, { status: 'closed' }, owner.cookie)).status, 200)
    assert.equal((await patch(code, { ai: { autoShare: later } }, owner.cookie)).status, 200)
    open()
    await drain()
    assert.equal((await getSummary(code, owner.cookie)).data.summary.status, expected, `autoShare ${at} -> ${later}`)
  }
  net.behave = () => reply('Summary from the stub')
})

test('if after() cannot be used the PATCH still answers, the slot is released and the closure can be tried again', async () => {
  const owner = await signUp('Jo Owner')
  const { code } = await readyBoard(owner, { ai: { autoSummary: true } })
  const calls = requests.length
  setBackgroundRunner(() => { throw new Error('after is unavailable') })
  try {
    const closed = await patch(code, { status: 'closed' }, owner.cookie)
    assert.equal(closed.status, 200)
    assert.deepEqual([closed.data.board.status, closed.data.board.summaryState, closed.data.board.summary], ['closed', 'idle', null])
  } finally {
    setBackgroundRunner((task) => { background.push(Promise.resolve().then(task)) })
    const at = logged.findIndex((l) => l.includes('could not schedule the automatic summary'))
    assert.ok(at >= 0, 'the failure is logged (message only)')
    logged.splice(at, 1)
  }
  assert.equal(requests.length, calls)
  const stored = await getStore().getBoard(code)
  assert.equal(stored.summaryState, 'idle')
  assert.ok(await getStore().claimSummary(code, { staleMs: 60_000, autoFor: stored.closedAt }), 'that closure can still get its automatic summary')
})

test('a legacy closed board with no closedAt: closing it again starts no automatic summary', async () => {
  const owner = await signUp('Kim Owner')
  const { code } = await readyBoard(owner, { ai: { autoSummary: true } })
  await getStore().updateBoard(code, { status: 'closed', closedAt: null })
  const calls = requests.length
  assert.equal((await patch(code, { status: 'closed' }, owner.cookie)).status, 200)
  assert.equal(background.length, 0)
  await drain()
  assert.equal(requests.length, calls)
  assert.equal((await getSummary(code, owner.cookie)).data.summaryState, 'idle')
})

test('closing with automatic summaries on writes ONE draft in the background; the PATCH does not wait for it', async () => {
  const owner = await signUp('Wes Owner')
  const { code, guest } = await readyBoard(owner, { ai: { autoSummary: true } })
  let release
  const gate = new Promise((r) => { release = r })
  net.behave = async () => { await gate; return reply('Auto summary') }
  const calls = requests.length
  const closed = await patch(code, { status: 'closed' }, owner.cookie)
  assert.equal(closed.status, 200)
  assert.equal(closed.data.board.status, 'closed')
  assert.equal(closed.data.board.summaryState, 'generating', 'the PATCH answered while the provider was still being waited on')
  assert.equal(closed.data.board.summary, null)
  assert.equal(background.length, 1)
  // closing again (a repeated PATCH) starts nothing
  assert.equal((await patch(code, { status: 'closed' }, owner.cookie)).status, 200)
  assert.equal(background.length, 1)
  release()
  await drain()
  assert.equal(requests.length, calls + 1, 'exactly one provider call')
  const done = await getSummary(code, owner.cookie)
  assert.deepEqual([done.data.summaryState, done.data.summary.status, done.data.summary.source, done.data.summary.text], ['idle', 'draft', 'ai', 'Auto summary'])
  assert.equal((await snapshot(code, guest)).data.board.summary, null, 'autoShare is off, so it is a draft')
  // closed again later (another PATCH) still nothing
  await patch(code, { status: 'closed' }, owner.cookie)
  await drain()
  assert.equal(requests.length, calls + 1)
  // reopening and closing again is a new closure
  await patch(code, { status: 'open' }, owner.cookie)
  net.behave = () => reply('Second closure')
  await patch(code, { status: 'closed' }, owner.cookie)
  await drain()
  assert.equal(requests.length, calls + 2)
  assert.equal((await getSummary(code, owner.cookie)).data.summary.text, 'Second closure')
  net.behave = () => reply('Summary from the stub')
})

test('two racing close requests start one summary', async () => {
  const owner = await signUp('Xan Owner')
  const { code } = await readyBoard(owner, { ai: { autoSummary: true } })
  const calls = requests.length
  const both = await Promise.all([patch(code, { status: 'closed' }, owner.cookie), patch(code, { status: 'closed' }, owner.cookie)])
  assert.deepEqual(both.map((r) => r.status), [200, 200])
  await drain()
  assert.equal(requests.length, calls + 1)
})

test('with autoShare the automatic summary is shared and labelled AI-generated; guests see it, live', async () => {
  const owner = await signUp('Yas Owner')
  const { code, guest } = await readyBoard(owner, { ai: { autoSummary: true, autoShare: true } })
  await fakeUpstash(async (cmds) => {
    await patch(code, { status: 'closed' }, owner.cookie)
    await drain()
    const s = (await getSummary(code, owner.cookie)).data.summary
    assert.deepEqual([s.status, s.source], ['shared', 'ai'])
    const g = await snapshot(code, guest)
    assert.deepEqual(g.data.board.summary, { text: 'Summary from the stub', status: 'shared', source: 'ai', editedAt: null })
    const last = published(cmds).at(-1)
    assert.equal(last.board.summary.text, 'Summary from the stub')
    assert.equal(last.board.summaryState, 'idle')
    assert.ok(!('ai' in last.board) && !('model' in last.board.summary))
  })
})

test('closing does nothing when AI is off, not acknowledged, or auto-summary is off', async () => {
  const owner = await signUp('Zed Owner')
  const calls = requests.length
  const off = await makeBoard(owner) // AI never enabled
  await addOps(off, owner.cookie, note('a', 20, 200, 'x'))
  await patch(off, { status: 'closed' }, owner.cookie)
  const manual = (await readyBoard(owner)).code // AI on, autoSummary off
  await patch(manual, { status: 'closed' }, owner.cookie)
  const unacked = await makeBoard(owner)
  await addOps(unacked, owner.cookie, note('a', 20, 200, 'x'))
  await getStore().updateBoard(unacked, { ai: { enabled: true, ackAt: null, autoSummary: true, autoShare: false } })
  await patch(unacked, { status: 'closed' }, owner.cookie)
  const disabled = (await readyBoard(owner, { ai: { autoSummary: true } })).code
  await patch(disabled, { ai: { enabled: false } }, owner.cookie)
  await patch(disabled, { status: 'closed' }, owner.cookie)
  assert.equal(background.length, 0)
  await drain()
  assert.equal(requests.length, calls)
  for (const c of [off, manual, unacked, disabled]) assert.equal((await getStore().getBoard(c)).summary ?? null, null)
})

test('an automatic summary that fails leaves the owner a "failed" state with a code, and guests nothing', async () => {
  const owner = await signUp('Abe Owner')
  const { code, guest } = await readyBoard(owner, { ai: { autoSummary: true } })
  net.behave = () => status(500)
  const closed = await patch(code, { status: 'closed' }, owner.cookie)
  assert.equal(closed.status, 200)
  await drain()
  const state = await getSummary(code, owner.cookie)
  assert.deepEqual([state.data.summaryState, state.data.summaryError, state.data.summary], ['failed', 'unavailable', null])
  const g = await snapshot(code, guest)
  assert.deepEqual([g.data.board.summaryState, g.data.board.summary], ['idle', null])
  // the owner can retry from the panel
  net.behave = () => reply('Retried')
  assert.equal((await generate(code, owner.cookie)).status, 200)
  net.behave = () => reply('Summary from the stub')
})

test('an automatic summary respects the rate limit and does not run when the key is gone', async () => {
  const owner = await signUp('Bea Owner')
  const { code } = await readyBoard(owner, { ai: { autoSummary: true } })
  for (let i = 0; i < 5; i++) await windowHit(`aisum:b:${code}`, 60 * 60_000, { localFallback: true })
  const calls = requests.length
  await patch(code, { status: 'closed' }, owner.cookie)
  await drain()
  assert.equal(requests.length, calls)
  const state = await getSummary(code, owner.cookie)
  assert.deepEqual([state.data.summaryState, state.data.summaryError], ['failed', 'limit'])

  const noKey = await readyBoard(owner, { ai: { autoSummary: true } })
  delete process.env.ANTHROPIC_API_KEY
  try {
    await patch(noKey.code, { status: 'closed' }, owner.cookie)
    await drain()
  } finally { process.env.ANTHROPIC_API_KEY = KEY }
  assert.equal(requests.length, calls)
  assert.equal((await getSummary(noKey.code, owner.cookie)).data.summaryState, 'idle', 'nothing was claimed, nothing failed')
})

test('the key and the board\'s text never reach a log; the only provider log is one line of counts', () => assertCleanLogs())
