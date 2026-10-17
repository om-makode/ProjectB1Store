// Runs the pgTAP files that need no psql meta-commands against PGlite, using pgtap_shim.sql.
// Usage: node run_tests.mjs   (applies migrations + seed first, like `supabase db reset`)
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { postgis } from '@electric-sql/pglite-postgis'
const ROOT = process.env.NEARKART_SUPABASE ?? path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '../../supabase')
const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname))
const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto, uuid_ossp, postgis } })
const prep = (sql) => sql
  .replace(/create extension if not exists\s+"?(pg_cron|pg_net|supabase_vault|pgtap)"?[^;]*;/gi, '/* stubbed */;')
  .replace(/^\s*notify\s+pgrst[^;]*;/gim, '')
for (const f of ['supabase_stubs.sql', 'pgtap_shim.sql']) await db.exec(fs.readFileSync(path.join(HERE, f), 'utf8'))
for (const f of fs.readdirSync(path.join(ROOT, 'migrations')).sort()) await db.exec(prep(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')))
await db.exec(prep(fs.readFileSync(path.join(ROOT, 'seed.sql'), 'utf8')))
let total = 0, failed = 0
for (const f of fs.readdirSync(path.join(ROOT, 'tests')).sort()) {
  const sql = fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8')
  if (/\\(gset|ir|set)\b/.test(sql)) { console.log('  skip', f, '(psql meta-commands: run with `supabase test db`)'); continue }
  await db.exec('truncate tap.results')
  const body = prep(sql).replace(/^\s*rollback;\s*$/m, '')          // read results first, then roll back
  let r
  try {
    await db.exec(body)
    await db.exec("reset role; select set_config('request.jwt.claims', '', false);")
    r = (await db.query('select * from tap.results order by n')).rows
  } catch (e) { await db.exec('rollback').catch(() => {}); failed++; console.error('  ERROR', f, e.message); continue }
  if (/^\s*begin;/m.test(sql)) await db.exec('rollback')
  const bad = r.filter(x => !x.ok)
  total += r.length; failed += bad.length
  console.log(`  ${bad.length ? 'FAIL' : 'ok  '} ${f}: ${r.length - bad.length}/${r.length}`)
  for (const b of bad) console.error('        not ok -', b.description, '|', b.detail)
}
console.log(`\npgTAP (shim): ${total - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
