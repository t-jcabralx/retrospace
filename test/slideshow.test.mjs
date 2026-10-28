import test from 'node:test'
import assert from 'node:assert/strict'
import { initSlideshow, slideshowReducer as step, AUTO_MS, orderCards, dotMode } from '../src/ui/slideshow.js'

const run = (s, ...actions) => actions.reduce((cur, a) => step(cur, typeof a === 'string' ? { type: a } : a), s)

test('start: first slide, playing only with autoplay and more than one card', () => {
  assert.deepEqual(initSlideshow(5, { autoplay: true }), { index: 0, count: 5, playing: true })
  assert.deepEqual(initSlideshow(5, { autoplay: false }), { index: 0, count: 5, playing: false })
  assert.deepEqual(initSlideshow(1, { autoplay: true }), { index: 0, count: 1, playing: false })
  assert.deepEqual(initSlideshow(0, { autoplay: true }), { index: 0, count: 0, playing: false })
  assert.equal(AUTO_MS, 7000)
})

test('next and prev clamp at the ends', () => {
  let s = initSlideshow(3, { autoplay: false })
  assert.equal(run(s, 'prev').index, 0)
  s = run(s, 'next')
  assert.equal(s.index, 1)
  s = run(s, 'next', 'next', 'next')
  assert.equal(s.index, 2)
  assert.equal(run(s, 'prev').index, 1)
})

test('home and end jump to the first and last card', () => {
  const s = initSlideshow(10, { autoplay: false })
  assert.equal(run(s, 'end').index, 9)
  assert.equal(run(s, 'end', 'home').index, 0)
})

test('goto jumps to a card and clamps; junk is ignored', () => {
  const s = initSlideshow(4, { autoplay: false })
  assert.equal(run(s, { type: 'goto', index: 2 }).index, 2)
  assert.equal(run(s, { type: 'goto', index: 99 }).index, 3)
  assert.equal(run(s, { type: 'goto', index: -4 }).index, 0)
  assert.equal(run(s, { type: 'goto', index: 'x' }).index, 0)
})

test('auto advances one card and stops playing on the last one', () => {
  let s = initSlideshow(3, { autoplay: true })
  s = run(s, 'auto')
  assert.deepEqual(s, { index: 1, count: 3, playing: true })
  s = run(s, 'auto')
  assert.deepEqual(s, { index: 2, count: 3, playing: false })
  assert.deepEqual(run(s, 'auto'), s, 'nothing after the end')
})

test('auto does nothing while paused', () => {
  const s = run(initSlideshow(3, { autoplay: true }), 'pause')
  assert.equal(s.playing, false)
  assert.equal(run(s, 'auto').index, 0)
})

test('reaching the last card by hand also stops the autoplay', () => {
  const s = run(initSlideshow(3, { autoplay: true }), 'end')
  assert.deepEqual(s, { index: 2, count: 3, playing: false })
  assert.equal(run(initSlideshow(3, { autoplay: true }), 'next', 'next').playing, false)
})

test('going back from the end does not restart the autoplay by itself', () => {
  const s = run(initSlideshow(3, { autoplay: true }), 'end', 'prev')
  assert.deepEqual(s, { index: 1, count: 3, playing: false })
})

test('play resumes; at the last card it starts again from the first', () => {
  let s = run(initSlideshow(3, { autoplay: false }), 'play')
  assert.equal(s.playing, true)
  s = run(s, 'pause', 'end', 'play')
  assert.deepEqual(s, { index: 0, count: 3, playing: true })
  assert.equal(run(initSlideshow(1, { autoplay: false }), 'play').playing, false, 'one card cannot play')
})

test('toggle flips between pause and play', () => {
  const s = initSlideshow(4, { autoplay: true })
  assert.equal(run(s, 'toggle').playing, false)
  assert.equal(run(s, 'toggle', 'toggle').playing, true)
})

test('count: cards added during the show are appended and the position is kept', () => {
  let s = run(initSlideshow(3, { autoplay: true }), 'next')
  s = run(s, { type: 'count', count: 5 })
  assert.deepEqual(s, { index: 1, count: 5, playing: true })
  s = run(s, 'end')
  assert.equal(s.index, 4)
})

test('count: a card appended after the show stopped on the last one does not restart it', () => {
  const s = run(initSlideshow(3, { autoplay: true }), 'end', { type: 'count', count: 4 })
  assert.deepEqual(s, { index: 2, count: 4, playing: false })
})

