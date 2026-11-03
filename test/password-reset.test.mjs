import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]
process.env.RESEND_API_KEY = 're_test_key'
process.env.MAIL_FROM = 'Retrospace <no-reply@example.com>'
process.env.NEXT_PUBLIC_SITE_URL = 'https://retro.example'

const { createMemoryStore, createMongoStore } = await import('../src/lib/store.js')
const { fakeClient } = await import('./helpers/fakeMongo.mjs')
const { mailConfig, mailConfigured, sendMail } = await import('../src/lib/mailer.js')
const { issueReset, redeemReset, resetOrigin, resetEmail, RESET_TTL_MS } = await import('../src/lib/passwordReset.js')
const { hashPassword, verifyPassword } = await import('../src/lib/password.js')
const { setBackgroundRunner } = await import('../src/lib/background.js')
const { POST: forgot } = await import('../src/app/api/auth/forgot/route.js')
const { POST: reset } = await import('../src/app/api/auth/reset/route.js')
const { POST: login } = await import('../src/app/api/auth/login/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')

const PASSWORD = 'correct horse battery'
const NEW_PASSWORD = 'a brand new passphrase'
const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

// What the mail provider would have received.
let sent
const realFetch = globalThis.fetch
let tasks
beforeEach(() => {
  sent = []
  tasks = []
  setBackgroundRunner((task) => { tasks.push(Promise.resolve().then(task)) })
  globalThis.fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response('{"id":"x"}', { status: 200 }) }
})
afterEach(() => { globalThis.fetch = realFetch })
const settle = () => Promise.all(tasks)

