import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { FORBIDDEN_MARKERS, findForbidden, resolveAdminEmail } from '../../scripts/lib/deploy-config.mjs';

describe('resolveAdminEmail', () => {
  it('prefers env over .env.local', () =>
    expect(resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: 'a@x.com' }, envLocalText: 'VITE_ADMIN_EMAIL=b@x.com' })).toBe('a@x.com'));

  it('falls back to .env.local', () =>
    expect(resolveAdminEmail({ env: {}, envLocalText: 'X=1\nVITE_ADMIN_EMAIL=b@x.com\n' })).toBe('b@x.com'));

  it('lowercases env value', () =>
    expect(resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: ' Kyle@Example.COM ' }, envLocalText: null })).toBe('kyle@example.com'));

  it('treats blank env as unset', () =>
    expect(resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: '  ' }, envLocalText: 'VITE_ADMIN_EMAIL=b@x.com' })).toBe('b@x.com'));

  it('strips quotes from the .env.local value', () =>
    expect(resolveAdminEmail({ env: {}, envLocalText: 'VITE_ADMIN_EMAIL="b@x.com"' })).toBe('b@x.com'));

  it('throws when neither env nor .env.local provides it', () =>
    expect(() => resolveAdminEmail({ env: {}, envLocalText: null })).toThrow(/VITE_ADMIN_EMAIL/));

  it('throws when .env.local has an empty value and env is unset', () =>
    expect(() => resolveAdminEmail({ env: {}, envLocalText: 'VITE_ADMIN_EMAIL=' })).toThrow(/VITE_ADMIN_EMAIL/));

  it('rejects a non-plain email', () =>
    expect(() => resolveAdminEmail({ env: { VITE_ADMIN_EMAIL: "a'@x.com" }, envLocalText: null })).toThrow(/plain email/));
});

describe('findForbidden', () => {
  it('flags each test marker', () => {
    for (const m of FORBIDDEN_MARKERS) expect(findForbidden(`x ${m} y`)).toEqual([m]);
  });

  it('passes a real production bundle string', () =>
    expect(findForbidden('authDomain:"whiteicecreambets.web.app"')).toEqual([]));

  it('covers the emulator project, test admin, and auth emulator host', () =>
    expect(FORBIDDEN_MARKERS).toEqual(['demo-wicb', 'admin@example.test', '127.0.0.1:9099']));
});
