import test from 'node:test'
import assert from 'node:assert/strict'
import { utilityPage, BOARD_ROBOTS, siteUrl } from '../src/lib/meta.js'

test('utility pages: Open Graph and Twitter titles match the <title>, and the page is noindex', () => {
  const m = utilityPage('Sign in', 'Sign in to manage boards.')
  assert.equal(m.title, 'Sign in')
  assert.equal(m.openGraph.title, 'Sign in · Retrospace')
  assert.equal(m.twitter.title, m.openGraph.title)
  assert.equal(m.openGraph.description, m.description)
  assert.deepEqual(m.robots, { index: false })
  assert.equal('images' in m.openGraph, false)
})

test('board URLs are neither indexed nor followed', () => {
  assert.deepEqual(BOARD_ROBOTS, { index: false, follow: false })
})

test('siteUrl uses NEXT_PUBLIC_SITE_URL when valid, else localhost:3000', () => {
  assert.equal(siteUrl('https://retro.example.com').origin, 'https://retro.example.com')
  // undefined would fall back to the real environment (set on some machines): use an explicit empty value
  assert.equal(siteUrl('').origin, 'http://localhost:3000')
  assert.equal(siteUrl('not a url').origin, 'http://localhost:3000')
})
