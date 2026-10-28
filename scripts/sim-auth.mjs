// Black-box auth simulation. Usage: node scripts/sim-auth.mjs [baseUrl]  (default http://localhost:3000)
// Start a FRESH dev server first: the rate-limit counters live in the server process.
// Exits non-zero on the first failed assertion.
import { randomBytes } from 'node:crypto'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const bodies = []
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const PASSWORD = 'correct horse battery'

// Every request carries an x-forwarded-for so each check owns its rate-limit budget, whatever ran before it.
const simIp = fakeIp()

async function call(method, path, { body, raw, cookie, headers = {}, ip = simIp, json = true } = {}) {
  const h = { 'x-forwarded-for': ip, ...headers }
  if (json && (body !== undefined || raw !== undefined)) h['content-type'] = 'application/json'
  if (cookie) h.cookie = cookie
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' })
  const text = await res.text()
  bodies.push(text)
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 200) } }
  const setCookies = res.headers.getSetCookie()
  return { status: res.status, data, res, setCookies, session: setCookies.find((c) => c.startsWith('rs_session=')) }
}

const cookieOf = (setCookie) => setCookie.split(';')[0] // name=value, what a browser would send back

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) {
    console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
    process.exit(1)
  }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

const email = `ann-${rnd()}@example.com`
const register = (over = {}, opts) => call('POST', '/api/auth/register', { body: { email, name: 'Ann Lee', password: PASSWORD, ...over }, ...opts })
const login = (over = {}, opts) => call('POST', '/api/auth/login', { body: { email, password: PASSWORD, ...over }, ...opts })