test('count: removing cards clamps the position; the first card appearing starts at 0', () => {
  assert.equal(run(initSlideshow(5, { autoplay: false }), 'end', { type: 'count', count: 2 }).index, 1)
  assert.deepEqual(run(initSlideshow(5, { autoplay: false }), { type: 'count', count: 0 }), { index: 0, count: 0, playing: false })
  assert.equal(run(initSlideshow(0, { autoplay: false }), { type: 'count', count: 3 }).index, 0)
  assert.equal(run(initSlideshow(2, { autoplay: true }), { type: 'count', count: 1 }).playing, false)
  assert.equal(run(initSlideshow(2, { autoplay: false }), { type: 'count', count: -3 }).count, 0)
})

test('an empty or unknown action leaves the state alone', () => {
  const s = initSlideshow(3, { autoplay: false })
  assert.equal(step(s, { type: 'bogus' }), s)
  assert.equal(step(s, undefined), s)
  assert.equal(run(initSlideshow(0, { autoplay: false }), 'next', 'end', 'prev', 'home').index, 0)
})

test('orderCards: cards only, by stacking order then id, deleted and other kinds left out', () => {
  const c = (id, z, extra = {}) => ({ id, kind: 'card', z, data: {}, ...extra })
  const out = orderCards([c('b', 2), c('a', 1), c('c', 2), { id: 'n', kind: 'note', z: 0 }, c('d', 0, { deleted: true })])
  assert.deepEqual(out.map((i) => i.id), ['a', 'b', 'c'])
  assert.deepEqual(orderCards(undefined), [])
})

test('dotMode: dots for a short show, a bar for a long one', () => {
  assert.equal(dotMode(1), 'dots')
  assert.equal(dotMode(20), 'dots')
  assert.equal(dotMode(21), 'bar')
})

// --- round 1: reduced motion and late cards ---------------------------------------------------------------------
import { slideKeyAction, shouldAutoStart } from '../src/ui/slideshow.js'

test('under reduced motion play and toggle never start the autoplay (a pause still works)', () => {
  const s = initSlideshow(4, { autoplay: false })
  assert.equal(step(s, { type: 'play', reduced: true }).playing, false)
  assert.equal(step(s, { type: 'toggle', reduced: true }).playing, false)
  assert.equal(step(s, { type: 'play' }).playing, true, 'without the flag it plays')
  const playing = { ...s, playing: true }
  assert.equal(step(playing, { type: 'toggle', reduced: true }).playing, false, 'a running show can still be stopped')
  assert.equal(step(playing, { type: 'pause', reduced: true }).playing, false)
  assert.equal(step({ ...s, index: 3 }, { type: 'play', reduced: true }).index, 3, 'play at the end does not even restart')
})

test('slideKeyAction: Space is next card under reduced motion, toggle otherwise; buttons and links keep their own Space', () => {
  assert.equal(slideKeyAction(' ', { reduced: true, tag: 'SECTION' }), 'next')
  assert.equal(slideKeyAction(' ', { reduced: false, tag: 'SECTION' }), 'toggle')
  assert.equal(slideKeyAction(' ', { reduced: true, tag: 'BUTTON' }), null)
  assert.equal(slideKeyAction(' ', { reduced: false, tag: 'A' }), null)
  assert.equal(slideKeyAction('ArrowRight', { reduced: true, tag: 'BUTTON' }), 'next')
  assert.equal(slideKeyAction('ArrowLeft', {}), 'prev')
  assert.equal(slideKeyAction('Home', {}), 'home')
  assert.equal(slideKeyAction('End', {}), 'end')
  assert.equal(slideKeyAction('x', {}), null)
  assert.equal(slideKeyAction('ArrowRight', { tag: 'INPUT' }), null)
  assert.equal(slideKeyAction(' ', { tag: 'TEXTAREA' }), null)
})

test('shouldAutoStart: first cards arriving in an empty show start it, unless paused by the viewer or reduced motion', () => {
  assert.equal(shouldAutoStart(0, 3, { userPaused: false, reduced: false }), true)
  assert.equal(shouldAutoStart(0, 1, { userPaused: false, reduced: false }), false, 'one card has nothing to advance to')
  assert.equal(shouldAutoStart(1, 3, { userPaused: false, reduced: false }), true, 'a one-card show that grows can start')
  assert.equal(shouldAutoStart(0, 3, { userPaused: true, reduced: false }), false)
  assert.equal(shouldAutoStart(0, 3, { userPaused: false, reduced: true }), false)
  assert.equal(shouldAutoStart(3, 5, { userPaused: false, reduced: false }), false, 'a show already running is left alone')
  assert.equal(shouldAutoStart(0, 0, {}), false)
})

test('a show that gets its cards later plays once told to', () => {
  let s = initSlideshow(0, { autoplay: true })
  s = step(s, { type: 'count', count: 3 })
  assert.equal(s.playing, false)
  s = step(s, { type: 'play' })
  assert.deepEqual(s, { index: 0, count: 3, playing: true })
})
