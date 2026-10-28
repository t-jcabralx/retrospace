import { MongoClient } from 'mongodb'
import { Redis } from '@upstash/redis'

// Credentials come from environment variables (.env.local locally, project settings in production). Never hard-code them.
export const dbName = () => process.env.MONGODB_DB || 'retrospace'

const connectMongo = (uri) => new MongoClient(uri, { serverSelectionTimeoutMS: 6000 }).connect()

// `connect` is injectable for tests. A failed connect is not cached, so the next call retries.
export function getMongo(connect = connectMongo) {
  if (!process.env.MONGODB_URI) return null
  if (!globalThis._kmMongo) {
    const p = connect(process.env.MONGODB_URI)
    globalThis._kmMongo = p
    p.catch(() => { if (globalThis._kmMongo === p) globalThis._kmMongo = undefined })
  }
  return globalThis._kmMongo
}

export function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
}
