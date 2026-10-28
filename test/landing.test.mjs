import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')
const landingFiles = async () => (await readdir(new URL('../src/ui/landing/', import.meta.url))).filter((f) => f.endsWith('.jsx'))

test('the landing copy follows the brief: the four board types, no hype or invented proof', async () => {
  const all = (await Promise.all((await landingFiles()).map((f) => read(`src/ui/landing/${f}`)))).join('\n')
  for (const needle of ['Workshop canvas', 'Celebration board', 'Retro board', 'Went Well / Could Be Improved / Blockers / Ideas', 'Start / Stop / Continue', 'Mad / Sad / Glad', 'Join with code']) {
    assert.ok(all.includes(needle), needle)
  }
  assert.doesNotMatch(all, /revolutionary|game-changing|testimonial|trusted by|\d+%|customers/i)
  const hero = await read('src/ui/landing/Hero.jsx')
  assert.match(hero, /Retrospectives, workshops and celebrations your whole team can join in seconds/)
  assert.equal((hero.match(/<h1/g) || []).length, 1)
})

test('the landing page is a static server component built from separate section components', async () => {
  const page = await read('src/app/page.js')
  assert.doesNotMatch(page, /'use client'|getStore|cookies\(|headers\(/)
  for (const part of ['Hero', 'BoardTypes', 'Features', 'HowItWorks', 'ClosingCta']) assert.match(page, new RegExp(`<${part} />`))
  assert.match(page, /<PageShell landing>/)
})

test('layout metadata: title template, description, Open Graph and Twitter text tags, light and dark theme colours', async () => {
  const layout = await read('src/app/layout.js')
  assert.match(layout, /Retrospace \\u2014 retrospectives, workshops and celebrations|Retrospace — retrospectives, workshops and celebrations/)
  for (const key of ['template:', 'openGraph:', 'twitter:', 'themeColor:', 'prefers-color-scheme: light', 'prefers-color-scheme: dark']) assert.ok(layout.includes(key), key)
  assert.doesNotMatch(layout, /images:|summary_large_image/)
  assert.match(layout, /<html lang="en"/)
  assert.match(await read('src/app/icon.svg'), /<svg[\s\S]*#5b5bf0/)
})

test('pages that are signed-in only or form-driven are wired to the shared shell and helpers', async () => {
  assert.match(await read('src/app/login/page.js'), /mode="login" next=\{next\}/)
  assert.match(await read('src/app/register/page.js'), /mode="register" next=\{next\}/)
  assert.match(await read('src/app/join/page.js'), /variant="page"/)
  assert.match(await read('src/app/boards/page.js'), /<Dashboard \/>/)
  const form = await read('src/ui/auth/AuthForm.jsx')
  assert.match(form, /safeNext\(next\)/)
  for (const attr of ['autoComplete="name"', 'autoComplete="email"', "'new-password' : 'current-password'"]) assert.ok(form.includes(attr), attr)
  const join = await read('src/ui/landing/JoinBox.jsx')
  for (const attr of ['autoCapitalize="characters"', 'inputMode="text"', 'Access code', 'role="alert"']) assert.ok(join.includes(attr), attr)
})

test('no source file grows past the size budget', async () => {
  const dirs = ['src/ui/landing', 'src/ui/site', 'src/ui/auth', 'src/ui/boards']
  for (const d of dirs) {
    for (const f of await readdir(new URL(`../${d}/`, import.meta.url))) {
      const lines = (await read(`${d}/${f}`)).split('\n').length
      assert.ok(lines <= 350, `${d}/${f} has ${lines} lines`)
    }
  }
})

test('the Retro card is live and claims only what exists: templates, voting, timer, an owner-reviewed AI summary', async () => {
  const types = await read('src/ui/landing/BoardTypes.jsx')
  assert.doesNotMatch(types, /coming soon|soon:/i)
  assert.match(types, /Went Well \/ Could Be Improved \/ Blockers \/ Ideas, Start \/ Stop \/ Continue and Mad \/ Sad \/ Glad templates, voting, a shared timer and an optional AI-written summary you review before sharing/)
  const readme = await read('README.md')
  // landing files only: the README's Status section lists the not-yet-built features on purpose
  const all = (await Promise.all((await landingFiles()).map((f) => read(`src/ui/landing/${f}`)))).join('\n')
  // nothing that is not built: AI grouping or clustering, action tracking, exports
  assert.doesNotMatch(all, /\bcluster|action (items|tracking)|track actions|\bcsv\b|\bpdf\b|\bexport(s|ed)? (the|your|to)|AI (theme )?grouping (is|are|available)/i)
  assert.doesNotMatch(readme, /export the result as a PNG|team walls/)
})

test('the Team wall card exists and claims only what is built: shout-outs, badges, mentions, GIFs, reactions, milestone banner', async () => {
  const types = await read('src/ui/landing/BoardTypes.jsx')
  assert.match(types, /title: 'Team wall'/)
  const card = types.slice(types.indexOf("key: 'wall'"), types.indexOf('export default'))
  assert.match(card, /shout-outs with badges/)
  assert.match(card, /@mention/)
  assert.match(card, /react with emoji/)
  assert.match(card, /Birthdays and work anniversaries/)
  assert.doesNotMatch(card, /coming soon|leaderboard|points|rewards|integrat|slack|teams\b|export/i)
})
