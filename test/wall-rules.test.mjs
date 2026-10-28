import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateOp, validateItem, validateBoardInput, BADGES, REACTIONS } from '../src/lib/validate.js'
import { allowedKinds, planOps } from '../src/lib/plan.js'
import { getTemplate } from '../src/lib/templates.js'
import { BOARD_TYPES, typeInfo } from '../src/lib/boardTypes.js'
import { itemLabel } from '../src/ui/labels.js'
import {
  guestPeople, parseToday, milestonesOn, feedItems, feedPage, FEED_PAGE, matchPeople, MAX_MENTIONS, buildShoutoutData, checkShoutout,
  milestoneKey, bannerSeen, markBannerSeen, bannerEffects, bannerLines, readView, writeView, rowProblem, toRows, rowsToPayload, localDay,
} from '../src/lib/wall.js'
import { throttleShoutouts } from '../src/lib/wallLimit.js'
import { buildShoutoutOp } from '../src/ui/shoutoutOps.js'

const so = (data = {}) => ({ id: 's1', kind: 'shoutout', x: 0, y: 0, w: 320, h: 280, data: { toName: 'Ana', message: 'Great job', badge: 'Teamwork', ...data } })

test('wall template: type, starter header, allowed kinds, board creation', () => {
  const t = getTemplate('wall', 'team')
  assert.equal(t.label, 'Team wall')
  const items = t.starterItems()
  assert.ok(items.length >= 1 && items.every((i) => validateItem(i).ok))
  assert.deepEqual(allowedKinds('wall').sort(), ['note', 'shoutout', 'text'])
  assert.deepEqual(validateBoardInput({ type: 'wall', template: 'team', title: 'Us' }).board, { type: 'wall', template: 'team', title: 'Us', recipient: null })
  assert.ok(BOARD_TYPES.some((x) => x.key === 'wall') && typeInfo('wall').short === 'Team wall')
})

test('shout-out validation: badge, lengths, https gif, person id, post time', () => {
  assert.equal(validateItem(so()).ok, true)
  for (const b of BADGES) assert.equal(validateItem(so({ badge: b })).ok, true)
  assert.equal(validateItem(so({ badge: 'Nope' })).ok, false)
  assert.equal(validateItem(so({ toName: '' })).ok, false)
  assert.equal(validateItem(so({ toName: '  ' })).ok, false)
  assert.equal(validateItem(so({ toName: 'x'.repeat(61) })).ok, false)
  assert.equal(validateItem(so({ toName: 'x'.repeat(60) })).ok, true)
  assert.equal(validateItem(so({ message: '' })).ok, false)
  assert.equal(validateItem(so({ message: 'm'.repeat(501) })).ok, false)
  assert.equal(validateItem(so({ message: 'm'.repeat(500) })).ok, true)
  assert.equal(validateItem(so({ gif: 'http://x.example/a.gif' })).ok, false)
  assert.equal(validateItem(so({ gif: 'https://x.example/a.gif' })).ok, true)
  assert.equal(validateItem(so({ to: 'p1', at: 123 })).ok, true)
  assert.equal(validateItem(so({ to: '' })).ok, false)
  assert.equal(validateItem(so({ at: 'now' })).ok, false)
})

test('reactions: the six emojis only', () => {
  for (const emoji of REACTIONS) assert.equal(validateOp({ op: 'react', id: 'a', emoji }).ok, true)
  assert.equal(validateOp({ op: 'react', id: 'a', emoji: '💩' }).ok, false)
})

test('plan: shout-outs are accepted on a wall and refused on other boards', () => {
  const add = validateOp({ op: 'add', item: so() }).op
  const actor = { uid: 'g1', name: 'Gus', isOwner: false }
  const wall = planOps({ code: 'ABC', type: 'wall' }, new Map(), [add], actor, 1)
  assert.equal(wall.applied.length, 1)
  const ws = planOps({ code: 'ABC', type: 'workshop' }, new Map(), [add], actor, 1)
  assert.equal(ws.rejected.length, 1)
  // guest deletes only their own; the owner deletes any
  const items = new Map([['s1', wall.applied[0]]])
  const other = { uid: 'g2', name: 'Bo', isOwner: false }
  assert.equal(planOps({ code: 'ABC', type: 'wall' }, items, [{ op: 'delete', id: 's1' }], other, 2).rejected.length, 1)
  assert.equal(planOps({ code: 'ABC', type: 'wall' }, items, [{ op: 'delete', id: 's1' }], { ...other, isOwner: true }, 2).applied.length, 1)
})

