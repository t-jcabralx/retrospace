import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]
process.env.RESEND_API_KEY = 're_test_key'
process.env.MAIL_FROM = 'Retrospace <onboarding@resend.dev>'
process.env.ISSUE_EMAIL_TO = 'owner@example.com'

const { validateReport, issueEmail, issueRecipient, MAX_REPORT } = await import('../src/lib/issueReport.js')
const { sendMail } = await import('../src/lib/mailer.js')
const { POST: issue } = await import('../src/app/api/issue/route.js')

const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(4).toString('hex')}`
let sent
const realFetch = globalThis.fetch
beforeEach(() => {
  sent = []
  globalThis.fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response('{"id":"x"}', { status: 200 }) }
})
afterEach(() => { globalThis.fetch = realFetch })

const post = async (body, ip = fakeIp()) => {
  const res = await issue(new Request('http://localhost:3100/api/issue', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
  }))
  return { status: res.status, data: await res.json() }
}
const GOOD = { message: 'The wheel does not spin on my phone.' }

test('validateReport: the message needs 10 to 2000 characters; the email is optional but must be valid', () => {
  assert.equal(validateReport(GOOD).ok, true)
  assert.deepEqual(validateReport({ ...GOOD, email: ' Me@Example.com ' }).value, { message: GOOD.message, email: 'me@example.com' })
  for (const bad of [null, 'x', {}, { message: 'short' }, { message: '          ' }, { message: 42 }, { message: 'x'.repeat(MAX_REPORT + 1) }]) assert.equal(validateReport(bad).ok, false, JSON.stringify(bad)?.slice(0, 40))
  assert.equal(validateReport({ ...GOOD, email: 'not-an-email' }).ok, false)
  assert.equal(validateReport({ message: 'x'.repeat(MAX_REPORT) }).ok, true)
})

test('the report email escapes the message and sets a reply-to only when there is an address', () => {
  const m = issueEmail({ message: 'Broken <script>alert(1)</script> & more', email: 'me@example.com' })
  assert.ok(m.html.includes('&lt;script&gt;') && !m.html.includes('<script>'))
  assert.equal(m.replyTo, 'me@example.com')
  assert.ok(m.text.includes('Reply to: me@example.com'))
  assert.equal('replyTo' in issueEmail({ message: 'no address here ok' }), false)
  assert.equal(issueRecipient({ ISSUE_EMAIL_TO: ' a@b.co ' }), 'a@b.co')
  assert.match(issueRecipient({}), /@/, 'falls back to the contact address')
})

test('the mailer passes reply-to to Resend and to Brevo', async () => {
  await sendMail({ to: 'o@example.com', subject: 's', text: 't', replyTo: 'r@example.com' }, { config: { provider: 'resend', apiKey: 'k', from: 'a@b.co' } })
  assert.equal(sent.at(-1).body.reply_to, 'r@example.com')
  await sendMail({ to: 'o@example.com', subject: 's', text: 't', replyTo: 'r@example.com' }, { config: { provider: 'brevo', apiKey: 'k', from: 'a@b.co' } })
  assert.deepEqual(sent.at(-1).body.replyTo, { email: 'r@example.com' })
  await sendMail({ to: 'o@example.com', subject: 's', text: 't' }, { config: { provider: 'resend', apiKey: 'k', from: 'a@b.co' } })
  assert.equal('reply_to' in sent.at(-1).body, false)
})

test('POST /api/issue: a good report is emailed to the owner with the visitor as reply-to', async () => {
  const r = await post({ ...GOOD, email: 'me@example.com' })
  assert.deepEqual(r, { status: 200, data: { ok: true } })
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].body.to, ['owner@example.com'])
  assert.equal(sent[0].body.reply_to, 'me@example.com')
  assert.ok(sent[0].body.text.includes(GOOD.message))
})

test('POST /api/issue: bad input is a 400, a bot field is quietly dropped, and nothing is sent for either', async () => {
  assert.equal((await post({ message: 'short' })).status, 400)
  assert.equal((await post({ ...GOOD, email: 'nope' })).status, 400)
  assert.deepEqual(await post({ ...GOOD, website: 'http://spam.example' }), { status: 200, data: { ok: true } })
  assert.equal(sent.length, 0)
})

test('POST /api/issue: without mail settings it says so (503), and when the provider fails it says so (502)', async () => {
  globalThis.fetch = async () => new Response('no', { status: 500 })
  assert.equal((await post(GOOD)).status, 502)
  const key = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try { assert.equal((await post(GOOD)).status, 503) } finally { process.env.RESEND_API_KEY = key }
})

test('POST /api/issue: one visitor can send 3 reports a minute', async () => {
  const ip = fakeIp()
  const codes = []
  for (let i = 0; i < 5; i++) codes.push((await post(GOOD, ip)).status)
  assert.deepEqual(codes, [200, 200, 200, 429, 429])
})
