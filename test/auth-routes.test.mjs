import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Route handlers go through getStore(); force the in-memory store and no Redis whatever the shell has set.
for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: login } = await import('../src/app/api/auth/login/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')

const PASSWORD = 'correct horse battery'
const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}` // unique per call
const bodies = []

async function call(handler, path, body, ip = fakeIp()) {
  const res = await handler(new Request(`http://localhost:3100/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  const text = await res.text()
  bodies.push(text)
  return { status: res.status, text, data: JSON.parse(text), headers: res.headers }
}

const signIn = (email, password = PASSWORD, ip) => call(login, 'login', { email, password }, ip)

async function newUser() {
  const email = `user-${rnd()}@example.com`
  const r = await call(register, 'register', { email, name: 'Ann', password: PASSWORD })
  assert.equal(r.status, 200)
  return email
}

beforeEach(() => {
  const mem = globalThis._kmMem
  if (mem) for (const m of [mem.users, mem.usersById, mem.sessions]) m?.clear()
})

test('10 concurrent wrong guesses plus 5 more: only 10 are ever verified, the rest are 429', async () => {
  const email = await newUser()
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => signIn(email, `wrong-password-${i}`)))
  const statuses = results.map((r) => r.status).sort()
  assert.deepEqual(statuses, [...Array(10).fill(401), ...Array(5).fill(429)])
  for (const r of results.filter((x) => x.status === 429)) {
    assert.equal(r.data.error, 'Too many attempts, try again later')
    assert.ok(Number(r.headers.get('retry-after')) > 0)
  }
  // even the right password is refused while locked, from a brand new IP
  assert.equal((await signIn(email)).status, 429)
})

test('a successful login gives the failure budget back', async () => {
  const email = await newUser()
  for (let i = 0; i < 9; i++) assert.equal((await signIn(email, `wrong-${i}-password`)).status, 401)
  assert.equal((await signIn(email)).status, 200) // 10th attempt, correct: allowed and clears the counter
  for (let i = 0; i < 10; i++) assert.equal((await signIn(email, `wrong-again-${i}`)).status, 401)
  assert.equal((await signIn(email, 'wrong-eleventh')).status, 429)
})

test('a locked unknown email answers exactly like a locked known email', async () => {
  const known = await newUser()
  const unknown = `ghost-${rnd()}@example.com`
  for (const email of [known, unknown]) for (let i = 0; i < 10; i++) assert.equal((await signIn(email, `nope-${i}-nope-nope`)).status, 401)
  const a = await signIn(known)
  const b = await signIn(unknown)
  assert.equal(a.status, 429)
  assert.equal(b.status, 429)
  assert.equal(a.text, b.text)
  assert.deepEqual([...a.headers.keys()].sort(), [...b.headers.keys()].sort())
  assert.ok(Number(a.headers.get('retry-after')) > 0 && Number(b.headers.get('retry-after')) > 0)
})

test('flooding with distinct spoofed IPs and invalid bodies does not reset a victim counter', async () => {
  const email = await newUser()
  for (let i = 0; i < 10; i++) assert.equal((await signIn(email, `wrong-${i}-password`)).status, 401)
  assert.equal((await signIn(email)).status, 429)
  for (let i = 0; i < 6000; i++) {
    const r = await call(login, 'login', {}, `203.0.${i >> 8}.${i & 255}`)
    if (r.status !== 400) assert.fail(`flood request ${i} got ${r.status}`)
  }
  assert.equal((await signIn(email)).status, 429) // still locked
})

test('unknown email and wrong password are indistinguishable', async () => {
  const email = await newUser()
  const wrong = await signIn(email, 'definitely wrong')
  const unknown = await signIn(`nobody-${rnd()}@example.com`, 'definitely wrong')
  assert.equal(wrong.status, 401)
  assert.equal(unknown.status, wrong.status)
  assert.equal(unknown.text, wrong.text)
  assert.deepEqual(Object.fromEntries(unknown.headers), Object.fromEntries(wrong.headers))
  assert.equal(wrong.headers.get('set-cookie'), null)
})

test('no response from these routes ever contains passwordHash or scrypt$', () => {
  assert.ok(bodies.length > 6000)
  assert.ok(bodies.every((b) => !b.includes('passwordHash') && !b.includes('scrypt$')))
})
