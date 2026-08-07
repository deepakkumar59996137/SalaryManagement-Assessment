# Deployment

The application is a single Node process with a SQLite file beside it. There is
no database server to provision and nothing to configure beyond one environment
variable.

## What `boot.ts` does

Production start is `npm run boot && npm start`. The boot step:

1. Creates the database directory if it does not exist.
2. Applies any pending migrations.
3. Counts employees. **If there are none, it runs the deterministic seed.** If
   there are any, it leaves the database completely alone.

That third step is what makes the same configuration work for both a throwaway
demo and a durable deployment. On an ephemeral filesystem it rebuilds a
known-good 10,000-employee dataset on every cold start; on a mounted volume it
does nothing after the first boot.

## Railway (the current deployment)

Railway runs the whole application as one container from the [`Dockerfile`](../Dockerfile),
with a volume so the database survives restarts. [`railway.json`](../railway.json)
pins the builder, the health check and — importantly — a single replica.

**One replica is not a default worth changing.** SQLite allows one writer, and a
Railway volume attaches to one instance, so a second replica would either fail to
start or corrupt state.

From the Railway dashboard:

1. **New Project → Deploy from GitHub repo**, pick this repository. Railway reads
   `railway.json`, sees the Dockerfile, and starts building.
2. **Attach a volume.** This is done from the **project canvas**, not from the
   service settings: right-click empty canvas space (or press `Ctrl/⌘ + K` and
   type `volume`), choose the volume option, and select this service. Only once
   a volume is attached does a **Volumes** section appear under
   **service → Settings** — set its mount path to **`/data`** there.
3. **Variables**, add `DATABASE_PATH=/data/acme-salary.db`. The Dockerfile already
   defaults to this, so it is belt-and-braces, but being explicit means the value
   is visible in the dashboard rather than buried in an image.
4. **Settings → Networking → Generate Domain** for a public URL.
5. **Redeploy**, then restart once and confirm the logs say
   *"Database already holds 10,000 employees — leaving it alone."* That message
   is the proof the volume is persisting; without it the data is living in the
   container filesystem and will vanish on the next restart.

`PORT` is injected by Railway and read at runtime; nothing needs setting for it.

Two details that cost time if unknown:

- **`/data` must be absolute, and is.** Railway places application files under
  `/app`, so a service writing to a *relative* `./data` would need the volume
  mounted at `/app/data`. `DATABASE_PATH` here is an absolute `/data/...`, so
  `/data` is the correct mount point.
- **Volumes mount at container start, not during build.** The seed runs from the
  `CMD`, not from a build step, so it lands on the volume rather than being
  baked into the image.

Attaching the volume after the first deploy is harmless: the empty volume
replaces `/data`, the next boot finds no employees and re-seeds. Nothing is lost,
because the seed is deterministic and produces the identical dataset.

Free-plan limits are 0.5 GB and one volume per project; the database is ~7 MB.

### Cost

Railway has no perpetual free tier. A new account gets a **one-time $5 trial
credit**, after which the Free plan grants $1/month — not enough to keep a
service always-on. A small always-on instance runs at roughly $5/month, so the
trial covers about a month. That is sufficient for an assessment review window
and will stop afterwards unless the $5/month Hobby plan is added.

Render's free tier (below) is the option that stays free indefinitely, at the
cost of cold starts and non-persistent data.

## Render (the free alternative)

Kept as a working alternative: genuinely free with no expiry, at the cost of a
~1 minute cold start after 15 minutes of inactivity and a database that resets
with it.

[`render.yaml`](../render.yaml) is a complete blueprint. From the Render
dashboard: **New → Blueprint**, point it at this repository, apply.

Two things in it are load-bearing:

- **`npm ci --include=dev`.** Render sets `NODE_ENV=production`, which makes npm
  skip devDependencies. `next build` needs TypeScript, Tailwind and the type
  packages, and `boot.ts` runs through `tsx`. Without the flag the build fails.
- **`DATABASE_PATH=/tmp/acme-salary.db`.** `/tmp` is writable on the free
  instance type. It is also wiped on restart, which is what the boot seed
  compensates for.

### The free-tier tradeoff, stated plainly

The free instance type has an **ephemeral filesystem** and **sleeps when idle**.
In practice:

- A salary change made while reviewing **will not survive** a spin-down or a
  redeploy. Every cold start restores the seeded dataset.
- The first request after a quiet period takes **around thirty seconds** while
  the instance wakes.

This was chosen over paying for a disk because a demo that always comes up in a
known state is arguably better than one that accumulates a reviewer's edits.
The cost is that the deployment cannot be mistaken for a durable system.

### Making it durable

Three changes, no application code:

1. `plan: starter` instead of `free`.
2. Add the `disk` block (already written out, commented, at the bottom of
   `render.yaml`).
3. Point `DATABASE_PATH` at the mount, e.g. `/var/data/acme-salary.db`.

`boot.ts` becomes a no-op after the first deploy, because the database will no
longer be empty.

## Anywhere that takes a container

```bash
docker build -t acme-salary .
docker run -p 3000:3000 -v acme-salary-data:/data acme-salary
```

The named volume is what makes it durable — without it the container's `/data`
is ephemeral and behaves like the free Render tier.

The image is a single stage on purpose. A multi-stage build would shed the dev
dependencies, but `better-sqlite3` is a native module and `tsx` is needed at
boot, so the pruning saves less than the added fragility costs.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `./data/salary.db` | Where the SQLite file lives. Point at a mount to make it durable. |
| `PORT` | `3000` | |
| `HIDE_DEMO_CREDENTIALS` | unset | Set to `true` to stop the login screen prefilling and displaying the demo account. **A real deployment sets this.** |
| `SEED_HR_EMAIL` · `SEED_HR_PASSWORD` | `hr.manager@acme.example` · `DemoPass!2026` | The seeded account. Change both before seeding anything that is not a demo. |

## Before this held real salary data

The build is scoped as a single-persona product on a demo deployment. Everything
below is out of scope by design ([requirements](requirements.md)), and would be
required before it held anyone's actual pay:

- **`HIDE_DEMO_CREDENTIALS=true`**, and a real account created rather than seeded.
- **HTTPS enforced.** The session cookie already sets `secure` in production, so
  it will simply stop working over plain HTTP — which is the correct failure.
- **Backups.** A SQLite file is trivial to back up (`.backup` or a file copy of a
  checkpointed database) and there is currently no schedule doing it.
- **Rate limiting on `/api/auth/login`.** Scrypt makes each attempt cost ~100ms,
  which is a speed bump rather than a defence.
- **A second role**, at minimum a read-only one, before more than one person has
  access.
- **Postgres**, at the point where a second writer or a second node exists. The
  integer money columns and the window-function SQL both port directly, and
  Drizzle supports it with the same query-builder API.

## Verifying a deployment

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-URL/login          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-URL/dashboard      # 307 → /login
```

Then sign in and confirm the dashboard reads **$713M annual payroll across 9,620
employees**. Those figures are deterministic, so anything else means the seed did
not run.
