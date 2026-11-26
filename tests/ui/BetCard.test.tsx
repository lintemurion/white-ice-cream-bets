// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { BetCard, type BetActions } from '../../src/ui/BetCard';
import { errorMessage } from '../../src/ui/errorMessage';
import { bet, names } from './fixtures';
import type { BetDoc, Side } from '../../src/model/types';

afterEach(cleanup);

const makeActions = (): BetActions => ({
  joinSide: vi.fn().mockResolvedValue(undefined),
  switchSide: vi.fn().mockResolvedValue(undefined),
  leave: vi.fn().mockResolvedValue(undefined),
  confirmIn: vi.fn().mockResolvedValue(undefined),
  callIt: vi.fn().mockResolvedValue(undefined),
  castOpenVote: vi.fn().mockResolvedValue(undefined),
  castAnonVote: vi.fn().mockResolvedValue(undefined),
  trySettle: vi.fn().mockResolvedValue(null),
  markIGotPaid: vi.fn().mockResolvedValue(undefined),
});

function show(b: BetDoc, me: string, extra: { myVote?: Side | null; memberCount?: number; actions?: BetActions } = {}) {
  const actions = extra.actions ?? makeActions();
  render(
    <BetCard id="b1" bet={b} me={me} names={names} memberCount={extra.memberCount ?? 4} myVote={extra.myVote} actions={actions} />,
  );
  return actions;
}

const MOVES = ["I'm in", 'Switch sides', 'Leave', /^Join /];
const noMoves = () => {
  for (const name of MOVES) expect(screen.queryByRole('button', { name })).toBeNull();
};

/** Ava (in) and Sam (not in) vs Jo (not in), about Maya. */
const proposed = (over: Partial<BetDoc> = {}) =>
  bet({ status: 'proposed', sideA: ['ava', 'sam'], sideB: ['jo'], subjects: ['maya'], confirmed: ['ava'], ...over });

