import { describe, expect, it } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import { route } from '../../src/ui/route';
import type { UserDoc, UserStatus } from '../../src/model/types';

const userDoc = (status: UserStatus): UserDoc => ({ status, displayName: 'Riley', createdAt: {} as Timestamp });
const signedIn = { authLoading: false, email: 'a@x', isAdmin: false };

describe('route', () => {
  it('shows loading while auth resolves', () => {
    expect(route({ authLoading: true, email: null, isAdmin: false, userDoc: undefined })).toBe('loading');
  });
  it('signed out goes to sign-in', () => {
    expect(route({ authLoading: false, email: null, isAdmin: false, userDoc: undefined })).toBe('signIn');
  });
  it('admin goes to admin without looking at the user doc', () => {
    expect(route({ authLoading: false, email: 'k@x', isAdmin: true, userDoc: null })).toBe('admin');
    expect(route({ authLoading: false, email: 'k@x', isAdmin: true, userDoc: undefined })).toBe('admin');
  });
  it('waits for the user doc, then sends a new user to choose-name', () => {
    expect(route({ ...signedIn, userDoc: undefined })).toBe('loading');
    expect(route({ ...signedIn, userDoc: null })).toBe('chooseName');
  });
  it('routes pending to Pending', () => {
    expect(route({ ...signedIn, userDoc: userDoc('pending') })).toBe('pending');
  });
  it('routes rejected and former to Blocked', () => {
    expect(route({ ...signedIn, userDoc: userDoc('rejected') })).toBe('blocked');
    expect(route({ ...signedIn, userDoc: userDoc('former') })).toBe('blocked');
  });
  it('routes members to home', () => {
    expect(route({ ...signedIn, userDoc: userDoc('member') })).toBe('home');
  });
});

describe('route with a load error', () => {
  it('shows the error screen instead of choose-name when the user doc failed to load', () => {
    expect(route({ authLoading: false, email: 'a@x', isAdmin: false, userDoc: undefined, userDocError: true })).toBe('error');
  });
  it('an error never reaches routing on a stale null', () => {
    expect(route({ authLoading: false, email: 'a@x', isAdmin: false, userDoc: null, userDocError: true })).toBe('error');
  });
  it('admin and signed-out ignore the error flag', () => {
    expect(route({ authLoading: false, email: 'k@x', isAdmin: true, userDoc: undefined, userDocError: true })).toBe('admin');
    expect(route({ authLoading: false, email: null, isAdmin: false, userDoc: undefined, userDocError: true })).toBe('signIn');
  });
});
