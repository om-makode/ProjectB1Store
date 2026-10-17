// NearKart SQL harness: applies supabase/migrations + seed.sql on PGlite (+PostGIS) with Supabase stubs,
// then runs smoke.sql. Usage: node run.mjs [--no-smoke]
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

// Extensions PGlite can't load are provided by stubs; skip their CREATE EXTENSION lines.
const prep = (sql) => sql
  .replace(/create extension if not exists\s+"?(pg_cron|pg_net|supabase_vault|pgtap|pg_graphql|pg_stat_statements)"?[^;]*;/gi, '/* stubbed ext */;')
  .replace(/^\s*notify\s+pgrst[^;]*;/gim, '/* notify skipped */;')

async function apply(label, sql) {
  try {
    await db.exec('begin;\n' + prep(sql) + '\ncommit;')
    console.log('  ok  ', label)
  } catch (e) {
    await db.exec('rollback;').catch(() => {})
    console.error('  FAIL', label, '\n      ', e.message, e.position ? `(pos ${e.position})` : '', e.where ? '\n       where: ' + e.where : '')
    if (e.position) {
      const s = prep(sql); const p = Number(e.position) - 'begin;\n'.length
      const line = s.slice(0, p).split('\n').length
      console.error('       line', line, ':', s.split('\n').slice(Math.max(0, line - 3), line + 1).join('\n         '))
    }
    process.exit(1)
  }
}

await apply('supabase_stubs.sql', fs.readFileSync(path.join(HERE, 'supabase_stubs.sql'), 'utf8'))
const migs = fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort()
for (const f of migs) await apply(f, fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8'))
await apply('seed.sql', fs.readFileSync(path.join(ROOT, 'seed.sql'), 'utf8'))

if (!process.argv.includes('--no-smoke')) {
  // smoke.sql: statements separated by lines '-- @step <name>'; each step runs in its own transaction
  // unless it starts with '-- @nocommit'. Lines '-- @expect-error <text>' mark steps that must fail.
  const smoke = fs.readFileSync(path.join(HERE, 'smoke.sql'), 'utf8')
  const steps = smoke.split(/^-- @step /m).slice(1)
  let pass = 0, fail = 0
  for (const st of steps) {
    const name = st.split('\n')[0].trim()
    const body = st.slice(st.indexOf('\n') + 1)
    const expectErr = (body.match(/^-- @expect-error (.+)$/m) || [])[1]
    try {
      const res = await db.exec(body)
      await db.exec('reset role; select set_config(\'request.jwt.claims\', \'\', false);')
      if (expectErr) { fail++; console.error('  FAIL', name, '— expected error:', expectErr); continue }
      const last = res.filter(r => r.rows?.length && 'ok' in r.rows[0]).at(-1) ?? res.filter(r => r.rows?.length).at(-1)
      const out = last ? JSON.stringify(last.rows.length === 1 ? last.rows[0] : last.rows).slice(0, 300) : ''
      const bad = res.flatMap(r => r.rows ?? []).find(r => 'ok' in r && r.ok !== true)   // every 'ok' column must be exactly true
      if (bad) { fail++; console.error('  FAIL', name, out) } else { pass++; console.log('  pass', name, out) }
    } catch (e) {
      await db.exec('rollback; reset role; select set_config(\'request.jwt.claims\', \'\', false);').catch(() => {})
      if (expectErr && e.message.toLowerCase().includes(expectErr.toLowerCase())) { pass++; console.log('  pass', name, '(expected error:', e.message + ')') }
      else { fail++; console.error('  FAIL', name, '\n      ', e.message, e.where ? '\n       where: ' + e.where : '') }
    }
  }
  // pgTAP isn't available in PGlite: load the test helpers without the pgTAP lines and exercise them.
  try {
    const helpers = fs.readFileSync(path.join(ROOT, 'tests', '000_setup_helpers.test.sql'), 'utf8')
      .replace(/^select (plan|ok|\* from finish)\(.*$/gm, '')
    await db.exec(prep(helpers))
    await db.exec("update public.stores set is_accepting_orders = true; select tests.create_supabase_user('helper_user');")
    const r = await db.query("select tests.place_test_order('helper_user', 1, 2) as id")
    const n = await db.query(`select count(*)::int as n from public.order_items where order_id = $1`, [r.rows[0].id])
    if (n.rows[0].n === 2 && (await db.query('select current_user as u')).rows[0].u === 'postgres') { pass++; console.log('  pass test helpers: place_test_order → 2 lines, role restored') }
    else { fail++; console.error('  FAIL test helpers', n.rows) }
  } catch (e) { fail++; console.error('  FAIL test helpers\n      ', e.message) }
  console.log(`\nsmoke: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
