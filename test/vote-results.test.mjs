import test from 'node:test'
import assert from 'node:assert/strict'
import { perPerson, votesUsed, votesLeft, voteCount, topVoted, anyVotes, excerpt } from '../src/ui/voteResults.js'

const item = (id, votes = [], data = { text: id }, kind = 'note') => ({ id, kind, x: 0, y: 0, w: 200, h: 200, data, votes })
const ME = 'KM-AAAA-AAAA-AAAA'
const YOU = 'KM-BBBB-BBBB-BBBB'

test('perPerson reads the board and defaults to 3', () => {
  assert.equal(perPerson({ vote: { active: true, perPerson: 5 } }), 5)
  for (const b of [undefined, {}, { vote: null }, { vote: { active: true } }, { vote: { perPerson: 'x' } }, { vote: { perPerson: 0 } }, { vote: { perPerson: 99 } }]) assert.equal(perPerson(b), 3)
})

test('votesUsed counts the items the viewer voted on; votesLeft never goes below zero', () => {
  const items = [item('a', [ME, YOU]), item('b', [YOU]), item('c', [ME]), item('d')]
  assert.equal(votesUsed(items, ME), 2)
  assert.equal(votesUsed(items, YOU), 2)
  assert.equal(votesUsed(items, 'nobody'), 0)
  assert.equal(votesUsed([], ME), 0)
  assert.equal(votesUsed(items, undefined), 0)
  const board = { vote: { active: true, perPerson: 3 } }
  assert.equal(votesLeft(board, items, ME), 1)
  assert.equal(votesLeft({ vote: { active: true, perPerson: 1 } }, items, ME), 0)
  assert.equal(votesLeft({ vote: { active: true, perPerson: 1 } }, [item('a', [ME]), item('b', [ME])], ME), 0, 'over budget (the setting was lowered) is just zero')
  assert.equal(votesLeft(undefined, [], ME), 3)
})

test('voteCount tolerates items without a votes list', () => {
  assert.equal(voteCount(item('a', [ME, YOU])), 2)
  assert.equal(voteCount({ id: 'x' }), 0)
  assert.equal(voteCount(null), 0)
})

test('topVoted: highest first, three places, ties share a rank and stay together', () => {
  const items = [item('a', [ME]), item('b', [ME, YOU, 'c']), item('c', [ME, YOU]), item('d', [ME, YOU]), item('e'), item('f', [ME, YOU])]
  const top = topVoted(items)
  assert.deepEqual(top.map((r) => [r.id, r.count, r.rank]), [['b', 3, 1], ['c', 2, 2], ['d', 2, 2], ['f', 2, 2]])
})

test('topVoted: a tie across the cut keeps everyone tied with the third place; otherwise exactly three', () => {
  const four = [item('a', [ME, YOU, 'x', 'y']), item('b', [ME, YOU, 'x']), item('c', [ME, YOU]), item('d', [ME])]
  assert.deepEqual(topVoted(four).map((r) => [r.id, r.rank]), [['a', 1], ['b', 2], ['c', 3]])
  const tied = [item('a', [ME, YOU, 'x']), item('b', [ME, YOU]), item('c', [ME]), item('d', [YOU])]
  assert.deepEqual(topVoted(tied).map((r) => [r.id, r.count, r.rank]), [['a', 3, 1], ['b', 2, 2], ['c', 1, 3], ['d', 1, 3]])
  assert.deepEqual(topVoted(tied, 2).map((r) => r.id), ['a', 'b'])
})

test('topVoted: ties are ordered by id so the list is stable; items without votes never appear; empty is empty', () => {
  const items = [item('z', [ME]), item('m', [YOU]), item('a', [ME])]
  assert.deepEqual(topVoted(items).map((r) => r.id), ['a', 'm', 'z'])
  assert.deepEqual(topVoted([item('a'), item('b')]), [])
  assert.deepEqual(topVoted([]), [])
  assert.deepEqual(topVoted(null), [])
})

test('topVoted carries the item itself and ignores connectors and frames', () => {
  const link = { ...item('k', [ME, YOU, 'x']), kind: 'connector' }
  const frame = item('f', [ME, YOU, 'x'], { title: 'T' }, 'frame')
  const note = item('n', [ME])
  const top = topVoted([link, frame, note])
  assert.deepEqual(top.map((r) => r.id), ['n'])
  assert.equal(top[0].item, note)
})

test('anyVotes is true when at least one votable item has a vote (a frame or connector never counts)', () => {
  assert.equal(anyVotes([item('f', [ME], { title: 'T' }, 'frame'), { ...item('k', [ME]), kind: 'connector' }]), false)
  assert.equal(anyVotes([item('a'), item('b', [ME])]), true)
  assert.equal(anyVotes([item('a')]), false)
  assert.equal(anyVotes([]), false)
})

test('excerpt gives short readable text for each kind', () => {
  assert.equal(excerpt(item('a', [], { text: '  hello   world ' })), 'hello world')
  assert.equal(excerpt(item('a', [], { text: 'x'.repeat(100) }), 20), `${'x'.repeat(19)}…`)
  assert.equal(excerpt(item('f', [], { title: 'Went well' }, 'frame')), 'Went well')
  assert.equal(excerpt(item('i', [], { src: 'http://x/y.png' }, 'image')), 'Image')
  assert.equal(excerpt(item('e', [], { text: '' })), 'Empty note')
  assert.equal(excerpt(item('s', [], { text: 'Round', shape: 'ellipse' }, 'shape')), 'Round')
})
