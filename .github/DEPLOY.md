# Production deploy — gated on tests

Production (`master` → grimshade.vercel.app) deploys **only after all tests pass**.

## How it works

`.github/workflows/test.yml` has 4 jobs:

```
static (Typecheck + Lint)
   └─> unit  (Vitest: unit + integration)  ─┐
   └─> e2e   (Playwright: E2E)              ─┴─> deploy (Vercel production)
```

The `deploy` job declares `needs: [unit, e2e]`, and those declare `needs: static`.
GitHub Actions will **not start the deploy** unless Typecheck + Vitest + Playwright
all succeed. One red test → no deploy. The deploy job also only runs on a real
push to `master` (never on PRs or `develop`).

## One-time setup (required to activate)

Until step 1 is done the deploy job **skips gracefully** (stays green) — so the
pipeline is not broken in the meantime. Vercel's own git auto-deploy keeps working
until you do step 2.

### 1. Add 3 GitHub repo secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens → Create Token |
| `VERCEL_ORG_ID` | run `npx vercel link` locally, then read `.vercel/project.json` → `orgId` |
| `VERCEL_PROJECT_ID` | same `.vercel/project.json` → `projectId` |

(Or: Vercel dashboard → Project → Settings → General has the Project ID; the Org/Team
ID is in Team Settings.)

### 2. Disable Vercel's own git auto-deploy for `master`

Otherwise Vercel **also** deploys on every push to `master` immediately — before
the tests finish — which defeats the gate. Pick one:

- **vercel.json** — add:
  ```json
  "git": { "deploymentEnabled": { "master": false } }
  ```
  (Preview deploys for other branches stay on.)
- **or Dashboard** — Project → Settings → Git → turn off production deployments
  for the connected branch.

After both steps: every push to `master` runs the full test suite first, and the
site only redeploys when everything is green.

## E2E in CI (required for the e2e gate)

The `deploy` job waits on the `e2e` (Playwright) job too. E2E hits a **real
Supabase** and needs test-account credentials, so until those secrets exist the
`e2e` job **skips gracefully** (stays green) — which means the deploy gate is
effectively typecheck + vitest only until you wire E2E up.

To run E2E in CI, add these repo secrets (same place as above). Names match
`.env.test.example`:

| Secret | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL the dev server + tests hit |
| `VITE_SUPABASE_ANON_KEY` | anon key for the dev server |
| `SUPABASE_SERVICE_ROLE_KEY` | admin key for fixtures (create/cleanup chars) |
| `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | primary test account |
| `E2E_USER2_EMAIL` / `E2E_USER2_PASSWORD` | secondary (party/realtime) |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | admin-panel smoke |

> ⚠️ **Do NOT point `VITE_SUPABASE_URL` at production.** CI runs the full suite
> on every push to develop/master — it creates and deletes test characters and
> puts load on the DB (this already caused a compute-CPU spike once). Use a
> dedicated **test Supabase project** with the same schema, or keep E2E as a
> local-only gate (run `npm run test:e2e` before promoting develop → master).

If you'd rather NOT run E2E in CI, gate the deploy on unit only: change the
deploy job's `needs: [unit, e2e]` to `needs: [unit]`. Typecheck + Vitest
(unit + integration) still gate every deploy.

## Verifying

Push a commit to `master` → Actions tab → the `deploy` job runs **after** `unit`
(and `e2e`, if enabled) go green. Break a test on purpose → `deploy` is skipped.
