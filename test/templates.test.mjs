import test from 'node:test'
import assert from 'node:assert/strict'
import { BOARD_TEMPLATES, getTemplate } from '../src/lib/templates.js'
import { validateItem } from '../src/lib/validate.js'

test('template keys per board type', () => {
  assert.deepEqual(Object.keys(BOARD_TEMPLATES.workshop), ['blank', 'retro', 'brainstorm', 'swot'])
  assert.deepEqual(Object.keys(BOARD_TEMPLATES.celebration), ['birthday', 'promotion', 'farewell', 'anniversary', 'welcome', 'baby', 'congrats', 'thanks'])
  assert.deepEqual(Object.keys(BOARD_TEMPLATES.wall), ['team'])
})

test('every template resolves and its starter items validate', () => {
  for (const [type, group] of Object.entries(BOARD_TEMPLATES)) {
    for (const key of Object.keys(group)) {
      const t = getTemplate(type, key)
      assert.ok(t, `${type}/${key}`)
      assert.equal(t.key, key)
      assert.ok(t.label && t.emoji)
      assert.ok(['confetti', 'fireworks', 'balloons'].includes(t.theme.effect))
      assert.ok(t.theme.bg && t.theme.pattern && t.theme.accent)
      assert.equal(typeof t.title({ name: 'Sam' }), 'string')
      const items = t.starterItems({ name: 'Sam' })
      const ids = new Set()
      for (const item of items) {
        const r = validateItem(item)
        assert.equal(r.ok, true, `${type}/${key}: ${r.error}`)
        assert.ok(item.id.startsWith('starter-'))
        ids.add(item.id)
      }
      assert.equal(ids.size, items.length)
      assert.deepEqual(items, t.starterItems({ name: 'Sam' }), 'deterministic')
    }
  }
})

test('unknown type or key returns null', () => {
  assert.equal(getTemplate('workshop', 'nope'), null)
  assert.equal(getTemplate('nope', 'blank'), null)
  assert.equal(getTemplate('workshop', '__proto__'), null)
  assert.equal(getTemplate('__proto__', 'blank'), null)
})

test('workshop starter frames', () => {
  const titles = (k) => getTemplate('workshop', k).starterItems().map((i) => i.data.title)
  assert.deepEqual(titles('retro'), ['Went well', 'To improve', 'Action items'])
  assert.equal(titles('swot').length, 4)
  assert.equal(titles('blank').length, 0)
})

test('celebration header carries the recipient title', () => {
  const t = getTemplate('celebration', 'birthday')
  assert.equal(t.title({ name: 'Sam' }), 'Happy Birthday, Sam!')
  assert.equal(t.title('Sam'), 'Happy Birthday, Sam!')
  assert.equal(t.title(null), 'Happy Birthday!')
  const [header, ...rest] = t.starterItems({ name: 'Sam' })
  assert.equal(rest.length, 0)
  assert.equal(header.kind, 'text')
  assert.equal(header.data.text, 'Happy Birthday, Sam!')
})

test('effects by occasion', () => {
  const eff = (k) => getTemplate('celebration', k).theme.effect
  assert.equal(eff('birthday'), 'balloons')
  for (const k of ['promotion', 'congrats', 'anniversary']) assert.equal(eff(k), 'fireworks')
  for (const k of ['farewell', 'welcome', 'baby', 'thanks']) assert.equal(eff(k), 'confetti')
})

test('team wall has a header text', () => {
  const items = getTemplate('wall', 'team').starterItems()
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'text')
})

test('retro templates: a header plus column frames laid out left to right without overlap', () => {
  assert.deepEqual(Object.keys(BOARD_TEMPLATES.retro), ['retro-wwci', 'retro-ssc', 'retro-msg'])
  const cols = (k) => getTemplate('retro', k).starterItems().filter((i) => i.kind === 'frame')
  assert.deepEqual(cols('retro-wwci').map((f) => f.data.title), ['✅ Went Well', '⚠️ Could Be Improved', '🚧 Blockers', '💡 Ideas'])
  assert.deepEqual(cols('retro-ssc').map((f) => f.data.title), ['Start', 'Stop', 'Continue'])
  assert.deepEqual(cols('retro-msg').map((f) => f.data.title), ['Mad', 'Sad', 'Glad'])
  for (const k of Object.keys(BOARD_TEMPLATES.retro)) {
    const t = getTemplate('retro', k)
    const items = t.starterItems()
    const header = items.find((i) => i.kind === 'text')
    assert.equal(header.data.text, 'Add notes to each column, then vote.')
    assert.equal(t.title(null), 'Sprint retrospective')
    const frames = cols(k)
    frames.forEach((f, n) => {
      assert.deepEqual([f.w, f.h, f.y, f.x], [360, 640, 140, n * 384])
      if (n) assert.equal(f.x - (frames[n - 1].x + frames[n - 1].w), 24)
    })
    assert.ok(header.y + header.h <= frames[0].y, 'the header sits above the columns')
    assert.equal(header.x + header.w, frames.at(-1).x + frames.at(-1).w, 'the header spans the columns')
  }
})
