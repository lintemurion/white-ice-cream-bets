// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { Home } from '../../src/ui/Home';
import { sections } from '../../src/ui/sections';
import { bet } from './fixtures';

afterEach(cleanup);

const EMPTY = 'No bets yet. Tap + New Bet to start one.';
const noop = () => {};

function show(joinIds: string[], s = sections('jo', [])) {
  render(
    <Home
      joinIds={joinIds}
      sections={s}
      renderJoin={(id) => <p>join {id}</p>}
      renderBet={(id) => <p>bet {id}</p>}
      onNewBet={noop}
      onProfile={noop}
      onSignOut={noop}
    />,
  );
}

describe('Home', () => {
  it('shows a friendly empty state when there is nothing at all', () => {
    show([]);
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });

  it('hides the empty state when there is a join request or a bet', () => {
    show(['riley']);
    expect(screen.queryByText(EMPTY)).toBeNull();
    cleanup();
    show([], sections('jo', [{ id: 'b1', bet: bet({ status: 'active' }) }]));
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText('bet b1')).toBeTruthy();
  });
});