test('rate limit: ten shout-out adds a minute per participant, the 11th is "Slow down"; other ops pass', async () => {
  const counts = new Map()
  const hit = async (key) => { counts.set(key, (counts.get(key) ?? 0) + 1); return counts.get(key) }
  const adds = Array.from({ length: 12 }, (_, i) => ({ op: 'add', id: `s${i}`, item: so({ message: `m${i}` }) }))
  const react = { op: 'react', id: 'x', emoji: '🎉' }
  const r = await throttleShoutouts([...adds, react], 'ABC', 'u1', hit)
  assert.equal(r.allowed.length, 11) // 10 adds + the reaction
  assert.deepEqual(r.rejected, [{ id: 's10', error: 'Slow down' }, { id: 's11', error: 'Slow down' }].map((x) => ({ ...x, id: x.id })))
  const other = await throttleShoutouts([adds[0]], 'ABC', 'u2', hit)
  assert.equal(other.allowed.length, 1, 'another participant has their own count')
  const note = await throttleShoutouts([{ op: 'add', id: 'n', item: { kind: 'note' } }], 'ABC', 'u1', hit)
  assert.equal(note.allowed.length, 1, 'notes are not shout-outs')
})

test('guestPeople keeps id and name only; milestones return no raw dates; parseToday validates', () => {
  assert.deepEqual(guestPeople([{ id: 'p', name: 'Ana', birthday: '03-14', startDate: new Date() }]), [{ id: 'p', name: 'Ana' }])
  assert.deepEqual(guestPeople(undefined), [])
  const now = Date.UTC(2026, 2, 14, 12)
  assert.equal(parseToday('2026-03-14', now).ok, true)
  for (const bad of [undefined, '', '2026-3-14', '2026-02-30', '2026-13-01', 'x', '2026-03-20', '2026-03-10']) assert.equal(parseToday(bad, now).ok, false, String(bad))
  const p = parseToday('2026-03-14', now)
  const people = [{ id: 'a', name: 'Ana', birthday: '03-14', startDate: new Date('2024-03-14T00:00:00Z') }, { id: 'b', name: 'Bo', birthday: '01-01', startDate: null }]
  assert.deepEqual(milestonesOn(people, p), [{ personId: 'a', name: 'Ana', kind: 'birthday' }, { personId: 'a', name: 'Ana', kind: 'anniversary', years: 2 }])
  // Feb 29 is celebrated on Feb 28 in a year without one
  assert.equal(milestonesOn([{ id: 'c', name: 'Cy', birthday: '02-29' }], parseToday('2027-02-28', Date.UTC(2027, 1, 28))).length, 1)
})

test('feed: newest first, deleted and other kinds left out, "Load more" pages of 30', () => {
  const mk = (id, at, over = {}) => ({ id, kind: 'shoutout', z: 0, data: { at }, ...over })
  const list = feedItems([mk('a', 1), mk('b', 3), mk('c', 2), mk('d', 9, { deleted: true }), { id: 'n', kind: 'note', data: { at: 99 } }])
  assert.deepEqual(list.map((i) => i.id), ['b', 'c', 'a'])
  assert.deepEqual(feedItems([mk('x', 5), mk('y', 5)]).map((i) => i.id), ['y', 'x'], 'ties are stable')
  const many = Array.from({ length: 75 }, (_, i) => mk(`i${i}`, i))
  const sorted = feedItems(many)
  const p1 = feedPage(sorted)
  assert.deepEqual([p1.visible.length, p1.hasMore, p1.next], [FEED_PAGE, true, 60])
  const p2 = feedPage(sorted, p1.next)
  assert.deepEqual([p2.visible.length, p2.hasMore], [60, true])
  const p3 = feedPage(sorted, p2.next)
  assert.deepEqual([p3.visible.length, p3.hasMore], [75, false])
  assert.equal(feedPage([]).hasMore, false)
})

test('mention autocomplete: case and accent insensitive, prefix first, at most 8', () => {
  const people = [{ id: '1', name: 'José' }, { id: '2', name: 'Ana Jose' }, { id: '3', name: 'Álvaro' }, { id: '4', name: 'Bo' }]
  assert.deepEqual(matchPeople(people, 'jose').map((p) => p.id), ['1', '2'])
  assert.deepEqual(matchPeople(people, '@ALV').map((p) => p.id), ['3'])
  assert.deepEqual(matchPeople(people, 'zzz'), [])
  assert.equal(matchPeople(people, '').length, 4)
  const lots = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: `Sam ${i}` }))
  assert.equal(matchPeople(lots, 'sam').length, MAX_MENTIONS)
  assert.deepEqual(matchPeople(null, 'a'), [])
})

