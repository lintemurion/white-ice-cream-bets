// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { Timestamp } from 'firebase/firestore';
import { Admin, type AdminActions } from '../../src/ui/Admin';
import type { UserDoc } from '../../src/model/types';
import { bet } from './fixtures';

afterEach(cleanup);

const user = (displayName: string, status: UserDoc['status']) => ({
  uid: displayName.toLowerCase(),
  doc: { displayName, status, createdAt: {} as Timestamp },
});

function makeActions(): AdminActions {
  const ok = () => vi.fn().mockResolvedValue(undefined);
  return {
    initGroup: ok(), approve: ok(), reject: ok(), clearRejection: ok(), removeMember: ok(),
    renameUser: ok(), editBet: ok(), deleteBet: ok(), reopenVote: ok(), clearVote: ok(), markPaidFor: ok(),
    upgradeData: vi.fn().mockResolvedValue({ members: 2, bets: 3 }),
    signOut: vi.fn(),
  };
}

const base = (actions: AdminActions) => ({
  users: [user('Ava', 'member'), user('Jo', 'member'), user('Riley', 'pending'), user('Zed', 'rejected'), user('Old', 'former')],
  bets: [] as Array<{ id: string; bet: ReturnType<typeof bet> }>,
  joinRequests: [{ id: 'riley', req: { displayName: 'Riley', status: 'open' as const, voterCount: 1, createdAt: {} as Timestamp } }],
  memberCount: 2,
  groupMissing: false,
  needsUpgrade: false,
  actions,
});

