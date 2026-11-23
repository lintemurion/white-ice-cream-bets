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
    renameUser: ok(), editBet: ok(), deleteBet: ok(), reopenVote: ok(), clearVote: ok(), markPaid: ok(),
    signOut: vi.fn(),
  };
}

const base = (actions: AdminActions) => ({
  users: [user('Ava', 'member'), user('Jo', 'member'), user('Riley', 'pending'), user('Zed', 'rejected'), user('Old', 'former')],
  bets: [] as Array<{ id: string; bet: ReturnType<typeof bet> }>,
  joinRequests: [{ id: 'riley', req: { displayName: 'Riley', status: 'open' as const, voterCount: 1, createdAt: {} as Timestamp } }],
  memberCount: 2,
  groupMissing: false,
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

  it('shows Reopen vote on settled bets and Mark paid on unpaid settled bets', async () => {
    const actions = makeActions();
    const bets = [
      { id: 's', bet: bet({ status: 'settled', winner: 'A' }) },
      { id: 'p', bet: bet({ status: 'paid', winner: 'A' }) },
      { id: 'a', bet: bet({ status: 'active' }) },
    ];
    render(<Admin {...base(actions)} bets={bets} />);
    const s = screen.getByTestId('bet-s');
    expect(within(s).getByRole('button', { name: 'Mark paid' })).toBeTruthy();
    fireEvent.click(within(s).getByRole('button', { name: 'Reopen vote' }));
    await waitFor(() => expect(actions.reopenVote).toHaveBeenCalledWith('s'));
    fireEvent.click(within(s).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(actions.markPaid).toHaveBeenCalledWith('s'));
    const p = screen.getByTestId('bet-p');
    expect(within(p).queryByRole('button', { name: 'Mark paid' })).toBeNull();
    expect(within(p).getByRole('button', { name: 'Reopen vote' })).toBeTruthy();
    const a = screen.getByTestId('bet-a');
    expect(within(a).queryByRole('button', { name: 'Reopen vote' })).toBeNull();
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

  it('edits description, stakes and subject', async () => {
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

  it('does not offer either side as the subject', () => {
    render(<Admin {...base(makeActions())} users={[...base(makeActions()).users, user('Maya', 'member')]} bets={[{ id: 'a', bet: bet() }]} />);
    const opts = within(within(screen.getByTestId('bet-a')).getByLabelText('Subject')).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['None', 'Maya']);
  });

  it('keeps a former-member subject and omits subject from the patch unless changed', async () => {
    const actions = makeActions();
    render(<Admin {...base(actions)} bets={[{ id: 'a', bet: bet({ status: 'settled', winner: 'A', subject: 'old' }) }]} />);
    const row = screen.getByTestId('bet-a');
    const select = within(row).getByLabelText('Subject') as HTMLSelectElement;
    expect(select.value).toBe('old');
    expect(within(select).getByText('Old (former)')).toBeTruthy();
    fireEvent.input(within(row).getByLabelText('Description'), { target: { value: 'Fixed' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(actions.editBet).toHaveBeenCalledWith('a', { description: 'Fixed', stakeA: 'a ride to the mall', stakeB: 'a coffee' }),
    );
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
