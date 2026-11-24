// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { PeoplePicker } from '../../src/ui/PeoplePicker';

afterEach(cleanup);

const options = [
  { uid: 'jo', name: 'Jo' },
  { uid: 'maya', name: 'Maya' },
  { uid: 'sam', name: 'Sam' },
];

const optionTexts = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);

describe('PeoplePicker', () => {
  it('add and remove chips; disabled options not offered; full disables add', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PeoplePicker label="Against:" options={options} selected={['jo']} disabled={new Set(['sam'])} full={false} onChange={onChange} />,
    );
    // Jo is a chip with a remove button; only Maya is left to add (Sam is disabled).
    expect(screen.getByText('Jo')).toBeTruthy();
    expect(optionTexts('Against:')).toEqual(['+ add', 'Maya']);

    fireEvent.change(screen.getByLabelText('Against:'), { target: { value: 'maya' } });
    expect(onChange).toHaveBeenLastCalledWith(['jo', 'maya']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Jo' }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    rerender(
      <PeoplePicker label="Against:" options={options} selected={['jo']} disabled={new Set()} full={true} onChange={onChange} />,
    );
    expect((screen.getByLabelText('Against:') as HTMLSelectElement).disabled).toBe(true);
    // Removing still works when full.
    expect((screen.getByRole('button', { name: 'Remove Jo' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a fixed chip that cannot be removed', () => {
    render(<PeoplePicker label="My side:" options={options} selected={[]} disabled={new Set()} full={false} fixed="Ava (you)" onChange={vi.fn()} />);
    expect(screen.getByText('Ava (you)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});
