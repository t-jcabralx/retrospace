import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getAuth, refreshAuth, setSignedIn, signOut, hasInflight, resetAuthForTests, SIGN_OUT_ERROR } from '../src/ui/site/authStore.js'

const realFetch = globalThis.fetch
const reply = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const USER = { id: 'u_1', name: 'Ada', email: 'ada@example.com' }

// A fetch whose answers are released by hand, in any order.
function manual() {
  const calls = []
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => calls.push({ url, init, resolve, reject }))
  return calls
}

beforeEach(() => resetAuthForTests())
afterEach(() => { globalThis.fetch = realFetch })

test('a /me answer sets in or out; the soft flag is used so a signed-out visitor is not a 401', async () => {
  const calls = manual()
  const p = refreshAuth()
  assert.equal(calls[0].url, '/api/auth/me?soft=1')
  calls[0].resolve(reply(200, { user: null }))
  await p
  assert.equal(getAuth().status, 'out')
  const q = refreshAuth()
  calls[1].resolve(reply(200, { user: USER }))
  await q
  assert.deepEqual(getAuth(), { status: 'in', user: USER })
})

test('a slow initial /me that answers "out" after a sign-in does not overwrite the signed-in state', async () => {
  const calls = manual()
  const slow = refreshAuth()
  setSignedIn(USER) // the person signed in while the first check was still on the wire
  calls[0].resolve(reply(200, { user: null }))
  await slow
  assert.equal(getAuth().status, 'in')
})

test('answers arriving out of order: only the newest refresh counts', async () => {
  const calls = manual()
  const first = refreshAuth()
  const second = refreshAuth()
  calls[1].resolve(reply(200, { user: USER }))
  await second
  calls[0].resolve(reply(200, { user: null }))
  await first
  assert.equal(getAuth().status, 'in')
})

test('a failed check is remembered as an error and retried: nothing stays in flight', async () => {
  const calls = manual()
  const p = refreshAuth()
  assert.equal(hasInflight(), true)
  calls[0].reject(new TypeError('network down'))
  await p
  assert.equal(getAuth().status, 'error')
  assert.equal(hasInflight(), false, 'the next mount asks again')
  globalThis.fetch = async () => reply(200, { user: USER })
  await refreshAuth()
  assert.equal(getAuth().status, 'in')
})

test('a 500 from /me is an error, not "signed out"', async () => {
  globalThis.fetch = async () => reply(500, { error: 'boom' })
  await refreshAuth()
  assert.equal(getAuth().status, 'error')
  assert.equal(hasInflight(), false)
})

test('signOut: 2xx signs out', async () => {
  setSignedIn(USER)
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push([url, init.method]); return reply(200, { ok: true }) }
  assert.deepEqual(await signOut(), { ok: true })
  assert.equal(getAuth().status, 'out')
  assert.deepEqual(calls, [['/api/auth/logout', 'POST']])
})

test('signOut: 500, 403 and a network failure keep the account signed in and report the problem', async () => {
  for (const make of [async () => reply(500), async () => reply(403, { error: 'Cross-origin request blocked' }), async () => { throw new TypeError('offline') }]) {
    setSignedIn(USER)
    globalThis.fetch = make
    assert.deepEqual(await signOut(), { ok: false, error: SIGN_OUT_ERROR })
    assert.deepEqual(getAuth(), { status: 'in', user: USER })
  }
  assert.equal(SIGN_OUT_ERROR, "Couldn't sign you out. Try again.")
})
