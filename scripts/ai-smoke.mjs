// One real summary call with five invented notes (no personal data), to check the key, the model and the answer.
//   ANTHROPIC_API_KEY=... node scripts/ai-smoke.mjs
//   AI_FAKE=1 node scripts/ai-smoke.mjs        (the development fake: no network)
// Prints the model, the outcome, the length, the token counts, the time and the first 120 characters of the summary.
// Never prints the key or the whole text. Exits 2 when there is no provider, 1 when the call failed.
import { getProvider, providerInfo } from '../src/lib/ai/provider.js'
import { buildSummaryInput } from '../src/lib/ai/input.js'

const frame = (id, x, title) => ({ id, kind: 'frame', x, y: 140, w: 360, h: 640, data: { title } })
const note = (id, x, text, votes = []) => ({ id, kind: 'note', x, y: 200, w: 200, h: 120, votes, updatedAt: 1, data: { text } })
const items = [
  frame('f1', 0, '✅ Went Well'), frame('f2', 384, '⚠️ Could Be Improved'), frame('f3', 768, '🚧 Blockers'), frame('f4', 1152, '💡 Ideas'),
  note('n1', 20, 'Pairing on the checkout bug saved a day', ['a', 'b', 'c']),
  note('n2', 404, 'Standups run long and drift off topic'),
  note('n3', 788, 'Staging environment was down for two days'),
  note('n4', 1172, 'Try a rotating facilitator for standups', ['a']),
  note('n5', 40, 'Release went out without a hitch'),
]

const provider = getProvider()
if (!provider) {
  console.error('ANTHROPIC_API_KEY not set')
  process.exit(2)
}

const input = buildSummaryInput(items, { kind: 'retro', boardTitle: 'Sprint retrospective' })
const started = Date.now()
const result = await provider.summarize(input, { kind: 'retro' })
const ms = Date.now() - started

console.log(`model: ${providerInfo().model}`)
console.log(`outcome: ${result.error ? `error (${result.error})` : 'ok'}`)
if (result.error) process.exit(1)
console.log(`characters: ${result.text.length}`)
if (result.inputTokens != null) console.log(`tokens: ${result.inputTokens} in / ${result.outputTokens} out`)
console.log(`elapsed: ${ms} ms`)
console.log(`first 120 characters: ${JSON.stringify(result.text.slice(0, 120))}`)
