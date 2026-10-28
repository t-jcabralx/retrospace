// The AI provider the app talks to: { summarize(input, { kind }), suggestThemes(input) } -> { text, model } | { error }. Swapping the provider
// means returning a different object here. Server only.
import { anthropicProvider, modelName } from './anthropic.js'
import { fakeThemes } from './themes.js'

// A canned answer for development and browser checks (AI_FAKE=1). It is never available in production, and it never
// makes a network call. The short wait lets the UI show its "writing" state.
const fakeProvider = {
  name: 'fake',
  async summarize(input) {
    await new Promise((r) => setTimeout(r, Number(process.env.AI_FAKE_DELAY_MS) || 1200))
    const text = typeof input === 'string' ? input : input?.text ?? ''
    const columns = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    const lines = [
      'What went well:',
      '- (Sample summary from the development fake, not written by an AI.)',
      '',
      'Key takeaways:',
      `- ${typeof input === 'object' && input ? input.count : 0} items were read${columns.length ? ` across: ${columns.join(', ')}` : ''}.`,
    ]
    return { text: lines.join('\n'), model: 'fake' }
  },
  // Deterministic: one theme per column, answered as the JSON the real model is asked for.
  async suggestThemes(input) {
    await new Promise((r) => setTimeout(r, Number(process.env.AI_FAKE_DELAY_MS) || 1200))
    return { text: JSON.stringify(fakeThemes(typeof input === 'string' ? input : input?.text ?? '')), model: 'fake' }
  },
}

export function getProvider(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return anthropicProvider
  if (env.AI_FAKE === '1' && env.NODE_ENV !== 'production') return fakeProvider
  return null
}

// What the owner's settings may know: whether summaries can be written on this server, and with which model. The key never leaves.
export function providerInfo(env = process.env) {
  const p = getProvider(env)
  return { configured: Boolean(p), model: p?.name === 'fake' ? 'fake (development)' : modelName(env) }
}
