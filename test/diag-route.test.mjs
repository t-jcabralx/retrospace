import test from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/routes.mjs'

const { POST } = await import('../src/app/api/diag/route.js')

const logged = []
const was = console.error
test.before(() => { console.error = (m) => logged.push(String(m)) })
test.after(() => { console.error = was })

test('a refusal report is logged as one short line with only the allowed facts', async () => {
  const r = await call(POST, 'POST', '/api/diag', { body: { k: 'rejected', error: 'This stage is closed for notes', n: 1, board: 'retro', role: 'guest', stage: '2', status: 'live', secret: 'my private note text', text: 'hello' } })
  assert.equal(r.status, 200)
  const line = logged.at(-1)
  assert.match(line, /^retrospace-diag \{/)
  assert.ok(line.includes('This stage is closed for notes') && line.includes('"board":"retro"'))
  assert.ok(!line.includes('private') && !line.includes('hello'), 'unknown fields are never logged')
})

test('unknown kinds, oversized bodies and control characters are refused or cleaned', async () => {
  assert.equal((await call(POST, 'POST', '/api/diag', { body: { k: 'anything' } })).status, 400)
  assert.equal((await call(POST, 'POST', '/api/diag', { body: { k: 'rejected', error: 'x'.repeat(5000) } })).status, 413)
  await call(POST, 'POST', '/api/diag', { body: { k: 'drag-expired', error: 'a\nb<script>"x"', n: 1e9 } })
  const line = logged.at(-1)
  assert.ok(!line.includes('<script>') && !line.includes('\\n'), line)
  assert.ok(!line.includes('"n"'), 'a count out of range is dropped')
})

test('a "your change was put back" report is accepted with only the kind and a few small facts', async () => {
  const r = await call(POST, 'POST', '/api/diag', { body: { k: 'reverted', kind: 'remote', board: 'workshop', role: 'guest', status: 'polling', text: 'a private note' } })
  assert.equal(r.status, 200)
  const line = logged.at(-1)
  assert.ok(line.includes('"k":"reverted"') && line.includes('"kind":"remote"') && !line.includes('private'), line)
})
