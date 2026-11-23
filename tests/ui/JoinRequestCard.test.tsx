// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { Timestamp } from 'firebase/firestore';
import { JoinRequestCard } from '../../src/ui/JoinRequestCard';

afterEach(cleanup);

const req = { displayName: 'Riley', status: 'open' as const, voterCount: 3, createdAt: {} as Timestamp };

describe('JoinRequestCard', () => {
  it('shows progress, highlights my vote, votes then tries to decide', async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    const tryDecide = vi.fn().mockResolvedValue(null);
    render(<JoinRequestCard applicant="riley" req={req} myVote="yes" memberCount={6} onVote={onVote} tryDecide={tryDecide} />);
    expect(screen.getByText('Riley wants to join')).toBeTruthy();
    expect(screen.getByText('3 of 6 voted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    await waitFor(() => expect(onVote).toHaveBeenCalledWith('no'));
    await waitFor(() => expect(tryDecide).toHaveBeenCalled());
  });

  it('shows errors inline', async () => {
    const onVote = vi.fn().mockRejectedValue(new Error('nope'));
    render(<JoinRequestCard applicant="riley" req={req} memberCount={6} onVote={onVote} tryDecide={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
