// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { BetCard, type BetActions } from '../../src/ui/BetCard';
import { bet, names } from './fixtures';
import type { BetDoc, Side } from '../../src/model/types';

afterEach(cleanup);

const makeActions = (): BetActions => ({
  accept: vi.fn().mockResolvedValue(undefined),
  decline: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  callIt: vi.fn().mockResolvedValue(undefined),
  castOpenVote: vi.fn().mockResolvedValue(undefined),
  castAnonVote: vi.fn().mockResolvedValue(undefined),
  trySettle: vi.fn().mockResolvedValue(null),
  markPaid: vi.fn().mockResolvedValue(undefined),
});

function show(b: BetDoc, me: string, extra: { myVote?: Side | null; memberCount?: number; actions?: BetActions } = {}) {
  const actions = extra.actions ?? makeActions();
  render(
    <BetCard id="b1" bet={b} me={me} names={names} memberCount={extra.memberCount ?? 4} myVote={extra.myVote} actions={actions} />,
  );
  return actions;
}

describe('BetCard', () => {
  it('shows Accept and Decline only to side B on a proposed bet', () => {
    show(bet({ status: 'proposed' }), 'jo');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
    cleanup();
    show(bet({ status: 'proposed' }), 'ava');
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.getByText('Waiting for Jo to accept')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    cleanup();
    show(bet({ status: 'proposed' }), 'sam');
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('shows stakes and style tag on a proposal', () => {
    show(bet({ status: 'proposed', voteStyle: 'anonymous' }), 'jo');
    expect(screen.getByText(/a ride to the mall vs a coffee/)).toBeTruthy();
    expect(screen.getByText('(anonymous)')).toBeTruthy();
  });

  it('shows Call it on an active bet', () => {
    const actions = show(bet({ status: 'active' }), 'sam');
    fireEvent.click(screen.getByRole('button', { name: 'Call it' }));
    expect(actions.callIt).toHaveBeenCalledWith('b1');
  });

  it('shows the owes line and Mark paid only to the winner on a settled bet', async () => {
    const b = bet({ status: 'settled', winner: 'A' });
    const actions = show(b, 'ava');
    expect(screen.getByText('Jo owes Ava: a coffee')).toBeTruthy();
    expect(screen.getByText('Ava beat Jo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(actions.markPaid).toHaveBeenCalledWith('b1'));
    cleanup();
    show(b, 'jo');
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
  });

  it('shows Paid on a paid bet without Mark paid', () => {
    show(bet({ status: 'paid', winner: 'B' }), 'jo');
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
  });

  it('open voting shows dots, progress, and removes my vote when I tap my side again', async () => {
    const b = bet({ status: 'voting', votesA: { ava: true, sam: true }, votesB: { maya: true } });
    const actions = show(b, 'ava', { myVote: 'A' });
    expect(screen.getByText(/Ava won ●●○/)).toBeTruthy();
    expect(screen.getByText(/Jo won ●○○/)).toBeTruthy();
    expect(screen.getByText('3 of 4 voted. 1 more for Ava settles it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ava won' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Ava won' }));
    await waitFor(() => expect(actions.castOpenVote).toHaveBeenCalledWith('ava', 'b1', null));
    await waitFor(() => expect(actions.trySettle).toHaveBeenCalledWith('b1'));
  });

  it('open voting: voting for the other side casts it and then tries to settle', async () => {
    const actions = show(bet({ status: 'voting' }), 'sam', { myVote: null });
    fireEvent.click(screen.getByRole('button', { name: 'Jo won' }));
    await waitFor(() => expect(actions.castOpenVote).toHaveBeenCalledWith('sam', 'b1', 'B'));
    await waitFor(() => expect(actions.trySettle).toHaveBeenCalledWith('b1'));
  });

  it('anonymous voting card shows who voted and the hidden-count text', async () => {
    const b = bet({ status: 'voting', voteStyle: 'anonymous', voters: { ava: true, jo: true }, voterCount: 2 });
    const actions = show(b, 'sam', { myVote: null });
    expect(screen.getByText('Voted: Ava, Jo')).toBeTruthy();
    expect(screen.getByText("2 of 4 voted. Count shown when it's decided.")).toBeTruthy();
    expect(screen.queryByText(/●/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ava won' }));
    await waitFor(() => expect(actions.castAnonVote).toHaveBeenCalledWith('sam', 'b1', 'A'));
    await waitFor(() => expect(actions.trySettle).toHaveBeenCalledWith('b1'));
  });

  it('highlights my anonymous vote', () => {
    const b = bet({ status: 'voting', voteStyle: 'anonymous', voters: { sam: true }, voterCount: 1 });
    show(b, 'sam', { myVote: 'B' });
    expect(screen.getByRole('button', { name: 'Jo won' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ava won' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows an action error inline, not an alert', async () => {
    const actions = makeActions();
    actions.callIt = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'permission-denied' }));
    show(bet({ status: 'active' }), 'sam', { actions });
    fireEvent.click(screen.getByRole('button', { name: 'Call it' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('a 2000-char description is clamped with a more toggle that expands it', () => {
    const { container } = render(
      <BetCard id="b1" bet={bet({ description: 'word '.repeat(400).trim() })} me="sam" names={names} memberCount={4} actions={makeActions()} />,
    );
    const desc = container.querySelector('.desc')!;
    expect(desc.classList.contains('clamped')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(desc.classList.contains('clamped')).toBe(false);
    expect(screen.getByRole('button', { name: 'less' })).toBeTruthy();
  });

  it('short text has no more toggle', () => {
    show(bet(), 'sam');
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
  });

  it('names a missing uid "Former member", never the raw uid', () => {
    const b = bet({ status: 'settled', winner: 'A', sideB: 'gone-uid-123' });
    const { container } = render(<BetCard id="b1" bet={b} me="sam" names={{ ava: 'Ava' }} memberCount={4} actions={makeActions()} />);
    expect(screen.getByText('Ava beat Former member')).toBeTruthy();
    expect(screen.getByText('Former member owes Ava: a coffee')).toBeTruthy();
    expect(container.textContent).not.toContain('gone-uid');
  });

  it('shows the final count on a settled anonymous bet', () => {
    const b = bet({ status: 'settled', winner: 'A', voteStyle: 'anonymous' });
    render(<BetCard id="b1" bet={b} me="sam" names={names} memberCount={5} tally={{ A: 4, B: 1 }} actions={makeActions()} />);
    expect(screen.getByText('Final count: Ava 4, Jo 1')).toBeTruthy();
  });

  it('proposal reads "<creator> proposed:" with the quoted description and stakes', () => {
    show(bet({ status: 'proposed', description: 'Snow before Dec 1' }), 'jo');
    expect(screen.getByText('Ava proposed:')).toBeTruthy();
    expect(screen.getByText('"Snow before Dec 1"')).toBeTruthy();
  });

  it('voting card puts the description before the sides line', () => {
    const { container } = render(<BetCard id="b1" bet={bet({ status: 'voting' })} me="sam" names={names} memberCount={4} actions={makeActions()} />);
    const ps = Array.from(container.querySelectorAll('p')).map((p) => p.textContent ?? '');
    expect(ps.findIndex((t) => t.includes('Jo cannot do'))).toBeLessThan(ps.findIndex((t) => t.startsWith('Ava vs Jo')));
  });
});
