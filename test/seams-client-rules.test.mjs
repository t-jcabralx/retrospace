import test from 'node:test'
import assert from 'node:assert/strict'
import { toolAllowed, notesOpen, stageAllowsEdit, voteStageOpen, NOTES_CLOSED } from '../src/lib/clientRules.js'
import { allowedKinds } from '../src/lib/plan.js'
import { defaultRetro, applyRetroAction } from '../src/lib/retro.js'

const TOOLS = ['select', 'note', 'text', 'shape', 'connector', 'frame', 'image']
const tools = (type) => TOOLS.filter((t) => toolAllowed(type, t))

test('toolAllowed follows the server kinds for all four board types', () => {
  assert.deepEqual(tools('workshop'), TOOLS)
  assert.deepEqual(tools('retro'), TOOLS)
  assert.deepEqual(tools('celebration'), TOOLS)
  assert.deepEqual(tools('wall'), ['select', 'note', 'text'])
  assert.deepEqual(tools('unknown'), TOOLS) // falls back to the workshop set, like plan.js
  for (const type of ['workshop', 'retro', 'celebration', 'wall']) for (const t of tools(type)) if (t !== 'select') assert.ok(allowedKinds(type).includes(t))
})

const retro = (stage, editing) => {
  let r = defaultRetro()
  r = applyRetroAction(r, { type: 'goto', index: r.stages.findIndex((s) => s.key === stage) }, 1000)
  return { type: 'retro', retro: { ...r, editing } }
}

test('guests: notes open only in a collecting stage; the owner always', () => {
  assert.equal(notesOpen(retro('collect', true), false), true)
  assert.equal(notesOpen(retro('collect', false), false), false)
  assert.equal(notesOpen(retro('vote', false), false), false)
  assert.equal(notesOpen(retro('vote', false), true), true)
  assert.equal(notesOpen({ type: 'workshop' }, false), true)
  assert.equal(notesOpen({ type: 'retro' }, false), true) // no workflow
  assert.equal(notesOpen(undefined, false), true)
  assert.ok(NOTES_CLOSED.length > 0)
})

test('stageAllowsEdit blocks moving content outside collection for guests only', () => {
  const note = { kind: 'note' }
  assert.equal(stageAllowsEdit(retro('group', false), note, false), false)
  assert.equal(stageAllowsEdit(retro('group', false), note, true), true)
  assert.equal(stageAllowsEdit(retro('collect', true), note, false), true)
  assert.equal(stageAllowsEdit({ type: 'workshop' }, note, false), true)
})

test('voteStageOpen: guests vote only in the Vote stage', () => {
  assert.equal(voteStageOpen(retro('vote', false), false), true)
  assert.equal(voteStageOpen(retro('collect', true), false), false)
  assert.equal(voteStageOpen(retro('collect', true), true), true)
  assert.equal(voteStageOpen({ type: 'workshop' }, false), true)
})
