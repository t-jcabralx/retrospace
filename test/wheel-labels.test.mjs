import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: WheelSvg } = await import('../src/ui/event/WheelSvg.jsx')
const { default: WheelWho } = await import('../src/ui/event/WheelWho.jsx')
const { PRIZE_COLORS, cleanSetup, defaultWheel } = await import('../src/lib/wheel.js')

const idle = { turning: null, outer: 0, inner: 0, winnerShown: false, prizeShown: false, winner: null, prize: null }
const people = (names) => names.map((name, i) => ({ id: `p${i}`, name, on: true }))
const prizes = (list) => list.map(([name, emoji], i) => ({ id: `z${i}`, name, emoji, qty: 1, color: PRIZE_COLORS[i % PRIZE_COLORS.length] }))
const draw = (p, z) => renderToStaticMarkup(createElement(WheelSvg, { people: p, prizes: z, v: idle, hub: { text: '🎡' }, spin: null }))
const NAMES = ['Maria Santos', 'John Reyes', 'Priya Nair', 'Alex Cruz', 'Sam Lee', 'Dana Ortiz', 'Christopher Villanueva-Mendoza', 'Ana', 'Bea Cortez', 'Carlo Dizon']
const many = Array.from({ length: 40 }, (_, i) => NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${i}` : ''))

describe('the wheel\'s labels', () => {
  test('a small wheel is drawn as before: the text follows the curve, in full', () => {
    const html = draw(people(NAMES.slice(0, 4)), prizes([['Mug', '🎁'], ['Pizza', '🍕']]))
    assert.match(html, /<textPath[^>]*>Maria Santos<\/textPath>/)
    assert.match(html, /<textPath[^>]*>🍕 Pizza<\/textPath>/)
    assert.doesNotMatch(html, /<tspan/, 'no along-the-slice text on a roomy wheel')
  })

  test('a crowded wheel writes names along the slice, large enough and in two lines, never reduced to initials', () => {
    const html = draw(people(many), prizes([['Starbucks gift card', '☕'], ['Movie tickets', '🎬'], ['Pizza lunch', '🍕'], ['Day off', '🌴']]))
    assert.match(html, /<tspan[^>]*>Maria<\/tspan><tspan[^>]*>Santos<\/tspan>/, 'a name on two lines')
    assert.match(html, /<tspan[^>]*>Starbucks<\/tspan><tspan[^>]*>gift card<\/tspan>|Starbucks gift card/)
    assert.doesNotMatch(html, />MS<|>JR<|>PN</, 'no initials')
    assert.match(html, /<text transform="rotate\(/, 'rotated along the slice')
  })

  test('with ten prizes every prize word is on the wheel and each prize has its own colour', () => {
    const list = [['Starbucks gift card', '☕'], ['Movie tickets', '🎬'], ['Pizza lunch', '🍕'], ['Coffee mug', '🎁'], ['Spa voucher', '💆'], ['Bluetooth speaker', '🔊'], ['Book of choice', '📚'], ['Day off', '🌴'], ['Grocery voucher', '🛒'], ['Grand prize: smartwatch', '⌚']]
    const z = prizes(list)
    const html = draw(people(many), z)
    for (const w of ['Starbucks', 'Movie', 'Pizza', 'Coffee', 'Spa', 'Bluetooth', 'Book', 'Day', 'Grocery', 'Grand']) assert.ok(html.includes(`>${w}`) || html.includes(`${w} `) || html.includes(w), w)
    assert.equal(new Set(z.map((x) => x.color)).size, 10, 'ten different colours')
    for (const x of z) assert.ok(html.includes(`fill="${x.color}"`), x.color)
  })

  test('text along a slice never reads upside down: its direction always has a rightward part, on both halves of the wheel', () => {
    const html = draw(people(many), prizes([['Mug', '🎁']]))
    const rotations = [...html.matchAll(/<text transform="rotate\((-?\d+(?:\.\d+)?) /g)].map((m) => Number(m[1]))
    assert.ok(rotations.length >= 25, 'most of the 40 names are written along their slice')
    for (const r of rotations) assert.ok(Math.cos((r * Math.PI) / 180) > -0.01, `rotation ${r} would read right to left`)
    assert.ok(rotations.some((r) => r < 90), 'the right half reads outwards')
    assert.ok(rotations.some((r) => r > 180), 'the left half is turned round so it reads inwards, the right way up')
  })

  test('an empty wheel and a one-person wheel still draw', () => {
    assert.match(draw([], []), /Add people/)
    assert.match(draw(people(['Solo Person']), prizes([['Only prize', '🎁']])), /Solo Person/)
  })
})

describe('the list of everyone on the wheel', () => {
  const html = renderToStaticMarkup(createElement(WheelWho, { people: people(many), prizes: prizes([['Starbucks gift card', '☕'], ['Mug', '🎁']]) }))

  test('it holds every person and prize in full, with the colour of its slice', () => {
    assert.match(html, /Everyone on the wheel \(40 people, 2 prizes\)/)
    assert.match(html, /Christopher Villanueva-Mendoza/)
    assert.match(html, /☕ Starbucks gift card/)
    assert.match(html, /background:#7f77dd/)
    assert.equal((html.match(/<li>/g) ?? []).length, 42)
  })

  test('it is a closed disclosure, so the wheel stays the star, and each list is labelled', () => {
    assert.match(html, /^<details class="ev-who"><summary>/)
    assert.doesNotMatch(html, /<details[^>]* open/)
    assert.match(html, /aria-label="Prizes"/)
    assert.match(html, /aria-label="People"/)
  })

  test('nothing is drawn for an empty wheel, and singular words are used for one', () => {
    assert.equal(renderToStaticMarkup(createElement(WheelWho, { people: [], prizes: [] })), '')
    assert.match(renderToStaticMarkup(createElement(WheelWho, { people: people(['A']), prizes: prizes([['P', '']]) })), /1 person, 1 prize/)
  })
})

describe('prize colours', () => {
  test('twelve distinct colours, all valid hex, so up to twelve prizes each look different', () => {
    assert.equal(PRIZE_COLORS.length, 12)
    assert.equal(new Set(PRIZE_COLORS).size, 12)
    for (const c of PRIZE_COLORS) assert.match(c, /^#[0-9a-f]{6}$/)
  })

  test('setting up eleven prizes gives eleven different colours', () => {
    const r = cleanSetup({ participants: [], prizes: Array.from({ length: 11 }, (_, i) => ({ name: `Prize ${i}`, qty: 1 })) }, { previous: defaultWheel() })
    assert.equal(new Set(r.value.prizes.map((z) => z.color)).size, 11)
  })
})
