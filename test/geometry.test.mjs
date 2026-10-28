import test from 'node:test'
import assert from 'node:assert/strict'
import {
  screenToWorld, worldToScreen, zoomAt, rectsIntersect, itemsInRect, itemsFullyInside, connectorPath,
  boundsOf, fitView, resizeRect, centerOn,
} from '../src/ui/geometry.js'

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)
const box = (id, x, y, w, h, extra = {}) => ({ id, kind: 'note', x, y, w, h, ...extra })

test('screen and world round-trip at scale 2 with an offset', () => {
  const view = { x: 100, y: -40, scale: 2 }
  const p = { x: 340, y: 60 }
  const w = screenToWorld(p, view)
  assert.deepEqual(w, { x: 120, y: 50 })
  assert.deepEqual(worldToScreen(w, view), p)
  const q = worldToScreen({ x: -7.5, y: 13.25 }, view)
  const back = screenToWorld(q, view)
  near(back.x, -7.5)
  near(back.y, 13.25)
})

test('zoomAt keeps the point under the cursor fixed', () => {
  const view = { x: 30, y: 70, scale: 1.5 }
  const pt = { x: 400, y: 250 }
  const before = screenToWorld(pt, view)
  const next = zoomAt(view, pt, 1.25)
  near(next.scale, 1.875)
  const after = screenToWorld(pt, next)
  near(after.x, before.x)
  near(after.y, before.y)
})

test('zoomAt clamps the scale to 0.1-4 at both ends and stays put when clamped', () => {
  const pt = { x: 10, y: 10 }
  const hi = zoomAt({ x: 5, y: 5, scale: 3.9 }, pt, 10)
  assert.equal(hi.scale, 4)
  const lo = zoomAt({ x: 5, y: 5, scale: 0.12 }, pt, 0.001)
  assert.equal(lo.scale, 0.1)
  assert.deepEqual(zoomAt({ x: 5, y: 7, scale: 4 }, pt, 2), { x: 5, y: 7, scale: 4 })
  const w = screenToWorld(pt, { x: 5, y: 5, scale: 3.9 })
  const after = screenToWorld(pt, hi)
  near(after.x, w.x)
  near(after.y, w.y)
})

test('rectsIntersect: overlap yes, touching edges and apart no', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 }
  assert.equal(rectsIntersect(a, { x: 90, y: 90, w: 50, h: 50 }), true)
  assert.equal(rectsIntersect(a, { x: 100, y: 0, w: 50, h: 50 }), false)
  assert.equal(rectsIntersect(a, { x: 200, y: 200, w: 5, h: 5 }), false)
  assert.equal(rectsIntersect(a, { x: 10, y: 10, w: 5, h: 5 }), true)
})

test('itemsInRect selects partially overlapping items', () => {
  const items = [box('in', 10, 10, 20, 20), box('part', 90, 90, 50, 50), box('out', 300, 300, 20, 20)]
  const hit = itemsInRect(items, { x: 0, y: 0, w: 100, h: 100 }).map((i) => i.id)
  assert.deepEqual(hit, ['in', 'part'])
})

test('itemsFullyInside excludes partially inside items, the frame itself and connectors', () => {
  const frame = box('f', 0, 0, 400, 300, { kind: 'frame' })
  const items = [
    frame,
    box('inside', 20, 20, 100, 100),
    box('edge', 300, 200, 100, 100),
    box('partial', 350, 250, 100, 100),
    box('outside', 500, 500, 10, 10),
    box('link', 10, 10, 20, 20, { kind: 'connector' }),
  ]
  assert.deepEqual(itemsFullyInside(frame, items).map((i) => i.id), ['inside', 'edge'])
})

test('connectorPath runs from the nearest source edge to the target edge', () => {
  const a = box('a', 0, 0, 100, 100)
  const b = box('b', 300, 0, 100, 100)
  const d = connectorPath(a, b)
  assert.match(d, /^M /)
  assert.match(d, /^M 100 50 C /) // right edge of a
  assert.match(d, / 300 50$/) // left edge of b
  const below = connectorPath(a, box('c', 0, 300, 100, 100))
  assert.match(below, /^M 50 100 C /)
  assert.match(below, / 50 300$/)
})

test('boundsOf, fitView and centerOn', () => {
  assert.equal(boundsOf([]), null)
  const b = boundsOf([box('a', 0, 0, 100, 100), box('b', 300, 200, 100, 100)])
  assert.deepEqual(b, { x: 0, y: 0, w: 400, h: 300 })
  const v = fitView(b, { w: 800, h: 600 }, 100)
  near(v.scale, 1) // (800-200)/400 = 1.5 and (600-200)/300 = 1.33, capped at 1
  const center = screenToWorld({ x: 400, y: 300 }, v)
  near(center.x, 200)
  near(center.y, 150)
  const c = centerOn({ x: 0, y: 0, scale: 2 }, { w: 800, h: 600 }, { x: 50, y: 50 })
  assert.deepEqual(screenToWorld({ x: 400, y: 300 }, c), { x: 50, y: 50 })
})

test('resizeRect: edges, corners, minimum size and aspect lock', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 }
  assert.deepEqual(resizeRect(r, 'se', 50, 20), { x: 100, y: 100, w: 250, h: 120 })
  assert.deepEqual(resizeRect(r, 'nw', 30, 10), { x: 130, y: 110, w: 170, h: 90 })
  assert.deepEqual(resizeRect(r, 'e', -500, 0, { min: 24 }), { x: 100, y: 100, w: 24, h: 100 })
  assert.deepEqual(resizeRect(r, 'w', 500, 0, { min: 24 }), { x: 276, y: 100, w: 24, h: 100 })
  const locked = resizeRect(r, 'se', 100, 0, { keepAspect: true })
  assert.deepEqual(locked, { x: 100, y: 100, w: 300, h: 150 })
  const lockedNw = resizeRect(r, 'nw', -100, 0, { keepAspect: true })
  assert.deepEqual(lockedNw, { x: 0, y: 50, w: 300, h: 150 })
})
