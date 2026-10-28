import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/ui/board.css', import.meta.url), 'utf8')
const block = (re) => css.match(re)?.[0] ?? ''

test('.bd-top can shrink: min-width 0 on the bar, an ellipsizing title', () => {
  assert.match(block(/\n\.bd-top \{[^}]*\}/), /min-width:\s*0/)
  assert.match(block(/\n\.bd-title \{[^}]*\}/), /min-width:\s*0[^}]*text-overflow:\s*ellipsis/)
})

test('at 480px and below the top bar wraps instead of overflowing, with 44px controls and a shrinking title', () => {
  const phone = block(/@media \(max-width: 480px\) \{[\s\S]*?\n\}/)
  assert.match(phone, /\.bd-top \{[^}]*flex-wrap:\s*wrap/)
  assert.match(phone, /\.bd-title \{[^}]*flex:\s*1 1 64px[^}]*min-width:\s*0/)
  assert.match(phone, /\.bd-iconbtn[^{]*\{[^}]*min-height:\s*44px/)
  assert.match(phone, /height:\s*auto/)
})
