import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { postgis } from '@electric-sql/pglite-postgis'
const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto, postgis } })
await db.exec(`create schema extensions; create extension postgis with schema extensions; create extension pg_trgm with schema extensions; create extension unaccent with schema extensions; create extension pgcrypto with schema extensions;`)
console.log((await db.query(`select version(), extensions.st_distance(extensions.st_makepoint(77.75,20.93)::extensions.geography, extensions.st_makepoint(77.76,20.94)::extensions.geography) d`)).rows)
console.log((await db.query(`select current_user, (select rolsuper from pg_roles where rolname=current_user)`)).rows)
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant anon, authenticated, service_role to postgres;`)
console.log('roles ok')
