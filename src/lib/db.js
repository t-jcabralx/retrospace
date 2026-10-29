import { MongoClient } from 'mongodb'
import { Redis } from '@upstash/redis'

// A setting as the host stored it, minus the mistakes people make pasting a .env line into a dashboard: surrounding spaces and
// matching quotes (KEY="value" is kept literally by most dashboards, which breaks a URL or a token). Empty -> ''.
export function envValue(name, env = process.env) {
  let v = String(env[name] ?? '').trim()
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1).trim()
  return v
}

// The names of settings whose stored value has stray quotes or spaces (only the names are ever reported).
export const messyEnv = (names, env = process.env) => names.filter((n) => env[n] !== undefined && env[n] !== '' && envValue(n, env) !== env[n])

// { url, token } for Upstash Redis, cleaned (no trailing slash), or null when it is not configured.
export function upstashConfig(env = process.env) {
  const url = envValue('UPSTASH_REDIS_REST_URL', env).replace(/\/+$/, '')
  const token = envValue('UPSTASH_REDIS_REST_TOKEN', env)
  return url && token ? { url, token } : null
}

// Credentials come from environment variables (.env.local locally, project settings in production). Never hard-code them.
export const dbName = () => envValue('MONGODB_DB') || 'retrospace'

const connectMongo = (uri) => new MongoClient(uri, { serverSelectionTimeoutMS: 6000 }).connect()

// `connect` is injectable for tests. A failed connect is not cached, so the next call retries.
export function getMongo(connect = connectMongo) {
  const uri = envValue('MONGODB_URI')
  if (!uri) return null
  if (!globalThis._kmMongo) {
    const p = connect(uri)
    globalThis._kmMongo = p
    p.catch(() => { if (globalThis._kmMongo === p) globalThis._kmMongo = undefined })
  }
  return globalThis._kmMongo
}

export function getRedis() {
  const cfg = upstashConfig()
  return cfg ? new Redis(cfg) : null
}
