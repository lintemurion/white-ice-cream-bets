# Developing White Ice Cream Bets

How the app is put together, and how to change it without letting anyone cheat. Read this before working on a feature request.

## The one rule

**The Firestore security rules are the only thing stopping cheating.** Anyone in the group can open their browser's developer tools and send any request they like to the database. The app's screens are a convenience; the rules in `firestore.rules.src` decide what actually happens.

So any change to what a member can do starts with a rules test, not with a screen:

1. Write the tests in `tests/rules/` for the new allowed writes **and** for the ways someone could abuse them (writing as someone else, skipping a step, changing a field they shouldn't, doing it twice).
2. Change `firestore.rules.src` until those tests pass.
3. Then change the data layer (`src/data/`) so the app sends exactly the writes the rules accept, with tests in `tests/data/`.
4. Then the screens (`src/ui/`), with tests in `tests/ui/`.

If a feature can't be made safe in the rules, the free plan has no server code to fall back on. That's a decision for Kyle, not a place to quietly trust the browser.

## How it's put together

```
firestore.rules.src   security rules (source; __ADMIN_EMAIL__ is filled in at build time)
src/model/            plain data types and pure logic (tallies, removal planning, bet.ts: the shared status logic for sides, activation, and paid)
src/data/             every database write and live subscription, shaped to match the rules
src/ui/               Preact screens; *Container.tsx files wire data to the prop-driven screens
scripts/              rules build, bundle check, icons, Cloud Shell setup
tests/rules/          rules tests (Firestore emulator)
tests/data/           data-layer tests against the emulator, with the real rules on
tests/ui, tests/unit  screen and pure-logic tests (no emulator)
.github/workflows/    CI on pull requests; deploy on push to main or manual run
```

### Data layout

| Path | What it holds | Who can read it |
|---|---|---|
| `group/main` | `memberCount`, `lastAdmitted` | members, pending users, admin |
| `users/{uid}` | `status` (pending, member, rejected, former), `displayName` | members, admin, that user |
| `joinRequests/{uid}` | `status`, `voterCount` | members, admin, that applicant |
| `joinRequests/{uid}/voters/{voter}` | who has voted | members, admin |
| `joinRequests/{uid}/ballots/{voter}` | `choice` (yes, no) | that voter, admin |
| `joinRequests/{uid}/tally/counts` | `yes`, `no` | members once decided or everyone voted, admin |
| `group/members` | `uids`, a map of current member ids (lets the rules check who is a member in one lookup) | members, admin |
| `bets/{id}` | the bet, its status, `sideA`/`sideB` (lists of uids, proposer first), `subjects`, `confirmed` (who said I'm in), `paidBy` (winners who got paid), open-vote maps `votesA`/`votesB`, anonymous `voters`/`voterCount` | members, admin |
| `bets/{id}/ballots/{voter}` | anonymous `choice` (A, B) | that voter, admin |
| `bets/{id}/tally/counts` | anonymous `A`, `B` | members once decided or everyone voted, admin |

### How a vote works

- **Open bets:** a member adds their own uid to `votesA` or `votesB` on the bet. The rules allow only their own key to change.
- **Anonymous bets and all join votes:** one batch writes the voter's private ballot, adds them to the "who voted" list, and moves the hidden count by exactly one. Each of those writes is checked against the others, so none can happen alone.
- **Settling:** any member's app tries the "settle" write whenever a majority shows up. The rules allow it only if one side has strictly more than half of current members (`votes * 2 > memberCount`), reading the counts from before the write.
- **Activation:** a proposed bet goes `active` when both sides have someone and `confirmed` holds everyone on both sides. It goes `void` if side A empties. Members may change only their own id in `sideA`, `sideB`, and `confirmed`, and only while the bet is `proposed`, so the sides lock once it is active. At most 8 people in total across both sides and `subjects`, with nobody in two lists.
- **Paid:** on a settled bet, each winner adds their own id to `paidBy`. The bet becomes `paid` when the last winner does. The admin can mark a winner paid (for example, one who was removed).
- **Status logic:** `src/model/bet.ts` holds the shared rules for sides, status, and paid, used by the data layer, the screens, and the admin code. Bets saved in the old format (a single id for each side) are read through `normalizeBet`, and the admin's **Upgrade data** converts them and writes `group/members`.
- **Joining:** the same idea. Approval adds 1 to `memberCount` in the same batch, and the rules check the two go together.

### The admin

The admin is whoever signs in with the email in `ADMIN_EMAIL` (lowercased, and it must be a verified Google email). The admin is never a member, never votes, and can write almost anything, so the admin page's code (`src/data/admin.ts`) is careful to keep data consistent on its own.

## Working on a change

```
git switch main && git pull
git switch -c <short-branch-name>
npm install
npm test            # everything; needs Java 21+
npm run test:unit   # fast tests only
npm run test:emu -- tests/rules/joins.test.ts   # one emulator file
```

To click through the app locally, see "Running locally against the emulators" in the README. Open `http://127.0.0.1:5173`, not `localhost`, or sign-in will silently fail.

## Shipping a change

1. Push the branch and open a pull request into `main`. CI runs every test and the build.
2. Merge when CI is green. The merge deploys automatically (Actions > Deploy).
3. To try a branch on the real site before merging: Actions > Deploy > Run workflow, pick the branch. That replaces the live site until the next deploy.
4. If the change touched sign-in, do the phone check in the README.

If a deploy fails, open the run on GitHub; the failing step's name usually says why ("Check required variables", "check-bundle", or a permission error naming a role).

## Turning a feature request into work

1. File it as a GitHub issue using the **Feature request** form.
2. Before building, answer: does it change what members can write? If yes, it's a rules change and starts with rules tests (see "The one rule").
3. Write down the decisions that only Kyle can make (who has to agree, who can undo it, what the group sees) before writing code.
