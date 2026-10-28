import test from 'node:test'
import assert from 'node:assert/strict'
import { ann, makeBoard, snapshot } from './helpers/summary-harness.mjs'
import { defaultRetro } from '../src/lib/retro.js'

test('the creation-time votes choice seeds retro.votesPerPerson and vote.perPerson', async () => {
  const code = await makeBoard(ann, { type: 'retro', template: 'retro-wwci', title: 'R', votes: 7 })
  const b = (await snapshot(code, ann.cookie)).data.board
  assert.equal(b.retro.votesPerPerson, 7)
  assert.equal(b.vote.perPerson, 7)
})

test('without a votes choice both stay at the default', async () => {
  const code = await makeBoard(ann)
  const b = (await snapshot(code, ann.cookie)).data.board
  assert.equal(b.retro.votesPerPerson, defaultRetro().votesPerPerson)
  assert.equal(b.vote.perPerson, 3)
})

test('defaultRetro takes the votes per person', () => {
  assert.equal(defaultRetro(5).votesPerPerson, 5)
  assert.equal(defaultRetro().votesPerPerson, 3)
})
