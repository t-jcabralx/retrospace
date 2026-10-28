import test from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { GET: me } = await import('../src/app/api/auth/me/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')

const get = (query = '', cookie) => me(new Request(`http://localhost:3100/api/auth/me${query}`, { headers: cookie ? { cookie } : {} }))

test('me answers 401 when signed out, as before', async () => {
  const res = await get()
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'Not signed in' })
})

test('me?soft=1 answers 200 with a null user when signed out, so pages need not log a 401', async () => {
  const res = await get('?soft=1')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { user: null })
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal((await get('?soft=0')).status, 401)
})

test('me returns the user, soft or not, when signed in', async () => {
  const reg = await register(new Request('http://localhost:3100/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
    body: JSON.stringify({ email: 'me-soft@example.com', name: 'Mia', password: 'correct horse battery' }),
  }))
  assert.equal(reg.status, 200)
  const cookie = reg.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  for (const q of ['', '?soft=1']) {
    const res = await get(q, cookie)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).user.email, 'me-soft@example.com')
  }
})
