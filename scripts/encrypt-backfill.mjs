// Encrypts the records that were saved before encryption was switched on (or decrypts them again).
//
//   node --env-file=.env.local scripts/encrypt-backfill.mjs                      # dry run: counts only, writes nothing
//   node --env-file=.env.local scripts/encrypt-backfill.mjs --apply --yes-i-have-a-backup
//   node --env-file=.env.local scripts/encrypt-backfill.mjs --decrypt --apply --yes-i-have-a-backup   # undo
//
// Needs MONGODB_URI, MONGODB_DB and DATA_ENCRYPTION_KEY in the environment (the same values the site uses). Safe to stop and
// run again: records already done are skipped, and a record that changes while it runs is left for the next run.
import { MongoClient } from 'mongodb'
import { sealConfig } from '../src/lib/seal.js'
import { backfill } from '../src/lib/sealBackfill.js'
import { envValue, dbName } from '../src/lib/db.js'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const mode = args.has('--decrypt') ? 'decrypt' : 'encrypt'
const uri = envValue('MONGODB_URI')
if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1) }
if (apply && !args.has('--yes-i-have-a-backup')) { console.error('Refusing to write without --yes-i-have-a-backup. Take a database backup first (Atlas: Backup, or mongodump), then add the flag.'); process.exit(1) }

const cfg = sealConfig()
if (!cfg.configured) { console.error('DATA_ENCRYPTION_KEY is not set.'); process.exit(1) }

const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 8000 }).connect()
try {
  const db = client.db(dbName())
  console.log(`${apply ? 'APPLYING' : 'Dry run (nothing is written)'}: ${mode} the records in database "${dbName()}"`)
  const report = await backfill(db, cfg, { apply, mode, onProgress: (p) => p.error && console.error(`  ! ${p.name} ${p.id}: ${p.error}`) })
  console.table(report)
  const left = Object.values(report).reduce((n, r) => n + (mode === 'encrypt' ? r.plain + r.mixed : r.sealed + r.mixed), 0)
  const failed = Object.values(report).reduce((n, r) => n + r.failed, 0)
  if (!apply) console.log(`Would change ${Object.values(report).reduce((n, r) => n + r.changed, 0)} record(s). Run again with --apply --yes-i-have-a-backup to do it.`)
  else console.log(left ? `${left} record(s) still to do (skipped because they changed meanwhile, or failed). Run it again.` : 'All done.')
  if (failed) { console.error(`${failed} record(s) could not be verified and were left untouched.`); process.exitCode = 2 }
} finally {
  await client.close()
}
