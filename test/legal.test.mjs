import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PRIVACY, TERMS } from '../src/ui/legal/legalData.js'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')
const text = (rows) => rows.map(([h, ps]) => `${h}\n${ps.join('\n')}`).join('\n')

test('the privacy page names every cookie, every other company that handles data, and how to delete', () => {
  const t = text(PRIVACY)
  for (const word of ['rs_session', 'rs_g', 'rs_a_', 'Vercel', 'MongoDB', 'Upstash', 'Google Fonts', 'Giphy', 'Anthropic', 'delete', 'Anonymous notes', 'Encryption']) assert.ok(t.includes(word), word)
})

test('the privacy page matches the code: the cookies it lists are the ones the app sets', async () => {
  const code = (await Promise.all(['src/lib/auth.js', 'src/lib/guest.js', 'src/lib/access.js'].map(read))).join('\n')
  for (const name of ['rs_session', 'rs_g', 'rs_a_']) assert.ok(code.includes(name), name)
})

test('the terms cover content, acceptable use, AI output, raffles and ownership', () => {
  const t = text(TERMS)
  for (const word of ['Your content', 'What not to do', 'AI summaries', 'Raffles', 'Jason Cabral']) assert.ok(t.includes(word), word)
})

test('both pages exist, are linked from the footer, and each links to the other', async () => {
  for (const [file, other] of [['src/app/privacy/page.js', '/terms'], ['src/app/terms/page.js', '/privacy']]) {
    const page = await read(file)
    assert.ok(page.includes(`href: '${other}'`), file)
    assert.match(page, /export const metadata/)
  }
  const nav = await read('src/ui/site/FooterNav.jsx')
  assert.ok(nav.includes('href="/privacy"') && nav.includes('href="/terms"'))
})
