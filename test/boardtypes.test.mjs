import test from 'node:test'
import assert from 'node:assert/strict'
import { BOARD_TYPES, typeInfo, templateList, defaultTitle, checkBoardDetails, templateLabel } from '../src/lib/boardTypes.js'
import { BOARD_TEMPLATES } from '../src/lib/templates.js'
import { validateBoardInput } from '../src/lib/validate.js'

test('the creatable types are workshop, celebration, retro and wall, each backed by real templates', () => {
  assert.deepEqual(BOARD_TYPES.map((t) => t.key), ['workshop', 'celebration', 'retro', 'wall'])
  for (const t of BOARD_TYPES) assert.ok(Object.hasOwn(BOARD_TEMPLATES, t.key) && t.label && t.short && t.blurb)
  assert.equal(BOARD_TYPES.find((t) => t.key === 'celebration').needsRecipient, true)
  assert.ok(!BOARD_TYPES.find((t) => t.key === 'workshop').needsRecipient)
  assert.ok(!BOARD_TYPES.find((t) => t.key === 'retro').needsRecipient)
})

test('retro: a chip label, three templates, no recipient needed', () => {
  assert.equal(typeInfo('retro').short, 'Retro')
  assert.equal(typeInfo('retro').label, 'Retro board')
  assert.deepEqual(templateList('retro').map((t) => t.key), ['retro-wwci', 'retro-ssc', 'retro-msg'])
  assert.equal(defaultTitle('retro', 'retro-ssc'), 'Sprint retrospective')
  assert.deepEqual(checkBoardDetails('retro', { title: 'Sprint 12' }), {})
  assert.deepEqual(checkBoardDetails('retro', { title: '' }), { title: 'Give the board a title' })
})

test('typeInfo falls back for types the dashboard does not create', () => {
  assert.equal(typeInfo('workshop').short, 'Workshop')
  assert.equal(typeInfo('celebration').short, 'Celebration')
  assert.equal(typeInfo('wall').short, 'Team wall')
  assert.equal(typeInfo('mystery').short, 'Mystery')
})

test('templateList mirrors BOARD_TEMPLATES in order', () => {
  assert.deepEqual(templateList('workshop').map((t) => t.key), Object.keys(BOARD_TEMPLATES.workshop))
  assert.deepEqual(templateList('celebration').map((t) => t.key), Object.keys(BOARD_TEMPLATES.celebration))
  for (const t of templateList('celebration')) assert.ok(t.label && t.emoji)
  assert.deepEqual(templateList('nope'), [])
})

test('templateLabel and defaultTitle', () => {
  assert.equal(templateLabel('workshop', 'retro'), 'Retrospective')
  assert.equal(templateLabel('workshop', 'zzz'), 'zzz')
  assert.equal(defaultTitle('workshop', 'retro'), 'Retrospective')
  assert.equal(defaultTitle('celebration', 'birthday', ''), 'Happy Birthday!')
  assert.equal(defaultTitle('celebration', 'birthday', ' Sam '), 'Happy Birthday, Sam!')
  assert.equal(defaultTitle('nope', 'x'), '')
})

test('every default title is accepted by the server validator', () => {
  for (const type of ['workshop', 'celebration']) {
    for (const t of templateList(type)) {
      const body = { type, template: t.key, title: defaultTitle(type, t.key, 'Sam'), recipient: type === 'celebration' ? { name: 'Sam' } : undefined }
      assert.equal(validateBoardInput(body).ok, true, `${type}/${t.key}`)
    }
  }
})

test('checkBoardDetails mirrors the server rules with friendly messages', () => {
  assert.deepEqual(checkBoardDetails('workshop', { title: 'Retro', recipient: '' }), {})
  assert.match(checkBoardDetails('workshop', { title: '   ', recipient: '' }).title, /Give the board a title/)
  assert.match(checkBoardDetails('workshop', { title: 'x'.repeat(81), recipient: '' }).title, /80 characters/)
  assert.deepEqual(checkBoardDetails('workshop', { title: 'x'.repeat(80), recipient: '' }), {})
  assert.match(checkBoardDetails('celebration', { title: 'Hi', recipient: ' ' }).recipient, /Who is this for/)
  assert.match(checkBoardDetails('celebration', { title: 'Hi', recipient: 'x'.repeat(61) }).recipient, /60 characters/)
  assert.deepEqual(checkBoardDetails('celebration', { title: 'Hi', recipient: 'Sam' }), {})
  assert.deepEqual(checkBoardDetails('workshop', { title: 'Hi', recipient: 'x'.repeat(500) }), {}) // ignored for workshops
})
