import test from 'node:test'
import assert from 'node:assert/strict'
import { safeNext, loginHref, registerHref } from '../src/lib/nav.js'

test('safeNext accepts same-origin relative paths', () => {
  assert.equal(safeNext('/boards'), '/boards')
  assert.equal(safeNext('/b/K7M2QX'), '/b/K7M2QX')
  assert.equal(safeNext('/join?code=K7M2QX'), '/join?code=K7M2QX')
  assert.equal(safeNext('/boards#top'), '/boards#top')
})

test('safeNext falls back for everything else', () => {
  const bad = [
    undefined, null, '', 42, {}, [], 'boards', 'https://evil.example', 'http://evil.example/boards', 'javascript:alert(1)',
    '//evil.example', '//evil.example/boards', '/\\evil.example', '/\\/evil.example', '/ok\\path', '///x',
    '/a\nb', '/a\rb', '/a\u0000b', '/a\tb', '/boards\u007f', '\n/boards', ' /boards',
    `/${'a'.repeat(200)}`, '/login', '/login?next=/boards', '/register',
  ]
  for (const raw of bad) assert.equal(safeNext(raw), '/boards', JSON.stringify(raw))
})

test('safeNext uses the given fallback and allows exactly 200 characters', () => {
  assert.equal(safeNext('//x', '/'), '/')
  assert.equal(safeNext(undefined, '/join'), '/join')
  const edge = `/${'a'.repeat(199)}`
  assert.equal(edge.length, 200)
  assert.equal(safeNext(edge), edge)
  assert.equal(safeNext(`${edge}a`), '/boards')
})

test('safeNext takes the first value of a repeated query parameter', () => {
  assert.equal(safeNext(['/b/ABC234', '//evil.example']), '/b/ABC234')
  assert.equal(safeNext(['//evil.example', '/b/ABC234']), '/boards')
})

test('loginHref carries a safe next path and drops an unsafe one', () => {
  assert.equal(loginHref('/boards'), '/login?next=/boards')
  assert.equal(loginHref('/b/K7M2QX?x=1&y=2'), '/login?next=/b/K7M2QX%3Fx%3D1%26y%3D2')
  assert.equal(loginHref('//evil.example'), '/login')
  assert.equal(loginHref(undefined), '/login')
})

test('registerHref mirrors loginHref', () => {
  assert.equal(registerHref('/b/K7M2QX'), '/register?next=/b/K7M2QX')
  assert.equal(registerHref('https://evil.example'), '/register')
})
