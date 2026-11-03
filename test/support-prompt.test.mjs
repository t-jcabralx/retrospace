import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { register } from 'node:module'
import { promptReason, shouldShow, markSeen, optOut, pickGif, gifUrl, SUPPORT_GIFS, SHOW_DELAY_MS } from '../src/lib/supportPrompt.js'
import { defaultRetro, STAGE_KEYS } from '../src/lib/retro.js'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: SupportModal } = await import('../src/ui/SupportModal.jsx')

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m } }
const retro = (stage) => ({ type: 'retro', status: 'open', retro: { ...defaultRetro(), current: STAGE_KEYS.indexOf(stage) } })
const css = await readFile(new URL('../src/ui/support-modal.css', import.meta.url), 'utf8')

describe('when the pop-up is due', () => {
  test('a retro on its last stage, or any closed board; nothing before that', () => {
    assert.equal(promptReason(retro('wrapup')), 'review-end')
    for (const stage of ['join', 'collect', 'group', 'vote', 'discuss', 'actions']) assert.equal(promptReason(retro(stage)), null, stage)
    assert.equal(promptReason({ type: 'workshop', status: 'closed' }), 'closed')
    assert.equal(promptReason({ ...retro('collect'), status: 'closed' }), 'closed')
    assert.equal(promptReason({ type: 'workshop', status: 'open' }), null)
    assert.equal(promptReason(null), null)
    assert.equal(promptReason(undefined), null)
  })

  test('it shows once for each board in a browser, and never again after "don\'t show this again"', () => {
    const storage = memory()
    const board = retro('wrapup')
    assert.equal(shouldShow({ board, code: 'AAA111', storage }), true)
    markSeen('AAA111', storage)
    assert.equal(shouldShow({ board, code: 'AAA111', storage }), false, 'seen on this board')
    assert.equal(shouldShow({ board, code: 'BBB222', storage }), true, 'another board is new')
    optOut(storage)
    assert.equal(shouldShow({ board, code: 'BBB222', storage }), false, 'opted out everywhere')
  })

  test('not before the end, not without a board code, and storage that throws or is missing never breaks it', () => {
    assert.equal(shouldShow({ board: retro('collect'), code: 'AAA111', storage: memory() }), false)
    assert.equal(shouldShow({ board: retro('wrapup'), code: '', storage: memory() }), false)
    assert.equal(shouldShow({ board: retro('wrapup'), code: 'AAA111', storage: null }), true)
    const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    assert.equal(shouldShow({ board: retro('wrapup'), code: 'AAA111', storage: broken }), true)
    assert.doesNotThrow(() => { markSeen('AAA111', broken); optOut(broken) })
  })

  test('it waits a moment, and the GIFs are Giphy links for the listed ids', () => {
    assert.ok(SHOW_DELAY_MS >= 1000 && SHOW_DELAY_MS <= 3000)
    assert.equal(gifUrl('abc'), 'https://media.giphy.com/media/abc/200.gif')
    assert.ok(SUPPORT_GIFS.length >= 3 && SUPPORT_GIFS.every((id) => /^[A-Za-z0-9]{6,24}$/.test(id)))
    assert.equal(pickGif(() => 0), SUPPORT_GIFS[0])
    assert.equal(pickGif(() => 0.999999), SUPPORT_GIFS.at(-1))
    assert.equal(pickGif(() => 1), SUPPORT_GIFS.at(-1), 'never past the end')
  })
})

describe('the pop-up itself', () => {
  const html = renderToStaticMarkup(createElement(SupportModal, { onClose() {}, onNever() {}, gif: 'ffzhLUixCtlsc' }))

  test('it is a labelled modal dialog with the GIF, the QR, a way to save the QR and the ways out', () => {
    assert.match(html, /role="dialog"/)
    assert.match(html, /aria-modal="true"/)
    assert.match(html, /aria-labelledby="[^"]+"/)
    assert.match(html, /Please support Retrospace/)
    assert.match(html, /src="https:\/\/media\.giphy\.com\/media\/ffzhLUixCtlsc\/200\.gif"/)
    assert.match(html, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i)
    assert.match(html, /src="\/support\/payment-qr\.jpg"/)
    assert.match(html, /download="retrospace-support-qr\.jpg"/)
    assert.match(html, /href="\/support"[^>]*target="_blank"/)
    assert.match(html, /Maybe later/)
    assert.doesNotMatch(html, /data-autofocus/, 'focus starts on the close button at the top, so the sheet is not scrolled down on open')
    assert.match(html, /show this again/)
    assert.match(html, /aria-label="Close"/)
    assert.match(html, /entirely optional/)
  })

  test('the GIF is decoration (empty alt), so the dialog still reads fine when it does not load', () => {
    assert.match(html, /<img class="sm-gif"[^>]*alt=""/)
  })

  test('it adapts: a bottom sheet first, a centred dialog from 600px, two columns from 860px, safe areas, short screens and reduced motion', () => {
    assert.match(css, /\.sm-dialog\s*\{[^}]*bottom: 0/)
    assert.match(css, /max-height: 92dvh/)
    assert.match(css, /env\(safe-area-inset-bottom\)/)
    assert.match(css, /@media \(min-width: 600px\)/)
    assert.match(css, /@media \(min-width: 860px\)/)
    assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 280px/)
    assert.match(css, /@media \(max-height: 520px\)/)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
    assert.match(css, /\.sm-card \{[^}]*background: #fff/, 'the QR keeps a white card in dark mode')
  })
})

test('the board screen shows it, once the board is ready, through the hook', async () => {
  const screen = await readFile(new URL('../src/ui/BoardScreen.jsx', import.meta.url), 'utf8')
  assert.match(screen, /useSupportPrompt\(board, code, phase === 'ready'\)/)
  assert.match(screen, /support\.open && <SupportModal onClose=\{support\.close\} onNever=\{support\.never\} \/>/)
})