describe('BetCard: proposed', () => {
  it("named, not in: shows I'm in, Switch sides, Leave and Waiting on", async () => {
    const actions = show(proposed(), 'sam');
    expect(screen.getByText('About: Maya')).toBeTruthy();
    expect(screen.getByText('Ava & Sam vs Jo')).toBeTruthy();
    expect(screen.getByText('Waiting on: Sam, Jo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Join / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "I'm in" }));
    await waitFor(() => expect(actions.confirmIn).toHaveBeenCalledWith('sam', 'b1'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch sides' }));
    await waitFor(() => expect(actions.switchSide).toHaveBeenCalledWith('sam', 'b1'));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(actions.leave).toHaveBeenCalledWith('sam', 'b1'));
  });

  it("already in: Switch sides and Leave, no I'm in", () => {
    show(proposed(), 'ava');
    expect(screen.queryByRole('button', { name: "I'm in" })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch sides' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy();
  });

  it('bystander sees Join buttons; subjects see no Join buttons', async () => {
    const actions = show(proposed({ sideB: [] }), 'kayla');
    expect(screen.getByText('Ava & Sam vs (open challenge)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Join Ava's side" }));
    await waitFor(() => expect(actions.joinSide).toHaveBeenCalledWith('kayla', 'b1', 'A'));
    fireEvent.click(screen.getByRole('button', { name: 'Join other side' }));
    await waitFor(() => expect(actions.joinSide).toHaveBeenCalledWith('kayla', 'b1', 'B'));
    expect(screen.queryByRole('button', { name: "I'm in" })).toBeNull();
    cleanup();

    show(proposed(), 'kayla');
    expect(screen.getByRole('button', { name: "Join Jo's side" })).toBeTruthy();
    cleanup();

    show(proposed(), 'maya');
    noMoves();
  });

  it('a bet with 8 people offers no Join buttons', () => {
    show(proposed({ sideA: ['ava', 'sam', 'mac'], sideB: ['jo', 'kaden', 'x1'], subjects: ['maya', 'x2'] }), 'kayla');
    noMoves();
  });

  it('the proposer gets no special buttons once she is off the bet', () => {
    show(proposed({ createdBy: 'kayla', sideA: ['ava'], confirmed: ['ava'] }), 'kayla');
    expect(screen.queryByRole('button', { name: "I'm in" })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull();
    expect(screen.getByRole('button', { name: "Join Ava's side" })).toBeTruthy();
  });

  it('shows stakes and style tag on a proposal', () => {
    show(proposed({ voteStyle: 'anonymous' }), 'jo');
    expect(screen.getByText(/a ride to the mall vs a coffee/)).toBeTruthy();
    expect(screen.getByText('(anonymous)')).toBeTruthy();
  });

  it('no About line without subjects', () => {
    show(proposed({ subjects: [] }), 'jo');
    expect(screen.queryByText(/^About:/)).toBeNull();
  });

  it('a denied move shows a friendly line', async () => {
    const actions = makeActions();
    actions.confirmIn = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'permission-denied' }));
    show(proposed(), 'sam', { actions });
    fireEvent.click(screen.getByRole('button', { name: "I'm in" }));
    expect((await screen.findByRole('alert')).textContent).toBe("That didn't work. The bet may have changed; try again.");
  });
});

describe('BetCard', () => {
  it('no move buttons once active', () => {
    for (const me of ['ava', 'jo', 'kayla']) {
      show(bet({ status: 'active' }), me);
      noMoves();
      cleanup();
    }
    show(bet({ status: 'voting' }), 'kayla');
    noMoves();
  });

  it('shows Call it on an active bet', () => {
    const actions = show(bet({ status: 'active' }), 'sam');
    fireEvent.click(screen.getByRole('button', { name: 'Call it' }));
    expect(actions.callIt).toHaveBeenCalledWith('b1');
  });

  it("settled team bet shows 'Jo & Kayla owe Mac & Kaden: a pizza', I got paid, Paid: 1 of 2", async () => {
    const b = bet({
      status: 'settled',
      winner: 'A',
      sideA: ['mac', 'kaden'],
      sideB: ['jo', 'kayla'],
      stakeB: 'a pizza',
      paidBy: ['kaden'],
    });
    const actions = show(b, 'mac');
    expect(screen.getByText('Jo & Kayla owe Mac & Kaden: a pizza')).toBeTruthy();
    expect(screen.getByText('Paid: 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I got paid' }));
    await waitFor(() => expect(actions.markIGotPaid).toHaveBeenCalledWith('mac', 'b1'));
    cleanup();
    show(b, 'kaden'); // already marked
    expect(screen.queryByRole('button', { name: 'I got paid' })).toBeNull();
    cleanup();
    show(b, 'jo'); // a loser
    expect(screen.queryByRole('button', { name: 'I got paid' })).toBeNull();
  });

  it('one-on-one settled bet: owes line, I got paid for the winner, no Paid count', () => {
    show(bet({ status: 'settled', winner: 'A' }), 'ava');
    expect(screen.getByText('Jo owes Ava: a coffee')).toBeTruthy();
    expect(screen.getByText('Ava beat Jo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I got paid' })).toBeTruthy();
    expect(screen.queryByText(/^Paid:/)).toBeNull();
  });

  it('shows Paid on a paid bet without I got paid', () => {
    show(bet({ status: 'paid', winner: 'B', paidBy: ['jo'] }), 'jo');
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'I got paid' })).toBeNull();
  });

  it('team vote buttons read "<side names> won"', () => {
    show(bet({ status: 'voting', sideA: ['ava', 'sam'], sideB: ['jo', 'maya', 'kayla'] }), 'mac');
    expect(screen.getByRole('button', { name: 'Ava & Sam won' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jo, Maya +1 won' })).toBeTruthy();
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

  it('open voting names who voted which way, omitting a side with no voters', () => {
    const b = bet({ status: 'voting', votesA: { ava: true, sam: true } });
    show(b, 'maya');
    expect(screen.getByText('Ava won: Ava, Sam')).toBeTruthy();
    expect(screen.queryByText(/^Jo won:/)).toBeNull();
    cleanup();
    show(bet({ status: 'voting', votesA: { sam: true }, votesB: { maya: true, gone: true } }), 'ava');
    expect(screen.getByText('Ava won: Sam')).toBeTruthy();
    expect(screen.getByText('Jo won: Maya, Former member')).toBeTruthy();
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

  it('anonymous tie with revealed counts says Tied, not the hidden-count text', () => {
    const b = bet({ status: 'voting', voteStyle: 'anonymous', voters: { ava: true, jo: true, maya: true, sam: true }, voterCount: 4 });
    render(<BetCard id="b1" bet={b} me="sam" names={names} memberCount={4} tally={{ A: 2, B: 2 }} actions={makeActions()} />);
    expect(screen.getByText('4 of 4 voted. Tied.')).toBeTruthy();
    expect(screen.queryByText(/Count shown/)).toBeNull();
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
    const b = bet({ status: 'settled', winner: 'A', sideB: ['gone-uid-123'] });
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

  it('voting card puts the description before the sides line', () => {
    const { container } = render(<BetCard id="b1" bet={bet({ status: 'voting' })} me="sam" names={names} memberCount={4} actions={makeActions()} />);
    const ps = Array.from(container.querySelectorAll('p')).map((p) => p.textContent ?? '');
    expect(ps.findIndex((t) => t.includes('Jo cannot do'))).toBeLessThan(ps.findIndex((t) => t.startsWith('Ava vs Jo')));
  });
});

describe('errorMessage', () => {
  it('keeps the Ask Kyle messages and plain validation text', () => {
    expect(errorMessage(new Error('The group needs a quick upgrade. Ask Kyle.'))).toBe('The group needs a quick upgrade. Ask Kyle.');
    expect(errorMessage(new Error('This bet needs the group upgrade first. Ask Kyle.'))).toBe(
      'This bet needs the group upgrade first. Ask Kyle.',
    );
  });
});
