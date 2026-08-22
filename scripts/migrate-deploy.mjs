/**
 * Applies pending migrations as part of the build.
 *
 * Without this, a deployment can succeed against a database that has no tables, and the first
 * request fails with `P2021: The table public.Invoice does not exist`. Running `prisma migrate
 * deploy` here means a deployment either brings the database to the committed migration state or
 * fails — it never ships an app whose schema is missing.
 *
 * `migrate deploy` only ever applies committed migrations, never generates or resets anything, and
 * is a no-op when the database is already up to date. It takes an advisory lock, so concurrent
 * builds serialise rather than racing.
 *
 * When DATABASE_URL is absent the migration step is skipped rather than failing, so a build that
 * legitimately has no database (a preview environment without the variable, or a local
 * `next build` for typechecking) still works. Production has the variable, so the step runs there.
 */
import { spawnSync } from 'node:child_process'

const url = process.env.DATABASE_URL?.trim()

if (!url) {
  console.warn(
    '\n[migrate-deploy] DATABASE_URL is not set — skipping `prisma migrate deploy`.\n' +
      '[migrate-deploy] The build will succeed, but any environment serving requests needs the\n' +
      '[migrate-deploy] variable set and its migrations applied, or queries fail with P2021.\n',
  )
  process.exit(0)
}

// Never log the connection string; host/database come from Prisma's own output below.
console.log('[migrate-deploy] applying pending migrations')

const result = spawnSync('prisma', ['migrate', 'deploy'], { stdio: 'inherit', shell: false })

if (result.error) {
  console.error(`[migrate-deploy] could not run the Prisma CLI: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(
    '\n[migrate-deploy] migrations failed — failing the build rather than deploying an app\n' +
      '[migrate-deploy] whose database schema is missing or behind.\n',
  )
  process.exit(result.status ?? 1)
}
