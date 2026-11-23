import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };

const load = (name: string) => parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
const ci = load('ci.yml');
const deploy = load('deploy.yml');
const ciSteps: Step[] = ci.jobs.test.steps;
const deploySteps: Step[] = deploy.jobs.deploy.steps;
const indexOf = (steps: Step[], pred: (s: Step) => boolean) => steps.findIndex(pred);

const VARS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_API_KEY',
  'FIREBASE_APP_ID',
  'FIREBASE_AUTH_DOMAIN',
  'ADMIN_EMAIL',
  'WIF_PROVIDER',
  'WIF_SERVICE_ACCOUNT',
];

describe('ci.yml', () => {
  it('runs on pull_request and workflow_call only', () =>
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'workflow_call']));

  it('has no id-token permission and no deploy step', () => {
    expect(JSON.stringify(ci)).not.toMatch(/id-token|firebase deploy|google-github-actions\/auth/);
    expect(ci.permissions).toEqual({ contents: 'read' });
  });

  it('sets up Node 24 and Java 21 and runs npm test and build', () => {
    const node = ciSteps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    const java = ciSteps.find((s) => s.uses?.startsWith('actions/setup-java@'));
    expect(String(node?.with?.['node-version'])).toBe('24');
    expect(String(java?.with?.['java-version'])).toBe('21');
    expect(java?.with?.distribution).toBe('temurin');
    const runs = ciSteps.map((s) => s.run);
    expect(runs).toContain('npm ci');
    expect(runs).toContain('npm test');
    expect(runs).toContain('npm run build');
  });
});

describe('deploy.yml', () => {
  it('runs on push to main and workflow_dispatch only', () => {
    expect(Object.keys(deploy.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(deploy.on.push.branches).toEqual(['main']);
  });

  it('does not cancel a deploy in progress', () =>
    expect(deploy.concurrency).toEqual({ group: 'deploy-production', 'cancel-in-progress': false }));

  it('deploy job needs the reusable test job', () => {
    expect(deploy.jobs.test.uses).toBe('./.github/workflows/ci.yml');
    expect(deploy.jobs.deploy.needs).toBe('test');
  });

  it('only the deploy job gets id-token write', () => {
    expect(deploy.permissions).toEqual({ contents: 'read' });
    expect(deploy.jobs.deploy.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
  });

  it('maps repository variables into the build environment, emulator off', () => {
    const env = deploy.jobs.deploy.env;
    expect(env.VITE_FIREBASE_PROJECT_ID).toBe('${{ vars.FIREBASE_PROJECT_ID }}');
    expect(env.VITE_FIREBASE_API_KEY).toBe('${{ vars.FIREBASE_API_KEY }}');
    expect(env.VITE_FIREBASE_APP_ID).toBe('${{ vars.FIREBASE_APP_ID }}');
    expect(env.VITE_FIREBASE_AUTH_DOMAIN).toBe('${{ vars.FIREBASE_AUTH_DOMAIN }}');
    expect(env.VITE_ADMIN_EMAIL).toBe('${{ vars.ADMIN_EMAIL }}');
    expect(env.VITE_USE_EMULATOR).toBe('false');
  });

  it('fails fast when required vars are empty, before authenticating', () => {
    const check = indexOf(deploySteps, (s) => /required variables/i.test(s.name ?? ''));
    const auth = indexOf(deploySteps, (s) => !!s.uses?.startsWith('google-github-actions/auth@'));
    expect(check).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(auth);
    const text = JSON.stringify(deploySteps[check]);
    for (const v of VARS) expect(text).toContain(`vars.${v}`);
    expect(deploySteps[check].run).toMatch(/exit 1/);
  });

  it('uses keyless WIF auth, never a credentials_json key', () => {
    const auth = deploySteps.find((s) => s.uses?.startsWith('google-github-actions/auth@'));
    expect(auth?.with).toEqual({
      workload_identity_provider: '${{ vars.WIF_PROVIDER }}',
      service_account: '${{ vars.WIF_SERVICE_ACCOUNT }}',
    });
    expect(JSON.stringify(deploy)).not.toMatch(/credentials_json|secrets\./);
  });

  it('builds rules and site, checks the bundle, then deploys with --project from vars', () => {
    const rules = indexOf(deploySteps, (s) => s.run === 'npm run rules');
    const build = indexOf(deploySteps, (s) => s.run === 'npm run build');
    const check = indexOf(deploySteps, (s) => s.run === 'npm run check-bundle');
    const ship = indexOf(deploySteps, (s) => /firebase deploy/.test(s.run ?? ''));
    expect([rules, build, check, ship].every((i) => i >= 0)).toBe(true);
    expect(rules).toBeLessThan(build);
    expect(build).toBeLessThan(check);
    expect(check).toBeLessThan(ship);
    expect(deploySteps[ship].run).toContain('--project "${{ vars.FIREBASE_PROJECT_ID }}"');
    expect(deploySteps[ship].run).toContain('--non-interactive');
  });
});