test('composer rules and the post: texts, data shape, op placed on the next canvas slot', () => {
  assert.deepEqual(checkShoutout({ toName: 'Ana', message: 'Hi' }), {})
  assert.ok(checkShoutout({ toName: ' ', message: 'Hi' }).toName)
  assert.ok(checkShoutout({ toName: 'x'.repeat(61), message: 'Hi' }).toName)
  assert.ok(checkShoutout({ toName: 'Ana', message: '' }).message)
  assert.ok(checkShoutout({ toName: 'Ana', message: 'm'.repeat(501) }).message)
  const data = buildShoutoutData({ toName: ' Ana ', to: 'p1', message: ' hi ', badge: 'Thank You', gif: 'https://g.example/a.gif' }, 42)
  assert.deepEqual(data, { toName: 'Ana', message: 'hi', badge: 'Thank You', at: 42, to: 'p1', gif: 'https://g.example/a.gif' })
  assert.equal(validateItem({ id: 'z', kind: 'shoutout', x: 0, y: 0, w: 320, h: 280, data }).ok, true)
  const first = buildShoutoutOp([], { toName: 'Ana', message: 'hi', badge: 'Teamwork' }, 'o1', 7)
  assert.equal(first.item.data.at, 7)
  assert.equal(validateOp(first).ok, true)
  const fourth = buildShoutoutOp([{ kind: 'shoutout' }, { kind: 'shoutout' }, { kind: 'shoutout' }], { toName: 'Ana', message: 'hi', badge: 'Teamwork' }, 'o4')
  assert.deepEqual([fourth.item.x, fourth.item.y], [0, 300])
})

test('milestone banner: key format, once per day per board per browser, effects and lines', () => {
  assert.equal(milestoneKey('ABC123', '2026-10-28'), 'km:ms:ABC123:2026-10-28')
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  assert.equal(bannerSeen(storage, 'ABC', '2026-10-28'), false)
  markBannerSeen(storage, 'ABC', '2026-10-28')
  assert.equal(bannerSeen(storage, 'ABC', '2026-10-28'), true)
  assert.equal(bannerSeen(storage, 'ABC', '2026-10-29'), false, 'a new day shows it again')
  assert.equal(bannerSeen(storage, 'XYZ', '2026-10-28'), false, 'per board')
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(bannerSeen(broken, 'ABC', 'd'), false)
  assert.doesNotThrow(() => markBannerSeen(broken, 'ABC', 'd'))
  const ms = [{ personId: 'a', name: 'Ana', kind: 'birthday' }, { personId: 'b', name: 'Bo', kind: 'anniversary', years: 1 }]
  assert.deepEqual(bannerEffects(ms), ['balloons', 'fireworks'])
  assert.deepEqual(bannerEffects([ms[1]]), ['fireworks'])
  assert.deepEqual(bannerLines(ms), ['Happy birthday, Ana!', 'Bo: 1 year at the team today!'])
  assert.equal(localDay(new Date(2026, 0, 5)), '2026-01-05')
})

test('feed/canvas choice is remembered per board and survives broken storage', () => {
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  assert.equal(readView(storage, 'ABC'), 'feed')
  writeView(storage, 'ABC', 'canvas')
  assert.equal(readView(storage, 'ABC'), 'canvas')
  assert.equal(readView(storage, 'XYZ'), 'feed')
  assert.equal(readView(null, 'ABC'), 'feed')
})

test('people editor rows: validation and payload', () => {
  assert.equal(rowProblem({ name: 'Ana', birthday: '', startDate: '' }), '')
  assert.equal(rowProblem({ name: 'Ana', birthday: '02-29', startDate: '2020-01-01' }), '')
  assert.ok(rowProblem({ name: ' ', birthday: '', startDate: '' }))
  assert.ok(rowProblem({ name: 'Ana', birthday: '13-01', startDate: '' }))
  assert.ok(rowProblem({ name: 'Ana', birthday: '02-30', startDate: '' }))
  assert.ok(rowProblem({ name: 'Ana', birthday: '', startDate: '2020-13-45' }))
  const rows = toRows([{ id: 'p', name: 'Ana', birthday: '03-14', startDate: '2020-05-06T00:00:00.000Z' }, { id: 'q', name: 'Bo', birthday: null, startDate: null }])
  assert.deepEqual(rows[0], { id: 'p', name: 'Ana', birthday: '03-14', startDate: '2020-05-06' })
  assert.deepEqual(rowsToPayload(rows), [{ id: 'p', name: 'Ana', birthday: '03-14', startDate: '2020-05-06' }, { id: 'q', name: 'Bo', birthday: null, startDate: null }])
})

test('shout-out label for assistive tech, and the renderer is wired into the item view', async () => {
  assert.match(itemLabel({ kind: 'shoutout', authorName: 'Gus', data: { toName: 'Ana', badge: 'Teamwork', message: 'Great job' } }), /Shout-out to Ana \(Teamwork\): Great job, by Gus/)
  const view = await readFile(new URL('../src/ui/ItemView.jsx', import.meta.url), 'utf8')
  assert.match(view, /import Shoutout from '\.\/items\/Shoutout\.jsx'/)
  assert.match(view, /shoutout: Shoutout/)
  const settings = await readFile(new URL('../src/ui/BoardSettings.jsx', import.meta.url), 'utf8')
  assert.match(settings, /board\.type === 'wall' && <PeopleEditor/)
})