const post = async (handler, path, body, ip = fakeIp()) => {
  const res = await handler(new Request(`http://localhost:3100/api/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
  }))
  return { status: res.status, data: await res.json() }
}
const newUser = async () => {
  const email = `reset-${rnd()}@example.com`
  const r = await post(register, 'register', { email, name: 'Ann <b>', password: PASSWORD })
  assert.equal(r.status, 200)
  return email
}
const tokenFrom = (message) => /token=([A-Za-z0-9_-]{43})/.exec(message.body.text)[1]

test('mailer: sends through Resend with the key and the from address, and never throws', async () => {
  assert.equal(mailConfigured(), true)
  const ok = await sendMail({ to: 'a@example.com', subject: 'Hi', text: 't', html: '<p>t</p>' })
  assert.deepEqual(ok, { ok: true })
  assert.equal(sent[0].url, 'https://api.resend.com/emails')
  assert.equal(sent[0].init.headers.authorization, 'Bearer re_test_key')
  assert.deepEqual(sent[0].body.to, ['a@example.com'])
  assert.equal(sent[0].body.from, 'Retrospace <no-reply@example.com>')

  globalThis.fetch = async () => new Response('no', { status: 403 })
  assert.deepEqual(await sendMail({ to: 'a@example.com', subject: 's', text: 't' }), { ok: false, error: 'the mail provider answered 403' })
  const refuse = (body) => async () => new Response(JSON.stringify(body), { status: 403 })
  globalThis.fetch = refuse({ statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com)' })
  const named = await sendMail({ to: 'a@example.com', subject: 's', text: 't' })
  assert.deepEqual(named, { ok: false, error: 'the mail provider answered 403 (validation_error)' }, 'the class is kept so the log says what went wrong')
  assert.ok(!named.error.includes('owner@example.com') && !named.error.includes('testing emails'), 'the message and the address it names are never kept')
  globalThis.fetch = refuse({ name: 'DROP TABLE; <script>' })
  assert.equal((await sendMail({ to: 'a@example.com', subject: 's', text: 't' })).error, 'the mail provider answered 403', 'anything that is not a plain error class is ignored')
  globalThis.fetch = async () => { throw new Error('boom a@example.com') }
  const down = await sendMail({ to: 'a@example.com', subject: 's', text: 't' })
  assert.equal(down.ok, false)
  assert.ok(!down.error.includes('a@example.com'), 'the address is not in the error')
  assert.deepEqual(await sendMail({ to: 'a@example.com', subject: 's', text: 't' }, { config: null }), { ok: false, error: 'mail is not configured' })
  assert.equal(mailConfig({}), null)
  assert.equal(mailConfig({ MAIL_FROM: 'a@b.co' }), null, 'a sender alone is not enough: the key is needed')
  assert.deepEqual(mailConfig({ RESEND_API_KEY: 'k' }), { apiKey: 'k', from: 'Retrospace <onboarding@resend.dev>' }, 'no MAIL_FROM: Resend\'s test sender')
  assert.deepEqual(mailConfig({ RESEND_API_KEY: 'k', MAIL_FROM: 'Me <me@mine.example>' }), { apiKey: 'k', from: 'Me <me@mine.example>' }, 'MAIL_FROM wins when set')
  assert.deepEqual(mailConfig({ RESEND_API_KEY: 'k', MAIL_FROM: '   ' }).from, 'Retrospace <onboarding@resend.dev>', 'blank counts as not set')
})

test('a reset link works once, and a newer link replaces the older one', async () => {
  const store = createMemoryStore()
  const first = await issueReset(store, 'u_1', 1000)
  const second = await issueReset(store, 'u_1', 2000)
  assert.notEqual(first, second)
  const hash = await hashPassword(NEW_PASSWORD)
  await store.createUser({ id: 'u_1', email: 'x@example.com', name: 'X', passwordHash: 'old', createdAt: 1 })
  assert.equal(await redeemReset(store, first, hash, 3000), false, 'the older link is gone')
  assert.equal(await redeemReset(store, second, hash, 3000), true)
  assert.equal(await redeemReset(store, second, hash, 3000), false, 'a used link cannot be used again')
  assert.equal((await store.getUserById('u_1')).passwordHash, hash)
})

test('a link expires after 30 minutes, and junk is refused', async () => {
  const store = createMemoryStore()
  await store.createUser({ id: 'u_2', email: 'y@example.com', name: 'Y', passwordHash: 'old', createdAt: 1 })
  const token = await issueReset(store, 'u_2', 10_000)
  assert.equal(await redeemReset(store, token, 'h', 10_000 + RESET_TTL_MS), false)
  assert.equal((await store.getUserById('u_2')).passwordHash, 'old')
  for (const junk of [undefined, null, '', 'short', 'x'.repeat(43), 42, {}]) assert.equal(await redeemReset(store, junk, 'h'), false)
})

test('the link points at the configured site only; the request address is never used in production', () => {
  assert.equal(resetOrigin({ NEXT_PUBLIC_SITE_URL: 'https://retro.example/' }, 'http://evil.example/x'), 'https://retro.example')
  assert.equal(resetOrigin({ NODE_ENV: 'production' }, 'http://evil.example/x'), null)
  assert.equal(resetOrigin({ NODE_ENV: 'development' }, 'http://localhost:3100/x'), 'http://localhost:3100')
})

test('the email escapes the name in its HTML and carries the link in both versions', () => {
  const m = resetEmail({ name: 'Ann <script>', link: 'https://retro.example/reset?token=abc' })
  assert.ok(m.html.includes('Ann &lt;script&gt;') && !m.html.includes('<script>'))
  assert.ok(m.text.includes('https://retro.example/reset?token=abc') && m.html.includes('https://retro.example/reset?token=abc'))
  assert.ok(m.text.includes('30 minutes'))
})

test('forgot: a known address gets one email with a working link; an unknown one gets the same answer and nothing', async () => {
  const email = await newUser()
  const known = await post(forgot, 'forgot', { email })
  const unknown = await post(forgot, 'forgot', { email: `nobody-${rnd()}@example.com` })
  await settle()
  assert.deepEqual(known, unknown)
  assert.equal(known.status, 200)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].body.to, [email])
  assert.ok(sent[0].body.html.includes('Ann &lt;b&gt;'))
  assert.match(sent[0].body.text, /https:\/\/retro\.example\/reset\?token=/)
})

test('forgot: a bad address is a 400, and without mail settings nothing is sent but the answer is the same', async () => {
  assert.equal((await post(forgot, 'forgot', { email: 'not-an-email' })).status, 400)
  assert.equal((await post(forgot, 'forgot', {})).status, 400)
  const email = await newUser()
  const saved = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    const r = await post(forgot, 'forgot', { email })
    await settle()
    assert.deepEqual(r, { status: 200, data: { ok: true } })
    assert.equal(sent.length, 0)
  } finally { process.env.RESEND_API_KEY = saved }
})

test('forgot: at most 3 emails per address an hour, with the same answer every time', async () => {
  const email = await newUser()
  const answers = []
  for (let i = 0; i < 5; i++) answers.push(await post(forgot, 'forgot', { email }))
  await settle()
  assert.ok(answers.every((a) => a.status === 200))
  assert.equal(sent.length, 3)
})

test('forgot: one visitor is limited to 5 a minute', async () => {
  const ip = fakeIp()
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await post(forgot, 'forgot', { email: `a-${rnd()}@example.com` }, ip)).status)
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429])
})

test('reset: the new password works, the old one does not, and the link is spent', async () => {
  const email = await newUser()
  const before = await post(login, 'login', { email, password: PASSWORD })
  assert.equal(before.status, 200)
  await post(forgot, 'forgot', { email })
  await settle()
  const token = tokenFrom(sent[0])

  assert.equal((await post(reset, 'reset', { token, password: 'short' })).status, 400, 'a short password is refused and the link survives')
  const done = await post(reset, 'reset', { token, password: NEW_PASSWORD })
  assert.deepEqual(done, { status: 200, data: { ok: true } })
  assert.equal((await post(login, 'login', { email, password: NEW_PASSWORD })).status, 200)
  assert.equal((await post(login, 'login', { email, password: PASSWORD })).status, 401)
  const again = await post(reset, 'reset', { token, password: 'yet another passphrase' })
  assert.equal(again.status, 400)
  assert.match(again.data.error, /expired or was already used/)

  const store = (await import('../src/lib/store.js')).getStore()
  const user = await store.getUserByEmail(email)
  assert.equal(await verifyPassword(NEW_PASSWORD, user.passwordHash), true)
})

test('reset: a bad or made-up token is a 400 with the same message', async () => {
  for (const token of [undefined, 'abc', 'A'.repeat(43), 123]) {
    const r = await post(reset, 'reset', { token, password: NEW_PASSWORD })
    assert.equal(r.status, 400)
    assert.match(r.data.error, /expired or was already used/)
  }
})

test('reset: signing in again after a reset leaves no old session valid', async () => {
  const store = (await import('../src/lib/store.js')).getStore()
  const email = await newUser()
  const user = await store.getUserByEmail(email)
  await store.createSession({ tokenHash: 'old-session', userId: user.id, createdAt: 1, lastSeenAt: 1, expiresAt: Date.now() + 100000 })
  await post(forgot, 'forgot', { email })
  await settle()
  const done = await post(reset, 'reset', { token: tokenFrom(sent[0]), password: NEW_PASSWORD })
  assert.equal(done.status, 200)
  assert.equal(await store.getSessionByTokenHash('old-session'), null)
})

test('the Mongo store: a link is used up by exactly one of two simultaneous tries, expired links are refused, passwords update', async () => {
  const client = fakeClient()
  const store = createMongoStore(client, 'reset_test')
  await store.createUser({ id: 'u_m', email: 'm@example.com', name: 'M', passwordHash: 'old', createdAt: 1 })
  const token = await issueReset(store, 'u_m', Date.now())
  const results = await Promise.all([redeemReset(store, token, 'new-1'), redeemReset(store, token, 'new-2')])
  assert.deepEqual(results.sort(), [false, true])
  assert.match((await store.getUserById('u_m')).passwordHash, /^new-[12]$/)
  const stale = await issueReset(store, 'u_m', 1000)
  assert.equal(await redeemReset(store, stale, 'x', 1000 + RESET_TTL_MS), false)
  assert.equal(await store.updateUserPassword('u_nobody', 'x'), false)
  await issueReset(store, 'u_m')
  await store.deleteResetsByUser('u_m')
  assert.equal(client.cols.get('resets').docs.length, 0)
})
