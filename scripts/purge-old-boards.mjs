// Deletes boards nobody has touched for a while (and everything on them). A dry run unless told otherwise.
//
//   node --env-file=.env.local scripts/purge-old-boards.mjs --days 365
//   node --env-file=.env.local scripts/purge-old-boards.mjs --days 365 --apply --yes-i-have-a-backup
//
// "Touched" is the board's last activity (an edit, a new note, a settings change). Needs MONGODB_URI and MONGODB_DB.
import { MongoClient } from 'mongodb'
import { createMongoStore } from '../src/lib/store.js'
import { envValue, dbName } from '../src/lib/db.js'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const days = Number(argv[argv.indexOf('--days') + 1])
const apply = flag('--apply')
const uri = envValue('MONGODB_URI')
if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1) }
if (!Number.isFinite(days) || days < 30) { console.error('Give --days with at least 30, for example --days 365.'); process.exit(1) }
if (apply && !flag('--yes-i-have-a-backup')) { console.error('Refusing to delete without --yes-i-have-a-backup. Take a database backup first, then add the flag.'); process.exit(1) }

const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 8000 }).connect()
try {
  const cutoff = Date.now() - days * 86_400_000
  const old = await client.db(dbName()).collection('boards').find({ updatedAt: { $lt: cutoff } }, { projection: { _id: 0, code: 1, type: 1, updatedAt: 1 } }).toArray()
  console.log(`${apply ? 'DELETING' : 'Dry run'}: ${old.length} board(s) in "${dbName()}" with no activity for ${days} days (since ${new Date(cutoff).toISOString().slice(0, 10)}).`)
  const byType = {}
  for (const b of old) byType[b.type] = (byType[b.type] ?? 0) + 1
  console.table(byType)
  if (apply) {
    const store = createMongoStore(client, dbName())
    for (const b of old) await store.deleteBoard(b.code)
    console.log(`Deleted ${old.length} board(s).`)
  } else if (old.length) console.log('Run again with --apply --yes-i-have-a-backup to delete them.')
} finally {
  await client.close()
}
