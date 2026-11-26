// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { NewBet } from '../../src/ui/NewBet';

afterEach(cleanup);

const members = [
  { uid: 'me', displayName: 'Ava' },
  { uid: 'jo', displayName: 'Jo' },
  { uid: 'pr', displayName: 'Priya' },
  { uid: 'sam', displayName: 'Sam' },
];

const many = [
  ...members,
  ...['Kayla', 'Mac', 'Kaden', 'Lu', 'Rae', 'Tom'].map((n) => ({ uid: n.toLowerCase(), displayName: n })),
];

function setup(onSubmit = vi.fn().mockResolvedValue(undefined), list = members) {
  render(<NewBet me="me" members={list} onSubmit={onSubmit} />);
  return onSubmit;
}
const type = (el: HTMLElement, value: string) => fireEvent.input(el, { target: { value } });
const offered = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options)
    .slice(1)
    .map((o) => o.textContent);
const pick = (label: string, uid: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: uid } });

describe('NewBet', () => {
  it('a person picked as a subject is disabled in both side pickers and vice versa', () => {
    setup();
    pick('About anyone?', 'jo');
    expect(offered('My side:')).not.toContain('Jo');
    expect(offered('Against:')).not.toContain('Jo');
    pick('Against:', 'pr');
    expect(offered('About anyone?')).not.toContain('Priya');
    expect(offered('My side:')).not.toContain('Priya');
    expect(offered('My side:')).toEqual(['Sam']);
  });

  it('me is on my side and cannot be removed', () => {
    setup();
    expect(screen.getByText('Ava (you)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Ava' })).toBeNull();
    for (const label of ['About anyone?', 'My side:', 'Against:']) expect(offered(label)).not.toContain('Ava');
  });

  it('picking stops at 8 people', () => {
    setup(undefined, many);
    for (const uid of ['jo', 'pr', 'sam']) pick('My side:', uid);
    for (const uid of ['kayla', 'mac', 'kaden']) pick('Against:', uid);
    pick('About anyone?', 'lu');
    // Me + 7 picked = 8.
    for (const label of ['About anyone?', 'My side:', 'Against:']) {
      expect((screen.getByLabelText(label) as HTMLSelectElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Remove Lu' }));
    expect((screen.getByLabelText('Against:') as HTMLSelectElement).disabled).toBe(false);
  });

  it('empty Against submits an open challenge', async () => {
    const onSubmit = setup();
    type(screen.getByLabelText("What's the bet?"), '  Snow before Dec 1 ');
    type(screen.getByLabelText('If my side loses:'), ' $5 ');
    fireEvent.click(screen.getByRole('button', { name: 'Propose bet' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Snow before Dec 1',
      teammates: [],
      opponents: [],
      subjects: [],
      stakeMine: '$5',
      stakeTheirs: '$5',
      voteStyle: 'open',
    });
  });

  it('submits teams, subjects and the chosen voteStyle', async () => {
    const onSubmit = setup();
    type(screen.getByLabelText("What's the bet?"), 'x');
    pick('About anyone?', 'jo');
    pick('My side:', 'sam');
    pick('Against:', 'pr');
    type(screen.getByLabelText('If my side loses:'), 'a pizza');
    type(screen.getByLabelText('If their side loses:'), 'a coffee');
    fireEvent.click(screen.getByLabelText('Anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Propose bet' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      description: 'x',
      teammates: ['sam'],
      opponents: ['pr'],
      subjects: ['jo'],
      stakeMine: 'a pizza',
      stakeTheirs: 'a coffee',
      voteStyle: 'anonymous',
    });
  });

  it('pre-fills their stake to match mine until edited', () => {
    setup();
    type(screen.getByLabelText('If my side loses:'), 'a ride');
    expect((screen.getByLabelText('If their side loses:') as HTMLTextAreaElement).value).toBe('a ride');
    type(screen.getByLabelText('If their side loses:'), 'a coffee');
    type(screen.getByLabelText('If my side loses:'), 'a ride to the mall');
    expect((screen.getByLabelText('If their side loses:') as HTMLTextAreaElement).value).toBe('a coffee');
  });

  it('Propose bet is disabled for whitespace-only description', () => {
    setup();
    type(screen.getByLabelText('If my side loses:'), 'a ride');
    type(screen.getByLabelText("What's the bet?"), '   \n ');
    expect((screen.getByRole('button', { name: 'Propose bet' }) as HTMLButtonElement).disabled).toBe(true);
    type(screen.getByLabelText("What's the bet?"), ' real bet ');
    expect((screen.getByRole('button', { name: 'Propose bet' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a submit error inline', async () => {
    setup(vi.fn().mockRejectedValue(new Error('The group needs a quick upgrade. Ask Kyle.')));
    type(screen.getByLabelText("What's the bet?"), 'x');
    type(screen.getByLabelText('If my side loses:'), 'y');
    fireEvent.click(screen.getByRole('button', { name: 'Propose bet' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The group needs a quick upgrade. Ask Kyle.');
  });

  it('stops input at 2000 chars for description and 500 per stake, counter shows near the limit', () => {
    setup();
    const desc = screen.getByLabelText("What's the bet?") as HTMLTextAreaElement;
    type(desc, 'x'.repeat(100));
    expect(screen.queryByText('100 / 2000')).toBeNull();
    type(desc, 'x'.repeat(2100));
    expect(desc.value.length).toBe(2000);
    expect(screen.getByText('2000 / 2000')).toBeTruthy();
    const mine = screen.getByLabelText('If my side loses:') as HTMLTextAreaElement;
    type(mine, 'y'.repeat(399));
    expect(screen.queryByText('399 / 500')).toBeNull();
    type(mine, 'y'.repeat(450));
    expect(screen.getAllByText('450 / 500').length).toBeGreaterThan(0); // their stake mirrors mine
    type(mine, 'y'.repeat(600));
    expect(mine.value.length).toBe(500);
  });
});
