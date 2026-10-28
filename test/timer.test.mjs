import test from 'node:test'
import assert from 'node:assert/strict'
import { remainingMs, formatClock, timerPhase, clockOffset, createClock, announceBucket, announcementText, OVER_SHOW_MS, URGENT_MS } from '../src/ui/timer.js'

const T = { endsAt: 1_000_000, durationMs: 300_000 }

test('remainingMs counts down to the server end time using the offset', () => {
  assert.equal(remainingMs(T, 940_000), 60_000)
  assert.equal(remainingMs(T, 940_000, 0), 60_000)
  // this client's clock is 90 s ahead of the server: the offset (server - client) is -90 000
  assert.equal(remainingMs(T, 940_000 + 90_000, -90_000), 60_000)
  // and one that is 45 s behind
  assert.equal(remainingMs(T, 940_000 - 45_000, 45_000), 60_000)
  assert.equal(remainingMs(T, 1_000_000), 0)
  assert.equal(remainingMs(T, 1_004_500), -4500, 'negative once it is over')
})

test('two clients with different clocks agree once each applies its own offset', () => {
  const serverNow = 5_000_000
  const fast = { now: serverNow + 120_000 }
  const slow = { now: serverNow - 80_000 }
  const t = { endsAt: serverNow + 90_000, durationMs: 90_000 }
  assert.equal(remainingMs(t, fast.now, clockOffset(serverNow, fast.now, fast.now)), 90_000)
  assert.equal(remainingMs(t, slow.now, clockOffset(serverNow, slow.now, slow.now)), 90_000)
})

test('clockOffset assumes the server stamped the reply half way through the round trip', () => {
  assert.equal(clockOffset(10_000, 1000, 1000), 9000)
  assert.equal(clockOffset(10_000, 1000, 1400), 10_000 - 1200)
})

test('formatClock rounds up to whole seconds and never shows less than 0:00', () => {
  const cases = [[300_000, '5:00'], [299_001, '5:00'], [299_000, '4:59'], [61_000, '1:01'], [60_000, '1:00'], [59_999, '1:00'], [10_000, '0:10'], [9_001, '0:10'], [1, '0:01'], [0, '0:00'], [-1, '0:00'], [-99_999, '0:00'], [3_600_000, '60:00'], [14_400_000, '240:00']]
  for (const [ms, want] of cases) assert.equal(formatClock(ms), want, String(ms))
  assert.equal(formatClock(NaN), '0:00')
  assert.equal(formatClock(undefined), '0:00')
})

test('timerPhase: running, urgent in the last 10 s, over for 30 s after zero, then gone', () => {
  assert.equal(URGENT_MS, 10_000)
  assert.equal(OVER_SHOW_MS, 30_000)
  const cases = [[300_000, 'running'], [10_001, 'running'], [10_000, 'urgent'], [1, 'urgent'], [0, 'over'], [-1, 'over'], [-29_999, 'over'], [-30_000, 'gone'], [-31_000, 'gone'], [-1e9, 'gone']]
  for (const [ms, want] of cases) assert.equal(timerPhase(ms), want, String(ms))
  assert.equal(timerPhase(NaN), 'gone')
})

test('announceBucket only changes at 1:00, 0:30, 0:10 and 0:00', () => {
  const cases = [[300_000, null], [60_001, null], [60_000, 60], [45_000, 60], [30_001, 60], [30_000, 30], [20_000, 30], [10_001, 30], [10_000, 10], [5_000, 10], [1, 10], [0, 0], [-1, 0], [-20_000, 0]]
  for (const [ms, want] of cases) assert.equal(announceBucket(ms), want, String(ms))
  assert.equal(announcementText(60), 'One minute left')
  assert.equal(announcementText(30), 'Thirty seconds left')
  assert.equal(announcementText(10), 'Ten seconds left')
  assert.equal(announcementText(0), 'Time is up')
  assert.equal(announcementText(null), '')
})

test('createClock keeps the offset from the quickest round trip and ignores nonsense samples', () => {
  const c = createClock(() => 50_000)
  assert.equal(c.offset(), 0)
  assert.equal(c.now(), 50_000)
  c.sample(100_000, 1000, 1400) // rtt 400, offset 100000 - 1200 = 98800
  assert.equal(c.offset(), 98_800)
  c.sample(100_500, 1500, 1520) // rtt 20: better, offset 100500 - 1510 = 98990
  assert.equal(c.offset(), 98_990)
  c.sample(100_900, 2000, 3500) // rtt 1500: worse, ignored
  assert.equal(c.offset(), 98_990)
  c.sample(NaN, 1, 2)
  c.sample(100_000, 5000, 4000) // negative rtt
  c.sample(100_000, 0, 60_000) // absurd rtt
  assert.equal(c.offset(), 98_990)
  assert.equal(c.now(), 50_000 + 98_990)
})

test('createClock forgets old samples so a drifting clock is followed', () => {
  const c = createClock(() => 0)
  c.sample(1000, 0, 10) // offset 995, rtt 10
  for (let i = 0; i < 6; i++) c.sample(2000 + i, 0, 100) // offset about 1950, rtt 100: the first sample is pushed out
  assert.ok(Math.abs(c.offset() - 1950) < 10, String(c.offset()))
})
