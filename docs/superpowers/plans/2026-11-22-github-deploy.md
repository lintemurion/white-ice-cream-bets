# GitHub Actions Build and Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions tests every PR, and tests then deploys White Ice Cream Bets to Firebase on every push to `main` and on manual runs, authenticating keylessly via Workload Identity Federation.

**Architecture:** A reusable `ci.yml` workflow (tests + build) runs on pull requests and is called by `deploy.yml`, which runs on `push` to `main` and `workflow_dispatch`, then deploys with `google-github-actions/auth` (WIF) and `firebase deploy --project`. Small Node helpers let the rules build read the admin email from the environment and guard the built bundle against test settings. A Cloud Shell script performs the one-time Google Cloud setup.

**Tech Stack:** GitHub Actions, `google-github-actions/auth`, firebase-tools 15 (already a dev dependency), Node 24, Java 21 (Temurin), Vitest, `yaml` (new dev dependency, for workflow tests), bash for the Cloud Shell script.

**Spec:** `docs/superpowers/specs/2026-11-22-github-deploy-design.md` (builds on `docs/superpowers/specs/2026-11-22-white-ice-cream-bets-design.md`)

## Global Constraints

- Repo `lintemurion/white-ice-cream-bets`; Firebase project `whiteicecreambets`; Spark plan; no card.
- Deploy triggers exactly: `push` to branch `main`, and `workflow_dispatch` (any branch). Pull requests: tests + build only, never credentials, never deploy.
- No service account keys anywhere. Auth only via Workload Identity Federation, trust limited by `assertion.repository == 'lintemurion/white-ice-cream-bets'`.
- Repository variables (not secrets), exact names: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_AUTH_DOMAIN`, `ADMIN_EMAIL`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`.
- Deploy always passes `--project ${{ vars.FIREBASE_PROJECT_ID }}`; `.firebaserc` stays `demo-wicb`.
- CI: Node 24, Java 21 Temurin. Workflow `permissions: contents: read` at top level; `id-token: write` only on the deploy job.
- Deploy concurrency group `deploy-production`, `cancel-in-progress: false`.
- Never print secrets/tokens; never commit `.env.local` or a real email except where the spec's variable table needs Kyle's values in docs as placeholders (use `<your google email>`).
- **Git (Kyle's global rules):** work on `feature/initial-build` (PR #1 is open from it; new commits join that PR). Every "Commit" step means: stop, show Kyle the exact command, branch, staged files, and message, wait for a clear yes. Subagents never run git write operations. No AI attribution. No pushes unless Kyle asks separately.

## Review Focus

1. **A PR run must never be able to deploy or obtain credentials**, including a manual run of `ci.yml`. Test in Task 2 (`ci.yml has no id-token permission and no deploy step`).
2. **A deploy built without the repository variables set** (e.g. first run before Kyle adds them) must fail loudly before uploading, not deploy a broken site. Test in Task 1 (`resolveAdminEmail throws when neither env nor .env.local provides it`) and Task 2 (`deploy job fails fast when required vars are empty`).
3. **A deploy built with test settings** (`demo-wicb`, `admin@example.test`, `127.0.0.1:9099`) must be blocked. Test in Task 1 (`findForbidden flags each test marker`).
4. **Two merges in quick succession** must not interrupt a running deploy. Test in Task 2 (`deploy concurrency does not cancel in progress`).
5. **The admin email's case** from GitHub variables must be lowercased the same way as locally. Test in Task 1 (`resolveAdminEmail lowercases env value`).

---

### Task 1: Rules build reads env; bundle guard

**Files:**
- Create: `scripts/lib/deploy-config.mjs`
- Modify: `scripts/build-rules.mjs`
- Create: `scripts/check-bundle.mjs`
- Test: `tests/unit/deploy-config.test.ts`
- Also commit: `docs/superpowers/specs/2026-11-22-github-deploy-design.md`, `docs/superpowers/plans/2026-11-22-github-deploy.md`

**Interfaces:**
- Produces (`scripts/lib/deploy-config.mjs`, ESM, no deps):
  - `resolveAdminEmail({ env, envLocalText }: { env: Record<string,string|undefined>; envLocalText: string | null }): string` — uses `env.VITE_ADMIN_EMAIL` if non-empty after trim, else `VITE_ADMIN_EMAIL=` from `envLocalText`; trims, lowercases, validates plain email (same regex as today); throws `Error` naming both sources if neither yields one.
  - `FORBIDDEN_MARKERS: string[]` = `['demo-wicb', 'admin@example.test', '127.0.0.1:9099']`
  - `findForbidden(text: string, markers?: string[]): string[]` — markers present in `text`.
- `scripts/build-rules.mjs` (deploy mode) uses `resolveAdminEmail({ env: process.env, envLocalText: <.env.local contents or null> })`. Test mode (`--test`) unchanged.
- `scripts/check-bundle.mjs <dir>`: reads every `.js` and `.html` file under `<dir>` (default `dist`), exits 1 printing the file and marker on any `findForbidden` hit, else prints `check-bundle: ok`.
- Add npm script `"check-bundle": "node scripts/check-bundle.mjs dist"`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/deploy-config.test.ts`

```ts
it('resolveAdminEmail prefers env over .env.local', () =>
  expect(resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: 'a@x.com' }, envLocalText: 'VITE_ADMIN_EMAIL=b@x.com' })).toBe('a@x.com'));
