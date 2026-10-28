import test from 'node:test'
import assert from 'node:assert/strict'
import { todaysMilestones } from '../src/lib/milestones.js'

const day = (y, m, d) => new Date(y, m - 1, d, 15, 30)

test('birthday matches viewer local month-day', () => {
  const people = [{ id: 'p1', name: 'Ana', birthday: '10-28' }, { id: 'p2', name: 'Bo', birthday: '10-29' }]
  assert.deepEqual(todaysMilestones(people, day(2026, 10, 28)), [{ personId: 'p1', name: 'Ana', kind: 'birthday' }])
})

test('Feb 29 birthday matches Feb 28 only in non-leap years', () => {
  const people = [{ id: 'p1', name: 'Leo', birthday: '02-29' }]
  assert.equal(todaysMilestones(people, day(2027, 2, 28)).length, 1)
  assert.equal(todaysMilestones(people, day(2027, 3, 1)).length, 0)
  assert.equal(todaysMilestones(people, day(2028, 2, 28)).length, 0)
  assert.equal(todaysMilestones(people, day(2028, 2, 29)).length, 1)
})

test('anniversary needs at least one full year', () => {
  const people = [{ id: 'p1', name: 'Ana', startDate: '2023-10-28' }]
  assert.deepEqual(todaysMilestones(people, day(2026, 10, 28)), [{ personId: 'p1', name: 'Ana', kind: 'anniversary', years: 3 }])
  assert.deepEqual(todaysMilestones([{ id: 'p', name: 'N', startDate: '2026-10-28' }], day(2026, 10, 28)), [])
  assert.deepEqual(todaysMilestones(people, day(2026, 10, 27)), [])
  assert.equal(todaysMilestones([{ id: 'p', name: 'N', startDate: '2025-10-28' }], day(2026, 10, 28))[0].years, 1)
})

test('startDate accepts Date objects and ISO strings; Feb 29 start rolls to Feb 28', () => {
  assert.equal(todaysMilestones([{ id: 'p', name: 'N', startDate: new Date('2024-10-28T00:00:00.000Z') }], day(2026, 10, 28))[0].years, 2)
  assert.equal(todaysMilestones([{ id: 'p', name: 'N', startDate: '2024-10-28T00:00:00.000Z' }], day(2026, 10, 28))[0].years, 2)
  assert.equal(todaysMilestones([{ id: 'p', name: 'N', startDate: '2020-02-29' }], day(2027, 2, 28))[0].years, 7)
})

test('person with both, and with neither/invalid data', () => {
  const people = [
    { id: 'p1', name: 'Ana', birthday: '10-28', startDate: '2020-10-28' },
    { id: 'p2', name: 'Bo', birthday: null, startDate: null },
    { id: 'p3', name: 'Cy', birthday: 'garbage', startDate: 'nope' },
  ]
  assert.deepEqual(todaysMilestones(people, day(2026, 10, 28)).map((m) => [m.personId, m.kind]), [['p1', 'birthday'], ['p1', 'anniversary']])
  assert.deepEqual(todaysMilestones(undefined, day(2026, 10, 28)), [])
})

test('defaults now to the current date without throwing', () => {
  assert.ok(Array.isArray(todaysMilestones([])))
})
