import { describe, expect, it } from 'vitest';
import { checkRedirectReturn, clearRedirectStarted, markRedirectStarted, unfinishedSignIn } from '../../src/ui/signInRedirect';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe('unfinishedSignIn', () => {
  it('is true only when a redirect was started and auth settled with no user', () => {
    expect(unfinishedSignIn(true, null)).toBe(true);
    expect(unfinishedSignIn(true, undefined)).toBe(false);
    expect(unfinishedSignIn(true, { uid: 'a' })).toBe(false);
    expect(unfinishedSignIn(false, null)).toBe(false);
  });
});

describe('checkRedirectReturn', () => {
  it('reports once after a failed redirect, then clears the flag', () => {
    const s = fakeStorage();
    markRedirectStarted(s);
    expect(checkRedirectReturn(undefined, s)).toBe(false); // still loading: keep the flag
    expect(checkRedirectReturn(null, s)).toBe(true);
    expect(checkRedirectReturn(null, s)).toBe(false);
  });

  it('clears the flag silently when sign-in worked', () => {
    const s = fakeStorage();
    markRedirectStarted(s);
    expect(checkRedirectReturn({ uid: 'a' }, s)).toBe(false);
    expect(checkRedirectReturn(null, s)).toBe(false);
  });

  it('clearRedirectStarted drops the flag when the redirect never started', () => {
    const s = fakeStorage();
    markRedirectStarted(s);
    clearRedirectStarted(s);
    expect(checkRedirectReturn(null, s)).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } as unknown as Storage;
    expect(() => markRedirectStarted(broken)).not.toThrow();
    expect(() => clearRedirectStarted(broken)).not.toThrow();
    expect(checkRedirectReturn(null, broken)).toBe(false);
    expect(checkRedirectReturn(null, undefined)).toBe(false);
  });
});
