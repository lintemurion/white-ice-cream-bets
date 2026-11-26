# Multi-Person Bets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bets with several people per side and several subjects, where named people confirm or leave, anyone can join while proposed, sides lock once everyone is in, and each winner marks their own payment.

**Architecture:** Bet sides and subjects become lists; a new `confirmed` list and `paidBy` list drive activation and payment. A new members-only `group/members` doc lets the rules check a whole bet's people in one lookup and is kept in step with admission. Every member move (join, switch, leave, I'm in) is a transaction that writes the resulting status, and the rules re-derive and enforce that status. A pure `src/model/bet.ts` holds the status logic both the client and the tests use.

**Tech Stack:** unchanged (TypeScript, Preact, Firebase JS SDK, Firestore rules, Vitest, @firebase/rules-unit-testing).

**Spec:** `docs/superpowers/specs/2026-11-22-multi-person-bets-design.md` (builds on `docs/superpowers/specs/2026-11-22-white-ice-cream-bets-design.md`)

## Global Constraints

- Free Spark plan; Firestore rules are the only integrity layer. Rules lookups: at most 10 per single write, 20 per batch/transaction.
- Every rules change starts with failing rules tests, including cheating attempts (per `docs/DEVELOPING.md`).
- Majority and voting logic unchanged: `votes * 2 > memberCount`.
- Size cap: at most **8** distinct people across `sideA`, `sideB`, `subjects`. No duplicates within a list; no person in more than one of the three lists.
- Members may change only their **own** id in `sideA`, `sideB`, `confirmed`, `paidBy`, and only while `status == 'proposed'` (sides/confirmed) or `status == 'settled'` (paidBy).
- Status after any member move: `void` if `sideA` is empty; else `active` if both sides non-empty and `confirmed` equals everyone on both sides; else `proposed`.
- Members never delete bets anymore (Leave replaces Decline/Cancel; empty side A means `void`).
- Admin writes stay unconstrained by these rules (except the existing own-uid vote/ballot bans); `src/data/admin.ts` validates admin edits.
- UI copy: buttons `I'm in`, `Leave`, `Switch sides`, `Join <first name on side>'s side` / `Join other side` (empty side), `I got paid`; labels `About anyone?`, `My side:`, `Against:`, `If my side loses:`, `If their side loses:`; card lines `About: <names>`, `Waiting on: <names>`, `<losers> owe <winners>: <stake>`, `Paid: <n> of <m>`, `(open challenge)` for an empty side B. Names on a side: up to 2 joined with ` & `; more shows `<first>, <second> +<n>`.
- **Git (Kyle's rules):** branch `feature/multi-person-bets`. Every Commit step: stop, show Kyle the exact command, branch, staged files, and message, and wait for a clear yes. Subagents never run git write operations. No AI attribution. No pushes without asking.

## Review Focus

1. **Bets written in the old format** (string `sideA`) before Kyle presses Upgrade data must not crash any screen. Test in Task 4 (`normalizeBet converts the old single-id shape`) and use it at every read.
2. **Two people joining the same open challenge at once.** Both writes must end in a consistent bet (both on, or the second retried), never a lost join. Test in Task 4 (`two simultaneous joins both land`).
3. **The last person on side A leaves or switches.** The bet must go `void`, not sit as `proposed` with an empty side A. Test in Task 2 (`switching away as the last on side A voids the bet`).
4. **A subject tries to join or switch onto a side.** Must be refused by the rules, and the UI must not offer it. Test in Task 2 (`subject cannot join either side`) and Task 6 (`subjects see no Join buttons`).
5. **Proposing before Upgrade data has run** (no `group/members` doc). Must fail with a clear message ("The group needs a quick upgrade. Ask Kyle."), not a raw permission error. Test in Task 4 (`proposeBet explains a missing member list`).

---

## Data shapes (shared by every task)

```ts
// src/model/types.ts changes
export interface BetDoc {
  description: string;
  sideA: Uid[];          // proposer first
  sideB: Uid[];          // may be empty (open challenge) while proposed
  subjects: Uid[];       // replaces `subject`
  confirmed: Uid[];      // people on a side who are in; starts [proposer]
  paidBy: Uid[];         // winners who marked paid; starts []
  stakeA: string; stakeB: string;
  voteStyle: VoteStyle; status: BetStatus; winner: Side | null;
  createdBy: Uid; createdAt: Timestamp;
  votesA: Record<Uid, true>; votesB: Record<Uid, true>;
  voters: Record<Uid, true>; voterCount: number;
}
/** group/members */
export interface MembersDoc { uids: Record<Uid, true>; }
```

---

### Task 1: Member list doc and admission binding (rules + helpers)

**Files:**
- Modify: `src/model/types.ts` (add `MembersDoc` only; BetDoc changes land in Task 2)
- Modify: `firestore.rules.src`, `tests/rules/helpers.ts`
- Test: `tests/rules/access.test.ts`, `tests/rules/joins.test.ts`

**Interfaces:**
- Produces: `group/members` `{ uids: map<uid,true> }`; rules helper `memberUids()` = `get(/databases/$(database)/documents/group/members).data.uids`; `seed()` writes `group/members` with every seeded member.
- Approve batch shape (member path) gains a 4th write: update `group/members` adding exactly key `X` (the admitted uid) to `uids`. Rules on `group/members` update (non-admin): `uids` diff adds only key `X`, `X == getAfter(group/main).data.lastAdmitted`, `get(users/X).status == 'pending'`, `getAfter(users/X).status == 'member'`. The `users/X` pending→member rule additionally requires `X in getAfter(group/members).data.uids`. Create of `group/members`: admin only. Delete: admin only. Read: members, admin.

- [ ] **Step 1: Write failing tests**

```ts
// access.test.ts
it('members and admin read group/members; pending and strangers cannot');
// joins.test.ts
it('approve batch must also add the admitted uid to group/members');           // old 3-write batch now fails
it('approve batch with members add succeeds; members doc has the new key');
it('cannot add a different uid, or two uids, to group/members');
it('cannot add to group/members without the admission');                       // members update alone: assertFails
it('cannot remove a key from group/members as a member');
it('admin can write group/members directly');
```
Update the existing approve tests' batches to include the members write.

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:emu -- tests/rules/access.test.ts tests/rules/joins.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the rules and helper changes; update `src/data/joins.ts` `tryDecideJoin` approve batch and `src/data/admin.ts` `adminApprove` to add the key (admin: plain update), `initGroup` to create `group/members {uids:{}}`.
- [ ] **Step 4: Verify.** Run: `npm test`. Expected: all PASS (existing data tests for joins/admin updated where they assert batch contents).
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add src/model/types.ts firestore.rules.src tests/rules src/data/joins.ts src/data/admin.ts tests/data docs/superpowers/specs/2026-11-22-multi-person-bets-design.md docs/superpowers/plans/2026-11-22-multi-person-bets.md
git commit -m "Add members-only member list kept in step with admission"
```

---

### Task 2: Bet lifecycle rules with teams

**Files:**
- Modify: `src/model/types.ts` (BetDoc per Data shapes)
- Create: `src/model/bet.ts`
- Modify: `firestore.rules.src`, `tests/rules/helpers.ts` (`betDoc` defaults)
- Test: `tests/unit/bet.test.ts`, `tests/rules/bets-lifecycle.test.ts` (rewrite the accept/decline/cancel cases)

**Interfaces:**
- Produces (`src/model/bet.ts`, pure):
  - `MAX_PEOPLE = 8`
  - `everyone(b: Pick<BetDoc,'sideA'|'sideB'>): Uid[]`
  - `nextStatus(b: Pick<BetDoc,'sideA'|'sideB'|'confirmed'>): 'proposed' | 'active' | 'void'` per Global Constraints.
  - `sideOf(b, uid): Side | null`
  - `waitingOn(b): Uid[]` (on a side, not confirmed)
- `betDoc()` defaults: `sideA ['ava']`, `sideB ['jo']`, `subjects []`, `confirmed ['ava']`, `paidBy []`, status `proposed`; other fields unchanged.
- Rules, predicate per transition, all requiring `isMember()` and `resource.data.status == 'proposed'` except propose:
  - **propose (create):** exact field set (old `subject` gone; `subjects`, `confirmed`, `paidBy` added); `request.auth.uid in sideA`; `confirmed == [request.auth.uid]`; `paidBy == []`; lists have no duplicates (`l.toSet().size() == l.size()`); pairwise disjoint (`sideA.toSet().intersection(sideB.toSet()).size() == 0`, same for subjects vs each side); total `<= 8`; `memberUids().keys().hasAll(sideA.concat(sideB).concat(subjects))`; status `proposed`; other existing create checks unchanged.
  - **move (update)** covers join/switch/leave/I'm in: `onlyChanges(['sideA','sideB','confirmed','status'])`; `subjects` unchanged; the symmetric difference of old vs new for each of `sideA`, `sideB`, `confirmed` is a subset of `[me]`; me not in `subjects`; after-write lists still disjoint, duplicate-free, `<= 8` people, and `confirmed` ⊆ `sideA ∪ sideB`; me is a current member (`me in memberUids()`); and the new `status` equals the `nextStatus` rule (`void` if `sideA` empty; `active` iff both non-empty and `confirmed.toSet() == sideA.concat(sideB).toSet()`; else `proposed`).
  - **call it:** unchanged (active → voting).
  - Remove the accept and member-delete (decline/cancel) predicates; members can no longer delete bets.
- Admin create/update/delete rules unchanged apart from field names.

- [ ] **Step 1: Write failing unit tests** (`tests/unit/bet.test.ts`)

```ts
expect(nextStatus({ sideA: [], sideB: ['jo'], confirmed: [] })).toBe('void');
expect(nextStatus({ sideA: ['ava'], sideB: [], confirmed: ['ava'] })).toBe('proposed');           // open challenge
expect(nextStatus({ sideA: ['ava'], sideB: ['jo'], confirmed: ['ava'] })).toBe('proposed');
expect(nextStatus({ sideA: ['ava'], sideB: ['jo'], confirmed: ['ava', 'jo'] })).toBe('active');
expect(nextStatus({ sideA: ['ava','mac'], sideB: ['jo'], confirmed: ['ava','jo'] })).toBe('proposed');
expect(waitingOn({ sideA: ['ava','mac'], sideB: ['jo'], confirmed: ['ava'] })).toEqual(['mac','jo']);
```

- [ ] **Step 2: Write failing rules tests** (`tests/rules/bets-lifecycle.test.ts`), seed 6 members incl. `mac`, `kai`, `zoe`

```ts
it('proposes a 2 vs 2 bet with two subjects');
it('proposes an open challenge with empty side B');
it('proposer must be on side A and confirmed must be exactly the proposer');
it('rejects a subject on a side, duplicates, a person on both sides, and 9 people');
it('rejects a non-member or former member anywhere on the bet');
it('a non-member of the bet joins side B of an open challenge and, with side A all in, it goes active');
it('joining must also set the right status (proposed stays proposed when someone is still waiting)');
it('subject cannot join either side');
it('cannot add or remove someone else on a side or in confirmed');
it("I'm in adds only me; the last I'm in must set active");
it('switch moves only me and marks me in');
it('leave removes me from my side and confirmed');
it('switching away as the last on side A voids the bet');
it('leaving side B entirely on a proposed bet makes it an open challenge, not void');
it('no moves once active: join, switch, leave, and I\'m in all fail');
it('cannot change subjects, stakes, or voteStyle in a move');
it('members cannot delete bets anymore');
it('call it still works on an active bet');
```
Keep existing tests for text limits, vote style, and admin edits, updated to the new shape.

- [ ] **Step 3: Run to verify failure.** Run: `npm run test:unit -- tests/unit/bet.test.ts` and `npm run test:emu -- tests/rules/bets-lifecycle.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `src/model/bet.ts`, types, helper defaults, and the rules. Count lookups for the move write (members doc, user doc for isMember, group doc if needed) and keep it ≤ 10.
- [ ] **Step 5: Verify.** Run: `npm run test:unit` and `npm run test:emu -- tests/rules`. Expected: lifecycle PASS. Vote and data tests may fail on the shape change; that's Task 3 and 4's job. Note which ones in the report.
- [ ] **Step 6: Commit (ask Kyle first)**

```bash
git add src/model firestore.rules.src tests/rules tests/unit/bet.test.ts
git commit -m "Rules for team bets: lists, confirm, join, switch, leave, lock when active"
```

---

### Task 3: Voting and paid rules on the new shape

**Files:**
- Modify: `firestore.rules.src`
- Test: `tests/rules/bets-open-vote.test.ts`, `tests/rules/bets-anon-vote.test.ts`

**Interfaces:**
- Open/anonymous voting and settling predicates: unchanged logic; fixtures use list sides.
- **mark paid (replaces `markingPaid`):** status `settled`; `onlyChanges(['paidBy','status'])`; `paidBy` gains exactly `[me]` and nothing else; `me in (winner == 'A' ? sideA : sideB)`; me not already in `paidBy`; new `status == 'paid'` iff `paidBy.toSet() == winningSide.toSet()`, else `settled`. Admin unchanged (can write `paidBy`/`status` directly).

- [ ] **Step 1: Write failing tests** (`bets-open-vote.test.ts`)

```ts
it('a winner on a 2-person winning side marks paid; bet stays settled at 1 of 2');
it('the last winner marks paid and must set status paid');
it('a loser, a bystander, or a subject cannot mark paid');
it('a winner cannot add another winner to paidBy, or add themselves twice');
it('cannot mark paid on a bet that is not settled');
it('admin can set paidBy for a winner');
```
Update every fixture in both vote files to list sides (`sideA: ['ava']`, `sideB: ['jo']`).

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:emu -- tests/rules/bets-open-vote.test.ts tests/rules/bets-anon-vote.test.ts`. Expected: new paid tests FAIL.
- [ ] **Step 3: Implement** the paid predicate.
- [ ] **Step 4: Verify.** Run: `npm run test:emu -- tests/rules`. Expected: all rules tests PASS.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add firestore.rules.src tests/rules
git commit -m "Each winner marks their own payment; paid when the last winner does"
```

---

### Task 4: Member data layer and display helpers

**Files:**
- Modify: `src/data/bets.ts`, `src/model/tally.ts`, `src/model/bet.ts`
- Test: `tests/data/bets.test.ts`, `tests/unit/tally.test.ts`, `tests/unit/bet.test.ts`, `tests/data/text-limits.test.ts`

**Interfaces:**
- `src/model/bet.ts` adds `normalizeBet(raw: Record<string, unknown>): BetDoc` (string `sideA`/`sideB` → one-item lists; `subject` → `subjects`; missing `confirmed` → everyone on a side if status isn't `proposed`, else `[createdBy]`; missing `paidBy` → winning side if status `paid`, else `[]`) and `sideLabel(uids: Uid[], names: Record<Uid,string>): string` (copy per Global Constraints; empty list → `(open challenge)`).
- `src/model/tally.ts` `owesLine(bet, names)` → `<losers> owe <winners>: <loser stake>` using `sideLabel` with plural `owe` when the losing side has 2+ people, `owes` for one.
- `src/data/bets.ts`:
  - `NewBetInput = { description: string; teammates: Uid[]; opponents: Uid[]; subjects: Uid[]; stakeMine: string; stakeTheirs: string; voteStyle: VoteStyle }`
  - `proposeBet(db, me, input): Promise<string>`: validates cap/disjointness client-side and throws a clear `Error`; if `group/members` is missing, throws `Error("The group needs a quick upgrade. Ask Kyle.")`.
  - `joinSide(db, me, betId, side: Side)`, `switchSide(db, me, betId)`, `leaveBet(db, me, betId)`, `confirmIn(db, me, betId)`: each a `runTransaction` that reads the bet, applies the move to `sideA`/`sideB`/`confirmed`, and writes those plus `status = nextStatus(...)`.
  - `markIGotPaid(db, me, betId)`: transaction adding me to `paidBy`, setting `paid` when complete.
  - Remove `acceptBet`, `declineBet`, `cancelBet`, `markPaid`.
  - Subscriptions (`src/data/subscriptions.ts`) pass every bet through `normalizeBet`.

- [ ] **Step 1: Write failing tests**

```ts
// unit
it('normalizeBet converts the old single-id shape');
it('sideLabel: one, two, three-plus names, and empty');
it("owesLine: 'Jo & Kayla owe Mac & Kaden: a pizza' and singular 'Jo owes Ava: $5'");
// data (emulator)
it('proposeBet creates a team bet with subjects and confirmed [me]');
it('proposeBet explains a missing member list');
it('open challenge: joinSide B by a bystander makes it active');
it("named people confirmIn one by one; the last makes it active");
it('switchSide and leaveBet; last on side A leaving voids the bet');
it('two simultaneous joins both land');                     // Promise.all of two joinSide calls on an open challenge
it('markIGotPaid by each winner; paid after the last');
it('full anonymous team flow: propose, confirm, call, vote, settle');
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:unit` and `npm run test:emu -- tests/data/bets.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run: `npm test`. Expected: all PASS except UI and admin tests that still use removed functions (Tasks 5 and 6); list them in the report.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add src/model src/data/bets.ts src/data/subscriptions.ts tests/unit tests/data/bets.test.ts tests/data/text-limits.test.ts
git commit -m "Data layer for team bets: join, switch, leave, I'm in, I got paid"
```

---

### Task 5: Admin: removal, edits, mark paid for a winner, upgrade data

**Files:**
- Modify: `src/model/removal.ts`, `src/data/admin.ts`
- Test: `tests/unit/removal.test.ts`, `tests/data/admin.test.ts`

**Interfaces:**
- `planRemoval`: per spec Removal section. Proposed bets: remove from sides, `confirmed`, `subjects`; status via `nextStatus`. Active bets: remove from side and `subjects`; `void` if a side empties. Voting/settled/paid: unchanged (votes removed as today). Also delete the uid from `group/members.uids` (`update` with `uids.<uid>`: `deleteField()` sentinel represented as `{ op: 'update', path: 'group/members', data: { ['uids.' + uid]: DELETE } }` where `export const DELETE = Symbol('delete')` is mapped to `deleteField()` in `admin.ts`).
- `adminEditBet` patch: `BetPatch = Partial<Pick<BetDoc, 'description'|'stakeA'|'stakeB'|'subjects'>>`; validates subjects are current members (from `group/members`), not on a side, within the cap; only re-validates when `subjects` changed.
- `adminMarkPaidFor(db, betId, winner: Uid)`: adds winner to `paidBy`, sets `paid` when complete.
- `needsUpgrade(input: { membersDocExists: boolean; bets: Array<Record<string, unknown>> }): boolean` (pure, in `src/model/bet.ts`).
- `upgradeData(db): Promise<{ members: number; bets: number }>`: creates/overwrites `group/members` from users with status `member`; rewrites each old-format bet with `normalizeBet` (removing `subject`).

- [ ] **Step 1: Write failing tests**

```ts
// removal.test.ts
it('removes her from a proposed team bet; the bet goes active if everyone left is in');
it('voids a proposed bet when she was the last on side A');
it('removes her from an active bet side; voids it if that side empties');
it('removes her from subjects');
it('keeps her on voting, settled, and paid bets');
it('removes her from the member list');
// admin.test.ts (emulator)
it('adminEditBet rejects a subject on a side or a non-member; accepts unchanged subjects');
it('adminMarkPaidFor marks a removed winner paid');
it('upgradeData builds the member list and converts an old-format bet');
it('needsUpgrade is false after upgradeData');
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run: `npm test`. Expected: all PASS except UI tests (Task 6).
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add src/model src/data/admin.ts tests/unit/removal.test.ts tests/data/admin.test.ts
git commit -m "Admin support for team bets: removal, subject edits, mark paid for, data upgrade"
```

---

### Task 6: Screens

**Files:**
- Create: `src/ui/PeoplePicker.tsx`
- Modify: `src/ui/NewBet.tsx`, `src/ui/BetCard.tsx`, `src/ui/HomeContainer.tsx`, `src/ui/sections.ts`, `src/ui/Admin.tsx`, `src/ui/AdminContainer.tsx`, `src/styles.css`
- Test: `tests/ui/NewBet.test.tsx`, `tests/ui/BetCard.test.tsx`, `tests/ui/sections.test.ts`, `tests/ui/Admin.test.tsx`, `tests/ui/PeoplePicker.test.tsx`

**Interfaces:**
- `PeoplePicker` props `{ label: string; options: Array<{uid: Uid; name: string}>; selected: Uid[]; disabled: Set<Uid>; full: boolean; onChange(next: Uid[]): void }`: selected people as removable chips, an add control listing unselected, non-disabled options; add disabled when `full`.
- `NewBet`: three pickers (`About anyone?`, `My side:` with me fixed and not removable, `Against:`); a person chosen in one picker is disabled in the others; total cap 8 (`full`); stake labels per Global Constraints; submits `NewBetInput`.
- `BetCard` proposed state: `About:` line when subjects exist; sides via `sideLabel`; `Waiting on:` line; buttons per spec sketch and Global Constraints, shown only while proposed; subjects see no Join buttons. Settled: `owesLine`, `I got paid` for winners not in `paidBy`, `Paid: n of m` when 2+ winners. Vote buttons `<sideLabel> won`.
- `sections`: `needsYou` = proposed bets where I'm on a side and not confirmed; `proposedByMe` → rename to `waiting` = other proposed bets I'm on; open challenges I'm not on appear under a new `OPEN CHALLENGES` section (proposed, side B empty, I'm not a subject).
- Admin: `Upgrade data` button shown when `needsUpgrade`, with the result counts; subjects edit via `PeoplePicker`; `Mark <name> paid` per unpaid winner on settled bets.

- [ ] **Step 1: Write failing tests**

```ts
it('NewBet: a person picked as a subject is disabled in both side pickers and vice versa');
it('NewBet: me is on my side and cannot be removed');
it('NewBet: picking stops at 8 people');
it('NewBet: empty Against submits an open challenge');
it("BetCard: named, not in: shows I'm in, Switch sides, Leave and Waiting on");
it('BetCard: bystander sees Join buttons; subjects see no Join buttons');
it('BetCard: no move buttons once active');
it("BetCard: settled team bet shows 'Jo & Kayla owe Mac & Kaden: a pizza', I got paid, Paid: 1 of 2");
it('sections: needsYou, waiting, open challenges');
it('Admin: Upgrade data appears only when needed; Mark <name> paid per unpaid winner');
it('PeoplePicker: add and remove chips; disabled options not offered; full disables add');
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:unit`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run: `npm test` and `npm run build`. Expected: all PASS, build OK.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add src/ui src/styles.css tests/ui
git commit -m "Screens for team bets: pickers, join/switch/leave, I'm in, I got paid, upgrade"
```

---

### Task 7: Docs

**Files:**
- Modify: `docs/USING.md`, `docs/DEVELOPING.md`, `README.md`

- [ ] **Step 1: Update `docs/USING.md`**: making a bet with teams and subjects, open challenges, I'm in / Switch sides / Leave until everyone's in, sides lock when active, combined stakes, I got paid.
- [ ] **Step 2: Update `docs/DEVELOPING.md`** data layout table (`group/members`, new bet fields) and "How a vote works" (activation and paid rules).
- [ ] **Step 3: Update README Admin tasks**: Upgrade data (press once after this deploys), Mark <name> paid, subjects edit, removal behavior on team bets.
- [ ] **Step 4: Verify.** Run: `npm run test:unit` (workflow/README tests). Expected: PASS. Every button name in the docs matches Global Constraints.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add docs/USING.md docs/DEVELOPING.md README.md
git commit -m "Document team bets, open challenges, and the data upgrade"
```

---

### After the tasks (Kyle, with Claude guiding)

1. Push and open a PR into `main` (with Kyle's yes). CI runs.
2. Kyle merges; the deploy runs.
3. Kyle signs in as admin and presses **Upgrade data** right away (members can't propose until then).
4. One real team bet end to end: propose 2 vs 1 with a subject, everyone taps I'm in, call it, vote, settle, both winners tap I got paid.
