// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { NewBet } from '../../src/ui/NewBet';

afterEach(cleanup);

const members = [
  { uid: 'me', displayName: 'Ava' },
  { uid: 'jo', displayName: 'Jo' },
  { uid: 'pr', displayName: 'Priya' },
];

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<NewBet me="me" members={members} onSubmit={onSubmit} />);
  return onSubmit;
}
const type = (el: HTMLElement, value: string) => fireEvent.input(el, { target: { value } });
const optionsOf = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => ({
    text: o.textContent,
    disabled: o.disabled,
  }));

describe('NewBet', () => {
  it('greys out the chosen subject in the opponent picker', () => {
    setup();
    fireEvent.change(screen.getByLabelText('About someone?'), { target: { value: 'jo' } });
    const jo = optionsOf('Me vs:').find((o) => o.text === 'Jo');
    expect(jo?.disabled).toBe(true);
    expect(optionsOf('Me vs:').find((o) => o.text === 'Priya')?.disabled).toBe(false);
  });

  it('clears the opponent when the subject becomes the opponent', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Me vs:'), { target: { value: 'jo' } });
    fireEvent.change(screen.getByLabelText('About someone?'), { target: { value: 'jo' } });
    expect((screen.getByLabelText('Me vs:') as HTMLSelectElement).value).toBe('');
  });

  it('excludes me from opponent and allows me as neither', () => {
    setup();
    expect(optionsOf('Me vs:').map((o) => o.text)).not.toContain('Ava');
    expect(optionsOf('About someone?').map((o) => o.text)).not.toContain('Ava');
    expect(optionsOf('About someone?')[0].text).toMatch(/none/i);
  });

  it('pre-fills their stake to match mine until edited', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Me vs:'), { target: { value: 'pr' } });
    type(screen.getByLabelText('If I lose:'), 'a ride');
    expect((screen.getByLabelText('If Priya loses:') as HTMLTextAreaElement).value).toBe('a ride');
    type(screen.getByLabelText('If Priya loses:'), 'a coffee');
    type(screen.getByLabelText('If I lose:'), 'a ride to the mall');
    expect((screen.getByLabelText('If Priya loses:') as HTMLTextAreaElement).value).toBe('a coffee');
  });

  it('Propose bet is disabled for whitespace-only description', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Me vs:'), { target: { value: 'pr' } });
    type(screen.getByLabelText('If I lose:'), 'a ride');
    type(screen.getByLabelText("What's the bet?"), '   \n ');
    expect((screen.getByRole('button', { name: 'Propose bet' }) as HTMLButtonElement).disabled).toBe(true);
    type(screen.getByLabelText("What's the bet?"), ' real bet ');
    expect((screen.getByRole('button', { name: 'Propose bet' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits trimmed NewBetInput with the chosen voteStyle', async () => {
    const onSubmit = setup();
    type(screen.getByLabelText("What's the bet?"), '  Snow before Dec 1 ');
    fireEvent.change(screen.getByLabelText('About someone?'), { target: { value: 'jo' } });
    fireEvent.change(screen.getByLabelText('Me vs:'), { target: { value: 'pr' } });
    type(screen.getByLabelText('If I lose:'), ' $5 ');
    fireEvent.click(screen.getByLabelText('Anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Propose bet' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Snow before Dec 1',
      opponent: 'pr',
      subject: 'jo',
      stakeMine: '$5',
      stakeTheirs: '$5',
      voteStyle: 'anonymous',
    });
  });

  it('defaults to open votes and no subject', async () => {
    const onSubmit = setup();
    type(screen.getByLabelText("What's the bet?"), 'x');
    fireEvent.change(screen.getByLabelText('Me vs:'), { target: { value: 'pr' } });
    type(screen.getByLabelText('If I lose:'), 'y');
    fireEvent.click(screen.getByRole('button', { name: 'Propose bet' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ voteStyle: 'open', subject: null });
  });

  it('shows a submit error inline', async () => {
    setup(vi.fn().mockRejectedValue(new Error('Description cannot be blank')));
    type(screen.getByLabelText("What's the bet?"), 'x');
    fireEvent.change(screen.getByLabelText('Me vs:'), { target: { value: 'pr' } });
    type(screen.getByLabelText('If I lose:'), 'y');
    fireEvent.click(screen.getByRole('button', { name: 'Propose bet' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Description cannot be blank');
  });

  it('stops input at 2000 chars for description and 500 per stake, counter shows near the limit', () => {
    setup();
    const desc = screen.getByLabelText("What's the bet?") as HTMLTextAreaElement;
    type(desc, 'x'.repeat(100));
    expect(screen.queryByText('100 / 2000')).toBeNull();
    type(desc, 'x'.repeat(2100));
    expect(desc.value.length).toBe(2000);
    expect(screen.getByText('2000 / 2000')).toBeTruthy();
    const mine = screen.getByLabelText('If I lose:') as HTMLTextAreaElement;
    type(mine, 'y'.repeat(399));
    expect(screen.queryByText('399 / 500')).toBeNull();
    type(mine, 'y'.repeat(450));
    expect(screen.getAllByText('450 / 500').length).toBeGreaterThan(0); // their stake mirrors mine
    type(mine, 'y'.repeat(600));
    expect(mine.value.length).toBe(500);
  });
});
