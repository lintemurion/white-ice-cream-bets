import { describe, expect, it } from 'vitest';
import { cleanText } from '../../src/data/errors';

// The rules' string.size() counts UTF-16 code units (pinned against the emulator in
// tests/data/text-limits.test.ts); cleanText must count the same way.
describe('cleanText', () => {
  it('trims and returns the text', () => {
    expect(cleanText('  Riley  ', 30, 'Display name')).toBe('Riley');
  });

  it('refuses blank and whitespace-only text', () => {
    expect(() => cleanText('', 30, 'Display name')).toThrow(/blank/);
    expect(() => cleanText(' \n\t ', 30, 'Display name')).toThrow(/blank/);
  });

  it('counts an emoji as 2, like the rules', () => {
    expect(cleanText('😀'.repeat(15), 30, 'Display name')).toBe('😀'.repeat(15));
    expect(() => cleanText('😀'.repeat(16), 30, 'Display name')).toThrow(/30/);
    expect(cleanText('😀'.repeat(250), 500, 'Stake')).toHaveLength(500);
    expect(() => cleanText('😀'.repeat(251), 500, 'Stake')).toThrow(/500/);
  });

  it('counts a 2-byte character like é as 1, like the rules', () => {
    expect(cleanText('é'.repeat(30), 30, 'Display name')).toBe('é'.repeat(30));
    expect(() => cleanText('é'.repeat(31), 30, 'Display name')).toThrow(/30/);
  });
});
