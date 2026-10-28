import test from 'node:test'
import assert from 'node:assert/strict'
import { relativeTime } from '../src/lib/time.js'

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0)
const ago = (ms, tz = 'UTC') => relativeTime(NOW - ms, NOW, tz)
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H

test('relativeTime reads naturally at each scale', () => {
  assert.equal(ago(0), 'just now')
  assert.equal(ago(30 * S), 'just now')
  assert.equal(ago(60 * S), '1 min ago')
  assert.equal(ago(3 * M + 10 * S), '3 min ago')
  assert.equal(ago(59 * M), '59 min ago')
  assert.equal(ago(60 * M), '1 hour ago')
  assert.equal(ago(5 * H + 59 * M), '5 hours ago')
  assert.equal(ago(23 * H), '23 hours ago')
  assert.equal(ago(24 * H), 'yesterday')
  assert.equal(ago(47 * H), 'yesterday')
  assert.equal(ago(2 * D), '2 days ago')
  assert.equal(ago(6 * D), '6 days ago')
})

test('relativeTime falls back to a date after a week', () => {
  assert.match(ago(8 * D), /^Oct 20$/)
  assert.equal(ago(200 * D), 'Apr 11') // same year: no year
  assert.equal(ago(400 * D), 'Sep 23, 2025')
})

test('relativeTime tolerates future and invalid input', () => {
  assert.equal(relativeTime(NOW + 5 * M, NOW), 'just now') // clock skew
  assert.equal(relativeTime(undefined, NOW), '')
  assert.equal(relativeTime(NaN, NOW), '')
  assert.equal(relativeTime('nope', NOW), '')
  assert.equal(relativeTime(new Date(NOW - 2 * H).toISOString(), NOW), '2 hours ago')
})

test('the date fallback follows the viewer\'s time zone, not UTC', () => {
  const t = Date.UTC(2026, 9, 20, 23, 30) // 23:30 UTC on Oct 20 is already Oct 21 in Tokyo
  assert.equal(relativeTime(t, NOW, 'UTC'), 'Oct 20')
  assert.equal(relativeTime(t, NOW, 'Asia/Tokyo'), 'Oct 21')
  assert.equal(relativeTime(Date.UTC(2026, 0, 1, 2), Date.UTC(2026, 11, 31, 22), 'America/New_York'), 'Dec 31, 2025') // new year in UTC, still last year in New York
})
