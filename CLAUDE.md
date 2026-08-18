# Template: UI micro-frontend app

## CI/CD Deployment Flow

Push to `main` → `publish.yml` builds, bumps version, publishes `@wolffm/<app-id>` to GitHub Packages, then dispatches `packages_updated` to hadoku_site. There, `update-packages.yml` bumps the lockfile, rebuilds the MF bundle under `public/mf/<app-id>/`, regenerates `registry.json`, and commits. If any CF worker depends on the package, `deploy-workers.yml` runs `pnpm update "@wolffm/*" --latest` and redeploys. GitHub Pages serves the new bundle.

Operational facts:
- You only push to main; version bumping and parent notification are automated
- `HADOKU_SITE_TOKEN` must be set in this repo's GH secrets (push via `python3 scripts/administration.py github-secrets`)
- Workers always pull `--latest` at deploy time, independent of update-packages, so a worker never ships a stale bundle

Full pipeline + failure modes: `../hadoku_site/docs/operations/AUTOMATION.md`.

## Package Structure

### Required Exports

The parent site expects these exports from `src/entry.tsx`:

```typescript
// Mount the app into a DOM element
export function mount(el: HTMLElement, props?: MountProps): void

// Unmount and cleanup
export function unmount(el: HTMLElement): void
```

### Build Output

After `pnpm build`, the `dist/` folder must contain:

- `index.js` - Main entry point (ES module)
- `style.css` - Component styles

### External Dependencies

These are provided by the parent's import map and must NOT be bundled:

- `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`
- `@wolffm/themes`
- `@wolffm/task-ui-components`
- `@wolffm/logger/client`
- `@wolffm/prefs-client`, `@wolffm/prefs-client/react`

Every one is a **singleton**. React and the theme context match on module
identity; the logger and the prefs client each hold their own cache. Bundling
one gives the page a second copy that the first never talks to — on 2026-08-05
two apps inlined `@wolffm/task-ui-components` and threw
`No <HadokuThemeRoot> above this component` for every user, with the provider
plainly mounted. This list was previously short by four entries, which is how
that happened.

The rule is mechanical: **anything in the parent's import map that you import
must be external.** hadoku_site's `pnpm run check:mf-externals` reads that map
and fails the fleet audit otherwise.

See `vite.config.ts` for the rollup externals configuration.

## Worker Packages

If this package is used by a Cloudflare Worker (like `@wolffm/trader-worker`):

1. The worker's `package.json` declares the dependency
2. `deploy-workers.yml` auto-updates to latest before each deploy
3. No manual lockfile updates needed in hadoku_site

### Worker Deployment Safety Net

Even if `update-packages.yml` doesn't run (e.g., local development), workers always deploy with the latest package version because `deploy-workers.yml` runs:

```yaml
- name: Update @wolffm packages to latest
  run: pnpm update "@wolffm/*" --latest --filter <worker-name>
```

This ensures workers never deploy with stale package versions.

## Debugging Deployment Issues

Use the `/health-check` skill for the full runbook. Quick orient: `gh run list --workflow=publish.yml` (this repo) → `gh run list --workflow=update-packages.yml -R WolffM/hadoku_site` → the `ci:package-version-drift` daily cron flags `@wolffm/*` versions lagging >12h.

## Naming Convention

| Item         | Convention            | Example             |
| ------------ | --------------------- | ------------------- |
| Package name | `@wolffm/<app-id>`    | `@wolffm/trader`    |
| Repo name    | `hadoku-<app-id>`     | `hadoku-trader`     |
| Bundle path  | `public/mf/<app-id>/` | `public/mf/trader/` |

**Important**: The `hadoku-` prefix is only for GitHub repo names, not package names.

## Vault — what your service-tier key can and can't do

This repo's vault key lives in `.devvault.local.json` at the repo root (gitignored, mode 0600). `dev-vault.mjs` reads it automatically. Per-key ACL is enforced as of 2026-05-04.

CAN do (no operator needed):

- `GET /api/secrets/status` — sealed/unlocked check
- `GET /api/secrets/get/:key` — fetch a value declared in this repo's `.devvault.json`
  (other repos' secrets return 403 — your key is scoped to THIS repo)
- `GET /api/secrets/acl/me` — see what your key is granted
- Verify with: `node ../hadoku_site/scripts/secrets/dev-vault.mjs --check`

CANNOT do (returns `403` — by design):

- Read secrets NOT in this repo's `.devvault.json`
- `POST /api/secrets/admin/set-many` — adding/changing secrets
- `POST /api/secrets/admin/lock` — sealing the vault
- `GET /api/secrets/list` — enumerating every secret name
- `GET /api/secrets/audit` — dead-key report

If your code reads a new `process.env.X` that isn't in `.devvault.json` yet:

1. Add the mapping to `.devvault.json` (commit-safe, no values).
2. Tomorrow's 08:00Z `secrets:devvault-acl-sync` cron auto-grants the new entries to your repo's key. If you need it NOW: ask the operator to run `python3 scripts/administration.py key-acl-sync --repo ../<this-repo> --key <uuid> [--prune]`.
3. Re-run your dev command.

Operator-only operations (set / lock / audit / grant) use `HADOKU_ADMIN_KEY`. Don't try to escalate: service tier can't write, and there is no key list to add yourself to — auth resolves from the edge-router key registry, which only an admin can write.

Lost or rotating your key? Operator: `python3 scripts/administration.py key-generate --tier service --repo ../<repo> --name <your-name>-<repo>` then drop the new UUID in `.devvault.local.json`.