it('resolveAdminEmail falls back to .env.local', () =>
  expect(resolveAdminEmail({ env: {}, envLocalText: 'X=1\nVITE_ADMIN_EMAIL=b@x.com\n' })).toBe('b@x.com'));
it('resolveAdminEmail lowercases env value', () =>
  expect(resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: ' Kyle@Example.COM ' }, envLocalText: null })).toBe('kyle@example.com'));
it('resolveAdminEmail treats blank env as unset', () =>
  expect(resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: '  ' }, envLocalText: 'VITE_ADMIN_EMAIL=b@x.com' })).toBe('b@x.com'));
it('resolveAdminEmail throws when neither env nor .env.local provides it', () =>
  expect(() => resolveAdminEmail({ env: {}, envLocalText: null })).toThrow(/VITE_ADMIN_EMAIL/));
it('resolveAdminEmail rejects a non-plain email', () =>
  expect(() => resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: "a'@x.com" }, envLocalText: null })).toThrow());
it('findForbidden flags each test marker', () => {
  for (const m of FORBIDDEN_MARKERS) expect(findForbidden(`x ${m} y`)).toEqual([m]);
  expect(findForbidden('whiteicecreambets.web.app')).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:unit -- tests/unit/deploy-config.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `deploy-config.mjs`, switch `build-rules.mjs` deploy mode to it, add `check-bundle.mjs` and the npm script.
- [ ] **Step 4: Verify.** Run: `npm run test:unit` → PASS. Run: `npm run rules` (with `.env.local` present) → `build-rules: wrote firestore.rules for <lowercased email>`. Run: `npm run build && npm run check-bundle` → `check-bundle: ok`. Run in bash: `VITE_ADMIN_EMAIL=Someone@Example.com node scripts/build-rules.mjs` → wrote for `someone@example.com`; then re-run `npm run rules` to restore.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add scripts/lib/deploy-config.mjs scripts/build-rules.mjs scripts/check-bundle.mjs package.json tests/unit/deploy-config.test.ts docs/superpowers/specs/2026-11-22-github-deploy-design.md docs/superpowers/plans/2026-11-22-github-deploy.md
git commit -m "Let the rules build read the admin email from the environment; add bundle guard"
```

---

### Task 2: Workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- Test: `tests/unit/workflows.test.ts` (add dev dependency `yaml`)

**Interfaces:**
- Consumes: `npm test`, `npm run build`, `npm run rules`, `npm run check-bundle` (Task 1).
- `ci.yml`: `on: pull_request` and `on: workflow_call`. Top-level `permissions: { contents: read }`. One job `test`: ubuntu-latest; `actions/checkout@v4`; `actions/setup-node@v4` (`node-version: 24`, `cache: npm`); `actions/setup-java@v4` (`distribution: temurin`, `java-version: 21`); `npm ci`; `npm test`; `npm run build`. No secrets, no `id-token`.
- `deploy.yml`: `on: push: branches: [main]` and `workflow_dispatch`. Top-level `permissions: { contents: read }`. `concurrency: { group: deploy-production, cancel-in-progress: false }`. Jobs:
  - `test`: `uses: ./.github/workflows/ci.yml`.
  - `deploy`: `needs: test`; `permissions: { contents: read, id-token: write }`; env maps vars: `VITE_FIREBASE_PROJECT_ID: ${{ vars.FIREBASE_PROJECT_ID }}`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_ADMIN_EMAIL: ${{ vars.ADMIN_EMAIL }}`, `VITE_USE_EMULATOR: 'false'`. Steps: checkout; setup-node 24 with npm cache; a "Check required variables" step that fails (exit 1, naming the missing ones) if any of the seven vars is empty; `npm ci`; `google-github-actions/auth@v2` with `workload_identity_provider: ${{ vars.WIF_PROVIDER }}` and `service_account: ${{ vars.WIF_SERVICE_ACCOUNT }}`; `npm run rules`; `npm run build`; `npm run check-bundle`; `npx firebase deploy --project "${{ vars.FIREBASE_PROJECT_ID }}" --non-interactive`.
  - Note: `firebase.json` predeploy hooks re-run rules and build inside the deploy with the same env; that's expected.

- [ ] **Step 1: Write the failing tests** in `tests/unit/workflows.test.ts` (parse with `yaml`)

```ts
const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const deploy = parse(readFileSync('.github/workflows/deploy.yml', 'utf8'));
it('ci runs on pull_request and workflow_call only', () =>
  expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'workflow_call']));
it('ci.yml has no id-token permission and no deploy step', () => {
  expect(JSON.stringify(ci)).not.toMatch(/id-token|firebase deploy|google-github-actions\/auth/);
  expect(ci.permissions).toEqual({ contents: 'read' });
});
it('ci sets up Node 24 and Java 21 and runs npm test and build', () => { /* assert step with node-version 24, java-version 21 temurin, run 'npm test', run 'npm run build' */ });
it('deploy runs on push to main and workflow_dispatch only', () => {
  expect(Object.keys(deploy.on).sort()).toEqual(['push', 'workflow_dispatch']);
  expect(deploy.on.push.branches).toEqual(['main']);
});
it('deploy concurrency does not cancel in progress', () =>
  expect(deploy.concurrency).toEqual({ group: 'deploy-production', 'cancel-in-progress': false }));
it('deploy job needs the reusable test job', () => {
  expect(deploy.jobs.test.uses).toBe('./.github/workflows/ci.yml');
  expect(deploy.jobs.deploy.needs).toBe('test');
});
it('only the deploy job gets id-token write', () => {
  expect(deploy.permissions).toEqual({ contents: 'read' });
  expect(deploy.jobs.deploy.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
});
it('deploy job fails fast when required vars are empty', () => { /* the check step references all seven vars and precedes the auth step */ });
it('deploy uses WIF auth, never a credentials_json key', () => { /* auth step has workload_identity_provider and service_account; no credentials_json anywhere */ });
it('deploy passes --project from vars and runs check-bundle before deploy', () => { /* order: rules, build, check-bundle, firebase deploy with --project "${{ vars.FIREBASE_PROJECT_ID }}" */ });
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:unit -- tests/unit/workflows.test.ts`. Expected: FAIL (files missing).
- [ ] **Step 3: Implement** both workflow files per the Interfaces block.
- [ ] **Step 4: Verify.** Run: `npm run test:unit` → PASS. If `npx --yes actionlint` (or another available linter) runs on this machine, run it on `.github/workflows/*.yml` and fix findings; if none is available, say so in the report.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml tests/unit/workflows.test.ts package.json package-lock.json
git commit -m "Add CI and deploy workflows with keyless Google Cloud auth"
```

---

### Task 3: Cloud Shell setup script and README

**Files:**
- Create: `scripts/setup-github-deploy.sh`
- Modify: `README.md`

**Interfaces:**
- `scripts/setup-github-deploy.sh` (bash, `set -euo pipefail`), meant to be pasted into or run from Google Cloud Shell. Variables at top: `PROJECT_ID=whiteicecreambets`, `REPO=lintemurion/white-ice-cream-bets`, `SA_NAME=github-deploy`, `POOL=github`, `PROVIDER=github-repo`. Steps, each safe to re-run (skip "already exists"):
  1. `PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')`
  2. Enable APIs: `iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com firestore.googleapis.com serviceusage.googleapis.com`.
  3. Create service account `$SA_NAME`.
  4. Grant project roles to it: `roles/firebasehosting.admin`, `roles/firebaserules.admin`, `roles/datastore.indexAdmin`, `roles/serviceusage.serviceUsageConsumer`, `roles/firebase.viewer`.
  5. Create pool `$POOL` (location `global`) and OIDC provider `$PROVIDER` with issuer `https://token.actions.githubusercontent.com`, `--attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"`, `--attribute-condition="assertion.repository == '$REPO'"`.
  6. Bind `roles/iam.workloadIdentityUser` on the service account to `principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO`.
  7. Print exactly two lines: `WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER` and `WIF_SERVICE_ACCOUNT=$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com`.
- README: replace "One-time setup" steps 9 to 11 (CLI project + manual deploy) with "Automatic deploys": open Cloud Shell, run the script, add the seven repository variables (table with where each value comes from; `ADMIN_EMAIL` shown as `<your google email>`), then "merge to `main`, or Actions > Deploy > Run workflow and pick a branch". Note that a manual run from a branch deploys that branch to the live site. Keep a short "Deploying by hand (emergency)" section with `npx firebase deploy --project <project>`. Add a "If a deploy fails with a permission error" note: add the role the error names to the `github-deploy` service account.

- [ ] **Step 1: Write the script.**
- [ ] **Step 2: Verify syntax.** Run: `bash -n scripts/setup-github-deploy.sh` → no output, exit 0. If `shellcheck` is available, run it and fix findings; otherwise say so.
- [ ] **Step 3: Update the README.** Every command and file it names must exist; variable names must match Global Constraints exactly.
- [ ] **Step 4: Verify.** Run: `npm run test:unit` → PASS (README/script changes don't affect tests).
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add scripts/setup-github-deploy.sh README.md
git commit -m "Add Cloud Shell setup for keyless deploys and document automatic deploys"
```

---

### After the tasks (Kyle, with Claude guiding; not a subagent task)

1. Kyle approves a push of `feature/initial-build` (updates PR #1; the new `ci.yml` runs on the PR).
2. Kyle runs `scripts/setup-github-deploy.sh` in Cloud Shell and adds the seven repository variables.
3. Kyle merges PR #1 (or runs Deploy manually on `feature/initial-build`). Claude watches the run and helps with any permission errors.
4. Kyle opens `https://whiteicecreambets.web.app`, signs in as admin, presses "Set up group", approves founding members.
