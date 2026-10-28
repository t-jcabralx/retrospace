import test from 'node:test'
import assert from 'node:assert/strict'
import { countdownParts, pad2, announceBucket, announcementText } from '../src/ui/countdown.js'

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H

test('countdownParts splits into days, hours, minutes and seconds', () => {
  assert.deepEqual(countdownParts(2 * D + 3 * H + 4 * M + 5 * S), { days: 2, hours: 3, minutes: 4, seconds: 5 })
  assert.deepEqual(countdownParts(59 * M + 59 * S), { days: 0, hours: 0, minutes: 59, seconds: 59 })
  assert.deepEqual(countdownParts(D), { days: 1, hours: 0, minutes: 0, seconds: 0 })
})

test('countdownParts rounds up to the next whole second, so 0 shows only at the moment of the reveal', () => {
  assert.deepEqual(countdownParts(1), { days: 0, hours: 0, minutes: 0, seconds: 1 })
  assert.deepEqual(countdownParts(1001), { days: 0, hours: 0, minutes: 0, seconds: 2 })
  assert.deepEqual(countdownParts(0), { days: 0, hours: 0, minutes: 0, seconds: 0 })
})

test('countdownParts is never negative and tolerates junk', () => {
  const zero = { days: 0, hours: 0, minutes: 0, seconds: 0 }
  for (const bad of [-5, -1e12, NaN, Infinity, undefined, null, 'x']) assert.deepEqual(countdownParts(bad), zero, String(bad))
})

test('pad2 pads to two digits', () => {
  assert.deepEqual([0, 5, 12, 99, 100].map(pad2), ['00', '05', '12', '99', '100'])
})

test('announceBucket speaks hourly above an hour, then at 30/15/10/5/2/1 minutes, then 30/10/5 seconds, then now', () => {
  assert.equal(announceBucket(2 * D + 3 * H + 10 * M).key, 'h:51')
  assert.equal(announceBucket(2 * D + 3 * H + 59 * M).key, 'h:51', 'same hour, same announcement')
  assert.equal(announceBucket(3 * H - 1).key, 'h:2')
  assert.equal(announceBucket(H).key, 'h:1')
  assert.equal(announceBucket(H - 1).key, 'm:30')
  assert.equal(announceBucket(20 * M).key, 'm:15')
  assert.equal(announceBucket(9 * M).key, 'm:5')
  assert.equal(announceBucket(M + S).key, 'm:1')
  assert.equal(announceBucket(M).key, 'm:1')
  assert.equal(announceBucket(M - 1).key, 's:30')
  assert.equal(announceBucket(20 * S).key, 's:10')
  assert.equal(announceBucket(4 * S).key, 's:5')
  assert.equal(announceBucket(1).key, 's:5')
  assert.equal(announceBucket(0).key, 'now')
  assert.equal(announceBucket(-9).key, 'now')
})

test('the same bucket gives the same key over a whole stretch (so a live region is not rewritten every second)', () => {
  const keys = new Set()
  for (let ms = 4 * M; ms > 2 * M + S; ms -= S) keys.add(announceBucket(ms).key)
  assert.deepEqual([...keys], ['m:2'])
})

test('announcement text is plain, singular-aware language', () => {
  assert.equal(announcementText(announceBucket(2 * D + 3 * H)), '2 days and 3 hours to go')
  assert.equal(announcementText(announceBucket(D + H + 1)), '1 day and 1 hour to go')
  assert.equal(announcementText(announceBucket(D + 5)), '1 day to go')
  assert.equal(announcementText(announceBucket(5 * H + 20 * M)), '5 hours to go')
  assert.equal(announcementText(announceBucket(H)), '1 hour to go')
  assert.equal(announcementText(announceBucket(45 * M)), '30 minutes to go')
  assert.equal(announcementText(announceBucket(90 * S)), '1 minute to go')
  assert.equal(announcementText(announceBucket(25 * S)), '10 seconds to go')
  assert.equal(announcementText(announceBucket(0)), 'The wait is over')
})

test('countdownSentence reads the whole time left in words, leaving out zero units', async () => {
  const { countdownSentence } = await import('../src/ui/countdown.js')
  assert.equal(countdownSentence(2 * D + 3 * H + 10 * M), '2 days 3 hours 10 minutes left')
  assert.equal(countdownSentence(D + H + M), '1 day 1 hour 1 minute left')
  assert.equal(countdownSentence(5 * H), '5 hours left')
  assert.equal(countdownSentence(D + 20 * M), '1 day 20 minutes left')
  assert.equal(countdownSentence(45 * S), '45 seconds left')
  assert.equal(countdownSentence(M + 30 * S), '1 minute 30 seconds left')
  assert.equal(countdownSentence(1), '1 second left')
  assert.equal(countdownSentence(0), 'The wait is over')
  assert.equal(countdownSentence(-5), 'The wait is over')
  assert.equal(countdownSentence(NaN), 'The wait is over')
})
