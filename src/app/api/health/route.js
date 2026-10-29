import { getRedis, getMongo, envValue, messyEnv, upstashConfig } from '../../../lib/db.js'
import { json } from '../../../lib/http.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NAMES = ['MONGODB_URI', 'MONGODB_DB', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RT_SECRET', 'ANTHROPIC_API_KEY', 'NEXT_PUBLIC_GIPHY_API_KEY', 'NEXT_PUBLIC_SITE_URL', 'DATA_ENCRYPTION_KEY']
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

// What is set and what answers, never a value: for checking a new deployment (open /api/health). The settings that carry
// stray quotes or spaces are listed by name; the app strips them, but fixing them in the dashboard is cleaner.
export async function GET() {
  const set = Object.fromEntries(NAMES.map((n) => [n, envValue(n) !== '']))
  const out = { ok: true, settings: set, tidy: messyEnv(NAMES), realtime: { configured: Boolean(upstashConfig()) }, database: { configured: set.MONGODB_URI }, encryption: { configured: set.DATA_ENCRYPTION_KEY } }

  // Enough to tell two configurations apart without revealing either: the host of the URL and how long the token is.
  const up = upstashConfig()
  if (up) { try { out.realtime.host = new URL(up.url).host } catch { out.realtime.host = 'not a valid URL' } out.realtime.tokenLength = up.token.length }
  out.deployment = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null // which commit is running
  const redis = getRedis()
  if (redis) {
    const t = Date.now()
    try { await within(redis.ping(), 4000); out.realtime.ping = 'ok'; out.realtime.ms = Date.now() - t } catch (e) { out.realtime.ping = 'failed'; out.realtime.error = String(e?.message ?? e).slice(0, 80); out.ok = false }
  }
  const mongo = getMongo()
  if (mongo) {
    const t = Date.now()
    try { const c = await within(mongo, 6000); await within(c.db('admin').command({ ping: 1 }), 4000); out.database.ping = 'ok'; out.database.ms = Date.now() - t } catch (e) { out.database.ping = 'failed'; out.database.error = String(e?.name ?? 'error').slice(0, 60); out.ok = false }
  }
  if (!set.RT_SECRET && process.env.NODE_ENV === 'production') out.ok = false // boards cannot be created without it
  return json(out, out.ok ? 200 : 503)
}
