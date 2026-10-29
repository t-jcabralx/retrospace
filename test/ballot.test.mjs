import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { myVotes, ballotSummary, perPerson } from '../src/ui/voteResults.js'

const note = (id, votes = [], extra = {}) => ({ id, kind: 'note', data: { text: `Note ${id}` }, votes, ...extra })
const board = { vote: { active: true, perPerson: 3 } }

test('myVotes lists the notes I voted on, and nothing for someone with no id or no votes', () => {
  const items = [note('a', ['me', 'x']), note('b', ['x']), note('c', ['me']), { id: 'f', kind: 'frame', data: { title: 'F' }, votes: ['me'] }]
  assert.deepEqual(myVotes(items, 'me').map((i) => i.id), ['a', 'c']) // frames are not votable
  assert.deepEqual(myVotes(items, 'nobody'), [])
  assert.deepEqual(myVotes(items, undefined), [])
  assert.deepEqual(myVotes(undefined, 'me'), [])
})

test('ballotSummary counts people, voters and finished voters, never names', () => {
  const items = [note('a', ['p1', 'p2']), note('b', ['p1']), note('c', ['p1']), note('d', ['p3'])]
  const s = ballotSummary(board, items, [{ uid: 'p1' }, { uid: 'p2' }, { uid: 'p3' }, { uid: 'p4' }, { uid: 'p5' }])
  assert.deepEqual(s, { people: 5, voters: 3, finished: 1, voting: 5 }) // p1 spent all three; p2 and p3 one each; p4 and p5 have not voted
  assert.ok(!JSON.stringify(s).includes('p1'))
})

test('a voter who is not in the list of participants still counts, and an empty board is all zeros', () => {
  assert.equal(ballotSummary(board, [note('a', ['ghost'])], []).people, 1)
  assert.deepEqual(ballotSummary(board, [], []), { people: 0, voters: 0, finished: 0, voting: 0 })
  assert.deepEqual(ballotSummary({}, [], [{ uid: 'a' }]), { people: 1, voters: 0, finished: 0, voting: 0 })
  assert.equal(perPerson({ vote: { perPerson: 5 } }), 5)
})

test('the card shows tokens, where my votes are, a take-back button, and counts for the host only', async () => {
  const src = await readFile(new URL('../src/ui/Ballot.jsx', import.meta.url), 'utf8')
  for (const word of ['Your ballot', 'Where your votes are', 'Take back', 'ctl.vote(i.id)', 'onJump(i.id)', 'isOwner &&', 'All votes placed']) assert.ok(src.includes(word), word)
  const panel = await readFile(new URL('../src/ui/VotePanel.jsx', import.meta.url), 'utf8')
  assert.ok(panel.includes('<Ballot ctl={ctl} onJump={onJump} />') && panel.includes('My votes'))
})