// register
const reg = await register()
check('register -> 200 with a public user', reg.status === 200 && reg.data.user?.email === email && reg.data.user?.name === 'Ann Lee' && /^u_[0-9a-f]{16}$/.test(reg.data.user?.id), reg)
check('register user has exactly id, email, name', JSON.stringify(Object.keys(reg.data.user).sort()) === '["email","id","name"]', reg.data.user)
const flags = (reg.session || '').split(';').map((s) => s.trim())
check('register sets rs_session with HttpOnly, SameSite=Lax, Path=/, Max-Age=2592000', !!reg.session && ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'].every((f) => flags.includes(f)), reg.session && flags.slice(1))
check('register response is Cache-Control: no-store', reg.res.headers.get('cache-control') === 'no-store')
const regCookie = cookieOf(reg.session)

// me
const me = await call('GET', '/api/auth/me', { cookie: regCookie })
check('me -> 200 returns the registered user', me.status === 200 && JSON.stringify(me.data) === JSON.stringify({ user: reg.data.user }), me)
check('me response is Cache-Control: no-store', me.res.headers.get('cache-control') === 'no-store')
const anon = await call('GET', '/api/auth/me')
check('me without a cookie -> 401 Not signed in', anon.status === 401 && anon.data.error === 'Not signed in', anon)
const junk = await call('GET', '/api/auth/me', { cookie: 'rs_session=garbage; x=%E0%A4%A' })
check('me with a garbage cookie -> 401', junk.status === 401, junk)

// register validation and conflicts
const dup = await register({ email: email.toUpperCase() })
check('duplicate register with different case -> 409 Email already registered', dup.status === 409 && dup.data.error === 'Email already registered' && !dup.session, dup)
const short = await register({ email: `short-${rnd()}@example.com`, password: '123456789' })
check('register with a 9-char password -> 400', short.status === 400 && typeof short.data.error === 'string' && !short.session, short)
const badEmail = await register({ email: 'not-an-email' })
check('register with an invalid email -> 400', badEmail.status === 400, badEmail)
const badJson = await register({}, { raw: '{oops' })
check('register with malformed JSON -> 400', badJson.status === 400, badJson)

// CSRF guards
const plain = await call('POST', '/api/auth/login', { raw: JSON.stringify({ email, password: PASSWORD }), headers: { 'content-type': 'text/plain' }, json: false })
check('login with text/plain -> 415', plain.status === 415 && plain.data.error === 'Content-Type must be application/json' && !plain.session, plain)
const form = await call('POST', '/api/auth/register', { raw: 'email=a%40b.co', headers: { 'content-type': 'application/x-www-form-urlencoded' }, json: false })
check('register with form encoding -> 415', form.status === 415, form)
const foreign = await login({}, { headers: { origin: 'https://evil.example' } })
check('login with a foreign Origin -> 403', foreign.status === 403 && foreign.data.error === 'Cross-origin request blocked' && !foreign.session, foreign)
const foreignOut = await call('POST', '/api/auth/logout', { body: {}, cookie: regCookie, headers: { origin: 'https://evil.example' } })
check('logout with a foreign Origin -> 403 and the session survives', foreignOut.status === 403 && (await call('GET', '/api/auth/me', { cookie: regCookie })).status === 200, foreignOut)
const sameOrigin = await login({}, { headers: { origin: new URL(BASE).origin } })
check('login with the same Origin -> 200', sameOrigin.status === 200, sameOrigin)

// login failures look identical
const wrong = await login({ password: 'definitely the wrong one' })
const unknown = await login({ email: `nobody-${rnd()}@example.com` })
check('wrong password -> 401 Invalid email or password', wrong.status === 401 && wrong.data.error === 'Invalid email or password' && !wrong.session, wrong)
check('unknown email -> identical status and error text', unknown.status === wrong.status && unknown.data.error === wrong.data.error && JSON.stringify(unknown.data) === JSON.stringify(wrong.data), { wrong: wrong.data, unknown: unknown.data })

// login -> me -> logout
const li = await login()
check('login -> 200 with the same user and a fresh cookie', li.status === 200 && li.data.user?.id === reg.data.user.id && !!li.session && cookieOf(li.session) !== regCookie, li)
const liCookie = cookieOf(li.session)
check('login then me -> the user', (await call('GET', '/api/auth/me', { cookie: liCookie })).data.user?.id === reg.data.user.id)
const out = await call('POST', '/api/auth/logout', { body: {}, cookie: liCookie })
check('logout -> 200 { ok: true } and clears the cookie', out.status === 200 && out.data.ok === true && /Max-Age=0/.test(out.session || ''), out)
const after = await call('GET', '/api/auth/me', { cookie: liCookie })
check('logout then me -> 401 with the old cookie', after.status === 401, after)
check('the other session (from register) is unaffected', (await call('GET', '/api/auth/me', { cookie: regCookie })).status === 200)
const outAgain = await call('POST', '/api/auth/logout', { body: {}, cookie: liCookie })
check('logout with a dead cookie is still 200', outAgain.status === 200 && outAgain.data.ok === true, outAgain)
const outAnon = await call('POST', '/api/auth/logout', { body: {} })
check('logout without a cookie is still 200', outAnon.status === 200 && outAnon.data.ok === true, outAnon)

// per-email failed-login limiter: each attempt comes from a different IP, so only the per-email counter can trip
const victim = `victim-${rnd()}@example.com`
await register({ email: victim }, { ip: fakeIp() })
let allFailed = true
for (let i = 0; i < 10; i++) {
  const r = await login({ email: victim, password: `wrong-password-${i}` }, { ip: fakeIp() })
  if (r.status !== 401) allFailed = false
}
check('10 wrong passwords for one email from 10 IPs -> all 401', allFailed)
const locked = await login({ email: victim }, { ip: fakeIp() })
check('the 11th attempt (even with the right password) -> 429 with Retry-After', locked.status === 429 && locked.data.error === 'Too many attempts, try again later' && Number(locked.res.headers.get('retry-after')) > 0 && !locked.session, locked)
const lockedUnknown = await login({ email: `ghost-${rnd()}@example.com`, password: 'x' }, { ip: fakeIp() })
check('an unrelated email from a new IP is not locked out', lockedUnknown.status === 401, lockedUnknown)

// per-IP limiter: unique email each time so only the IP counter can trip
const burstIp = fakeIp()
let burstOk = true
for (let i = 0; i < 10; i++) {
  const r = await login({ email: `burst-${rnd()}@example.com`, password: 'x' }, { ip: burstIp })
  if (r.status !== 401) burstOk = false
}
check('10 rapid login attempts from one IP -> all answered (401)', burstOk)
const eleventh = await login({ email: `burst-${rnd()}@example.com`, password: 'x' }, { ip: burstIp })
check('the 11th rapid login attempt from one IP -> 429 with Retry-After', eleventh.status === 429 && Number(eleventh.res.headers.get('retry-after')) > 0 && eleventh.res.headers.get('cache-control') === 'no-store', eleventh)
const otherIp = await login({ email: `burst-${rnd()}@example.com`, password: 'x' }, { ip: fakeIp() })
check('another IP is unaffected', otherIp.status === 401, otherIp)

// no secret ever leaves the server
check('no response body contains passwordHash or scrypt$', bodies.every((b) => !b.includes('passwordHash') && !b.includes('scrypt$')), bodies.length)
console.log(`OK ${n} checks, ${bodies.length} responses scanned`)
