import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAuth, authMessage } from '../src/lib/authRules.js'
import { validateRegister, validateLogin } from '../src/lib/validate.js'

const ok = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse battery' }

test('a register form that passes the client check passes the server validator', () => {
  assert.deepEqual(checkAuth('register', ok), {})
  assert.equal(validateRegister(ok).ok, true)
})

test('register field rules mirror the server', () => {
  assert.match(checkAuth('register', { ...ok, name: '  ' }).name, /Enter your name/)
  assert.match(checkAuth('register', { ...ok, name: 'x'.repeat(61) }).name, /60 characters/)
  assert.deepEqual(checkAuth('register', { ...ok, name: 'x'.repeat(60) }), {})
  assert.match(checkAuth('register', { ...ok, email: 'nope' }).email, /valid email/)
  assert.match(checkAuth('register', { ...ok, email: 'a@b' }).email, /valid email/)
  assert.match(checkAuth('register', { ...ok, email: '' }).email, /Enter your email/)
  assert.match(checkAuth('register', { ...ok, password: 'short' }).password, /at least 10/)
  assert.deepEqual(checkAuth('register', { ...ok, password: '1234567890' }), {})
  assert.match(checkAuth('register', { ...ok, password: 'x'.repeat(129) }).password, /128/)
  assert.deepEqual(checkAuth('register', { ...ok, password: 'x'.repeat(128) }), {})
  assert.deepEqual(Object.keys(checkAuth('register', { name: '', email: '', password: '' })), ['name', 'email', 'password'])
})

test('client and server agree on the edge cases', () => {
  const cases = [
    { ...ok, email: ' ADA@Example.com ' }, { ...ok, email: 'a b@c.de' }, { ...ok, email: `${'a'.repeat(250)}@b.co` },
    { ...ok, name: 'a\u0000b' }, { ...ok, password: ' '.repeat(10) }, { ...ok, password: 'x'.repeat(9) },
  ]
  for (const c of cases) assert.equal(Object.keys(checkAuth('register', c)).length === 0, validateRegister(c).ok, JSON.stringify(c).slice(0, 80))
})

test('login only needs an email and a password', () => {
  const login = { email: 'ada@example.com', password: 'x' }
  assert.deepEqual(checkAuth('login', login), {})
  assert.equal(validateLogin(login).ok, true)
  assert.match(checkAuth('login', { ...login, password: '' }).password, /Enter your password/)
  assert.match(checkAuth('login', { ...login, email: 'x' }).email, /valid email/)
  assert.equal('name' in checkAuth('login', { ...login, name: '' }), false)
})

test('authMessage maps server answers to friendly text', () => {
  assert.deepEqual(authMessage('register', 409), { text: 'That email is already registered — ', link: { href: '/login', label: 'sign in instead' } })
  assert.deepEqual(authMessage('login', 401), { text: 'Invalid email or password' })
  assert.deepEqual(authMessage('login', 429, 20), { text: 'Too many attempts — wait 20 seconds and try again' })
  assert.deepEqual(authMessage('login', 429, null), { text: 'Too many attempts — wait a moment and try again' })
  assert.match(authMessage('login', 500).text, /Something went wrong/)
  assert.match(authMessage('login', 0).text, /Couldn’t reach the server/)
  assert.match(authMessage('register', 400, null, 'password must be 10-128 characters').text, /password/i)
})
