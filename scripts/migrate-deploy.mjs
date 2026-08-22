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
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Loads the same env files `next build` does, in the same precedence order.
 *
 * This step runs as its own process before Next starts, so without this a local build would skip
 * migrations while a Vercel build (where the variable is real process env) applied them — the two
 * behaving differently is exactly the kind of gap that hides a broken deploy.
 *
 * Real environment variables always win, and nothing is ever printed.
 */
function loadEnvFiles() {
  const root = path.join(import.meta.dirname, '..')
  for (const file of ['.env.local', '.env']) {
    const full = path.join(root, file)
    if (!existsSync(full)) continue
    for (const line of readFileSync(full, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key] !== undefined) continue
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '')
    }
  }
}

loadEnvFiles()

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

// Captured rather than inherited so P3005 can be turned into an actionable message; the raw
// output is echoed unchanged either way.
const result = spawnSync('prisma', ['migrate', 'deploy'], { encoding: 'utf8', shell: false })

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
if (output.trim()) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)

if (result.error) {
  console.error(`[migrate-deploy] could not run the Prisma CLI: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  // P3005: the database has tables but no migration history — typically because it was created
  // with `prisma db push`. Deploy refuses, correctly, rather than guessing what is already applied.
  if (output.includes('P3005')) {
    console.error(
      '\n[migrate-deploy] This database has a schema but no migration history (P3005), which\n' +
        '[migrate-deploy] happens when it was created with `prisma db push` instead of migrations.\n' +
        '[migrate-deploy] Baseline it once — this records the already-applied migration without\n' +
        '[migrate-deploy] touching any data — then redeploy:\n' +
        '[migrate-deploy]\n' +
        '[migrate-deploy]   DATABASE_URL="<your url>" npm run db:baseline\n' +
        '[migrate-deploy]\n',
    )
  }

  console.error(
    '[migrate-deploy] migrations failed — failing the build rather than deploying an app\n' +
      '[migrate-deploy] whose database schema is missing or behind.\n',
  )
  process.exit(result.status ?? 1)
}
