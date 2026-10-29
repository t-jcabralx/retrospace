import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('the /b/[code] server page does no store lookup: it validates the code shape only', async () => {
  const src = await read('src/app/b/[code]/page.js')
  assert.doesNotMatch(src, /lib\/store|getStore|getBoard/, 'a 404 vs 200 from the page would be an unmetered existence oracle')
  assert.match(src, /isCode\(code\)/)
  assert.match(src, /notFound\(\)/)
  assert.match(src, /<BoardScreen code=\{code\} viewOnly=\{view === '1'\} \/>/)
})

test('a missing board is still reported by the client through the metered API, with the not-found panel', async () => {
  const hook = await read('src/ui/useBoard.js')
  assert.match(hook, /res\.status === 404\) return \{ missing: true \}/)
  assert.match(hook, /setPhase\('missing'\)/)
  const screen = await read('src/ui/BoardScreen.jsx')
  assert.match(screen, /phase === 'missing'[\s\S]*NotFoundCard[\s\S]*find that board/)
})

test('the /b/[code]/reveal server page also does no store lookup and keeps the code out of search indexes', async () => {
  const src = await read('src/app/b/[code]/reveal/page.js')
  assert.doesNotMatch(src, /lib\/store|getStore|getBoard/)
  assert.match(src, /isCode\(code\)/)
  assert.match(src, /notFound\(\)/)
  assert.match(src, /BOARD_ROBOTS/)
  assert.match(src, /<Reveal code=\{code\} \/>/)
})
