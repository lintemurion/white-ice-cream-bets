// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { Pending } from '../../src/ui/Pending';

afterEach(cleanup);

describe('Pending', () => {
  it('shows the vote count when the group has members', () => {
    render(<Pending displayName="Riley" voterCount={3} memberCount={6} onSignOut={() => {}} />);
    expect(screen.getByText('3 of 6 voted')).toBeTruthy();
  });

  it('shows just the thanks text when there are no members yet', () => {
    const { container } = render(<Pending displayName="Riley" voterCount={0} memberCount={0} onSignOut={() => {}} />);
    expect(screen.getByText(/Thanks, Riley/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/voted/);
  });
});
