import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement: h } = await import('react')
const { renderToStaticMarkup: render } = await import('react-dom/server')
const { default: ItemView } = await import('../src/ui/ItemView.jsx')
const { default: RetroStage } = await import('../src/ui/RetroStage.jsx')
const { default: StagesSection } = await import('../src/ui/settings/StagesSection.jsx')
const { default: ActionComposer } = await import('../src/ui/ActionComposer.jsx')
const { itemLabel } = await import('../src/ui/labels.js')
const { defaultRetro, applyRetroAction } = await import('../src/lib/retro.js')

const noop = () => {}
const action = (data) => ({ id: 'a1', kind: 'action', x: 0, y: 0, w: 280, h: 200, z: 0, rot: 0, authorName: 'Ann', data })
const noteItem = (id, text, votes) => ({ id, kind: 'note', x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data: { text }, votes: Array.from({ length: votes }, (_, n) => `u${n}`) })
const ctlFor = (retro, { isOwner = false, items = [], vote = { active: false, perPerson: 3 } } = {}) => ({
  code: 'ABC123', isOwner, readOnly: false, uid: 'me', items, canEdit: () => true, local: () => true,
  board: { type: 'retro', retro, vote, timer: null }, clock: { offset: () => 0 }, syncCid: () => 'c', applyBoard: noop, votesCleared: noop,
})
const at = (key) => applyRetroAction(defaultRetro(), { type: 'goto', index: ['join', 'collect', 'group', 'vote', 'discuss', 'actions', 'wrapup'].indexOf(key) }, Date.now())

test('an action card flags a missing owner and due date, and reads out in labels', () => {
  const bare = render(h(ItemView, { item: action({ action: 'Fix CI', owner: '', due: '', status: 'open', priority: 'normal' }), selected: false, editable: true, onChange: noop, onSelect: noop, label: 'x' }))
  assert.match(bare, /Fix CI/)
  assert.match(bare, /Needs owner/)
  assert.match(bare, /Needs due date/)
  const full = render(h(ItemView, { item: action({ action: 'Fix CI', owner: 'Sam', due: '2027-01-02', status: 'doing', priority: 'high' }), selected: false, editable: true, onChange: noop, onSelect: noop, label: 'x' }))
  assert.doesNotMatch(full, /Needs owner|Needs due date/)
  assert.match(full, /Sam/)
  assert.match(itemLabel(action({ action: 'Fix CI', owner: '', due: '' })), /needs an owner.*needs a due date/)
})

test('the stage header shows the step, the facilitator bar only for the owner', () => {
  const retro = at('collect')
  const guest = render(h(RetroStage, { ctl: ctlFor(retro), onOpenSettings: noop }))
  assert.match(guest, /Step 2 of 7/)
  assert.match(guest, /Collect feedback/)
  assert.match(guest, /Add a note/)
  assert.doesNotMatch(guest, /Facilitator controls/)
  const owner = render(h(RetroStage, { ctl: ctlFor(retro, { isOwner: true }), onOpenSettings: noop }))
  assert.match(owner, /Facilitator controls/)
  assert.match(owner, /Next stage/)
  assert.match(owner, /Lock notes/)
  assert.match(render(h(RetroStage, { ctl: ctlFor(defaultRetro(), { isOwner: true }), onOpenSettings: noop })), />Start</)
  assert.equal(render(h(RetroStage, { ctl: { ...ctlFor(retro), board: { type: 'retro' } } })), '') // no workflow: nothing at all
})

test('stage panels: locked notes, vote count, discussion topics with ties', () => {
  const locked = { ...at('collect'), editing: false }
  assert.match(render(h(RetroStage, { ctl: ctlFor(locked) })), /Notes are closed/)
  assert.match(render(h(RetroStage, { ctl: ctlFor(at('vote'), { vote: { active: true, perPerson: 3 }, items: [noteItem('a', 'x', 1)] }) })), /3 of 3 votes left/)
  const items = [noteItem('a', 'Alpha topic', 4), noteItem('b', 'Beta topic', 2), noteItem('c', 'Gamma topic', 2), noteItem('d', 'Delta topic', 2)]
  const html = render(h(RetroStage, { ctl: ctlFor({ ...at('discuss'), topN: 2 }, { isOwner: true, items }) }))
  assert.match(html, /Alpha topic/)
  assert.match(html, /4 votes/)
  assert.match(html, /Tied/)
  assert.match(html, /Discuss this/)
  assert.match(render(h(RetroStage, { ctl: ctlFor({ ...at('discuss'), topN: 2 }, { items }) })), /The facilitator will choose/)
  assert.match(render(h(RetroStage, { ctl: ctlFor(at('discuss')) })), /No votes yet/)
})

test('the action stage: composer for participants, limit message, the list', () => {
  const retro = at('actions')
  const html = render(h(RetroStage, { ctl: ctlFor(retro, { items: [action({ action: 'Do X', owner: '', due: '' })] }) }))
  assert.match(html, /What will we do\?/)
  assert.match(html, /Needs owner/)
  const full = render(h(RetroStage, { ctl: ctlFor({ ...retro, maxActions: 1 }, { items: [action({ action: 'Do X' })] }) }))
  assert.match(full, /limit of 1 actions is reached/)
  assert.doesNotMatch(full, /What will we do\?/)
  assert.match(render(h(ActionComposer, { ctl: ctlFor(retro), initial: action({ action: 'Do X', status: 'doing' }) })), /Save action/)
})

test('the stages section lists every stage with its minutes and the limits', () => {
  const html = render(h(StagesSection, { retro: defaultRetro(), patchBoard: noop }))
  for (const label of ['Join', 'Collect feedback', 'Group', 'Vote', 'Review and discuss', 'Create actions', 'Wrap up']) assert.match(html, new RegExp(label))
  assert.match(html, /Reset to defaults/)
  assert.match(html, /Votes per person/)
  assert.match(html, /placeholder="No timer"/)
})
