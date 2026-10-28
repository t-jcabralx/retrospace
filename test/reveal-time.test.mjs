import test from 'node:test'
import assert from 'node:assert/strict'
import { toLocalInput, fromLocalInput, describeReveal, zoneLabel } from '../src/ui/revealTime.js'

test('a local date-time field value and an ISO instant convert both ways, in the viewer\'s zone', () => {
  for (const tz of ['Asia/Manila', 'America/Los_Angeles', 'Europe/London', 'Pacific/Auckland']) {
    process.env.TZ = tz
    const local = '2030-05-01T15:30'
    const iso = fromLocalInput(local)
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/, tz)
    assert.equal(new Date(iso).getHours(), 15, tz)
    assert.equal(new Date(iso).getMinutes(), 30, tz)
    assert.equal(toLocalInput(iso), local, tz)
  }
})

test('manila is eight hours ahead of UTC', () => {
  process.env.TZ = 'Asia/Manila'
  assert.equal(fromLocalInput('2030-05-01T08:00'), '2030-05-01T00:00:00.000Z')
  assert.equal(toLocalInput('2030-05-01T00:00:00.000Z'), '2030-05-01T08:00')
})

test('empty, unreadable and missing values give an empty field / null', () => {
  assert.equal(toLocalInput(null), '')
  assert.equal(toLocalInput(undefined), '')
  assert.equal(toLocalInput('garbage'), '')
  assert.equal(fromLocalInput(''), null)
  assert.equal(fromLocalInput('   '), null)
  assert.equal(fromLocalInput('garbage'), null)
  assert.equal(fromLocalInput(null), null)
})

test('describeReveal says what will happen, relative to now', () => {
  process.env.TZ = 'Asia/Manila'
  const now = Date.parse('2030-05-01T00:00:00.000Z')
  assert.match(describeReveal(null, now), /right away|any time/i)
  assert.match(describeReveal('2030-05-02T00:00:00.000Z', now), /^Reveals /)
  assert.match(describeReveal('2030-04-30T00:00:00.000Z', now), /^Revealed /)
  assert.match(describeReveal('garbage', now), /right away|any time/i)
  assert.match(describeReveal('2030-05-02T00:00:00.000Z', now), /2030/)
})

test('zoneLabel names the zone and its UTC offset', () => {
  process.env.TZ = 'Asia/Manila'
  assert.match(zoneLabel(new Date('2030-05-01T00:00:00Z')), /Asia\/Manila.*UTC\+08:00/)
  process.env.TZ = 'America/Los_Angeles'
  assert.match(zoneLabel(new Date('2030-01-15T00:00:00Z')), /America\/Los_Angeles.*UTC-08:00/)
  process.env.TZ = 'UTC'
  assert.match(zoneLabel(new Date('2030-01-15T00:00:00Z')), /UTC/)
})