describe('Admin', () => {
  it('shows Set up group only when group is missing', async () => {
    const actions = makeActions();
    const { rerender } = render(<Admin {...base(actions)} />);
    expect(screen.queryByRole('button', { name: 'Set up group' })).toBeNull();
    rerender(<Admin {...base(actions)} groupMissing={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up group' }));
    await waitFor(() => expect(actions.initGroup).toHaveBeenCalled());
  });

  it('Remove requires typing the member name before it calls removeMember', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} />);
    const row = screen.getByTestId('member-ava');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    const confirm = within(row).getByRole('button', { name: 'Confirm remove' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.input(within(row).getByLabelText('Type Ava to confirm'), { target: { value: 'Av' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.input(within(row).getByLabelText('Type Ava to confirm'), { target: { value: 'Ava' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.removeMember).toHaveBeenCalledWith('ava'));
  });

  it('renames a member inline', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} />);
    const row = screen.getByTestId('member-jo');
    fireEvent.input(within(row).getByLabelText('Name'), { target: { value: 'Joanna' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(actions.renameUser).toHaveBeenCalledWith('jo', 'Joanna'));
  });

  it('lists pending requests with Approve and Reject wired to adminApprove/adminReject', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} />);
    const row = screen.getByTestId('pending-riley');
    expect(within(row).getByText('1 of 2 voted')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(actions.approve).toHaveBeenCalledWith('riley'));
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(actions.reject).toHaveBeenCalledWith('riley'));
  });

  it('clears a rejection and lists former members without actions', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} />);
    fireEvent.click(within(screen.getByTestId('rejected-zed')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(actions.clearRejection).toHaveBeenCalledWith('zed'));
    const former = screen.getByTestId('former-old');
    expect(within(former).queryAllByRole('button').length).toBe(0);
  });

  it('shows Reopen vote on settled and paid bets, not on active ones', async () => {
    const actions = makeActions();
    const bets = [
      { id: 's', bet: bet({ status: 'settled', winner: 'A' }) },
      { id: 'p', bet: bet({ status: 'paid', winner: 'A', paidBy: ['ava'] }) },
      { id: 'a', bet: bet({ status: 'active' }) },
    ];
    render(<Admin {...base(actions)} bets={bets} />);
    fireEvent.click(within(screen.getByTestId('bet-s')).getByRole('button', { name: 'Reopen vote' }));
    await waitFor(() => expect(actions.reopenVote).toHaveBeenCalledWith('s'));
    expect(within(screen.getByTestId('bet-p')).getByRole('button', { name: 'Reopen vote' })).toBeTruthy();
    expect(within(screen.getByTestId('bet-a')).queryByRole('button', { name: 'Reopen vote' })).toBeNull();
  });

  it('Admin: Upgrade data appears only when needed; Mark <name> paid per unpaid winner', async () => {
    const actions = makeActions();
    const bets = [
      { id: 's', bet: bet({ status: 'settled', winner: 'A', sideA: ['ava', 'old'], sideB: ['jo'], paidBy: ['ava'] }) },
      { id: 'p', bet: bet({ status: 'paid', winner: 'A', paidBy: ['ava'] }) },
    ];
    const { rerender } = render(<Admin {...base(actions)} bets={bets} />);
    expect(screen.queryByRole('button', { name: 'Upgrade data' })).toBeNull();

    // Ava already marked; Old (a former member) still owes a mark.
    const s = screen.getByTestId('bet-s');
    expect(within(s).queryByRole('button', { name: 'Mark Ava paid' })).toBeNull();
    expect(within(s).queryByRole('button', { name: 'Mark Jo paid' })).toBeNull();
    fireEvent.click(within(s).getByRole('button', { name: 'Mark Old paid' }));
    await waitFor(() => expect(actions.markPaidFor).toHaveBeenCalledWith('s', 'old'));
    expect(within(screen.getByTestId('bet-p')).queryByRole('button', { name: /^Mark .* paid$/ })).toBeNull();

    rerender(<Admin {...base(actions)} bets={bets} needsUpgrade={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade data' }));
    await waitFor(() => expect(actions.upgradeData).toHaveBeenCalled());
    expect(await screen.findByText('Upgraded: 2 members listed, 3 bets converted.')).toBeTruthy();
  });

  it('Delete bet requires typing delete', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} bets={[{ id: 'a', bet: bet() }]} />);
    const row = screen.getByTestId('bet-a');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const confirm = within(row).getByRole('button', { name: 'Confirm delete' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.input(within(row).getByLabelText('Type delete to confirm'), { target: { value: 'delete' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.deleteBet).toHaveBeenCalledWith('a'));
  });

  it('edits description and stakes, leaving subjects out unless changed', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} bets={[{ id: 'a', bet: bet() }]} />);
    const row = screen.getByTestId('bet-a');
    fireEvent.input(within(row).getByLabelText('Description'), { target: { value: 'New text' } });
    fireEvent.input(within(row).getByLabelText('Stake A'), { target: { value: 'tea' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(actions.editBet).toHaveBeenCalledWith('a', {
        description: 'New text', stakeA: 'tea', stakeB: 'a coffee',
      }),
    );
  });

  it('edits subjects with the people picker, never offering either side', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} users={[...base(actions).users, user('Maya', 'member')]} bets={[{ id: 'a', bet: bet() }]} />);
    const row = screen.getByTestId('bet-a');
    const picker = within(row).getByLabelText('Subjects') as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(['+ add', 'Maya']);
    fireEvent.change(picker, { target: { value: 'maya' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(actions.editBet).toHaveBeenCalledWith('a', {
        description: 'Jo cannot do 20 pushups', stakeA: 'a ride to the mall', stakeB: 'a coffee', subjects: ['maya'],
      }),
    );
  });

  it('keeps a former-member subject and omits subjects from the patch unless changed', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} bets={[{ id: 'a', bet: bet({ status: 'settled', winner: 'A', subjects: ['old'] }) }]} />);
    const row = screen.getByTestId('bet-a');
    expect(within(row).getByText('Old (former)')).toBeTruthy();
    fireEvent.input(within(row).getByLabelText('Description'), { target: { value: 'Fixed' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(actions.editBet).toHaveBeenCalledWith('a', { description: 'Fixed', stakeA: 'a ride to the mall', stakeB: 'a coffee' }),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Old (former)' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(actions.editBet).toHaveBeenLastCalledWith('a', {
        description: 'Fixed', stakeA: 'a ride to the mall', stakeB: 'a coffee', subjects: [],
      }),
    );
  });

  it('shows team sides in the bet title', () => {
    render(<Admin {...base(makeActions())} bets={[{ id: 'a', bet: bet({ sideA: ['ava', 'old'], sideB: [] , status: 'proposed', confirmed: ['ava'] }) }]} />);
    expect(within(screen.getByTestId('bet-a')).getByText('Ava & Old vs (open challenge) (proposed, open)')).toBeTruthy();
  });

  it('clears a voter on a voting bet (open and anonymous)', async () => {
    const actions = makeActions();
    const bets = [
      { id: 'o', bet: bet({ status: 'voting', votesA: { ava: true }, votesB: { jo: true } }) },
      { id: 'n', bet: bet({ status: 'voting', voteStyle: 'anonymous', voters: { jo: true }, voterCount: 1 }) },
    ];
    render(<Admin {...base(actions)} bets={bets} />);
    fireEvent.click(within(screen.getByTestId('bet-o')).getByRole('button', { name: 'Clear vote: Ava' }));
    await waitFor(() => expect(actions.clearVote).toHaveBeenCalledWith('o', 'ava'));
    fireEvent.click(within(screen.getByTestId('bet-n')).getByRole('button', { name: 'Clear vote: Jo' }));
    await waitFor(() => expect(actions.clearVote).toHaveBeenCalledWith('n', 'jo'));
  });

  it('shows action errors inline on the row', async () => {
    const actions = makeActions();
    actions.approve = vi.fn().mockRejectedValue(new Error('group/main is missing'));
    render(<Admin {...base(actions)} />);
    fireEvent.click(within(screen.getByTestId('pending-riley')).getByRole('button', { name: 'Approve' }));
    expect(await within(screen.getByTestId('pending-riley')).findByRole('alert')).toBeTruthy();
  });

  it('has a Sign out button', () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(actions.signOut).toHaveBeenCalled();
  });
});
