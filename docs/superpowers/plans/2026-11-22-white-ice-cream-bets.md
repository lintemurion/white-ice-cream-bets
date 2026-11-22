# White Ice Cream Bets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first web app where the White Ice Cream friend group proposes bets, votes on outcomes and new members, and tracks who owes what, with every rule enforced server-side by Firestore security rules on the free Spark plan.

**Architecture:** A Preact single-page app talks directly to Cloud Firestore. All integrity (membership, one vote per person, majorities, anonymous ballots) lives in `firestore.rules`, proven first against the Firestore emulator. A thin data layer (`src/data/*`) wraps every write as a batch or transaction shaped exactly the way the rules expect; UI components receive data and actions as props.

**Tech Stack:** TypeScript, Vite, Preact, Firebase JS SDK (modular: Auth with Google, Firestore, Hosting), firebase-tools (emulator, deploy), Vitest, @firebase/rules-unit-testing, @testing-library/preact + jsdom. Node 20+, Java 11+ (required by the Firestore emulator).

**Spec:** `docs/superpowers/specs/2026-11-22-white-ice-cream-bets-design.md`

## Global Constraints

- Firebase Spark plan only. No Cloud Functions, no paid services, no card on file.
- Google sign-in is the only sign-in method.
- Admin is identified by a fixed email (`request.auth.token.email` with `email_verified == true`). The admin is never a member, cannot vote, and is never counted in any majority.
- Majority means strictly more than half of current members: in rules and code always write `votes * 2 > memberCount` (never divide).
- One group, one site. No push notifications, no email, no money handling.
- Phone-first layout that also works on desktop. Brand: "White Ice Cream". Header copy: `WHITE ICE CREAM BETS`.
- Exact UI copy from the spec: `Riley wants to join` / `3 of 6 voted` / `1 more for Maya settles it.` / `Count shown when it's decided.` / `X owes Y: <stakes>` / buttons `+ New Bet`, `Accept`, `Decline`, `Call it`, `Vote`, `Mark paid`, `Yes`, `No`, `Propose bet`.
- Text limits (enforced in rules and form, all trimmed): bet description 1 to 2000 chars and each stake 1 to 500 (Kyle's decision, so the girls can be wordy); display name 1 to 30 (Claude's call).
- **Git (Kyle's global rules):** never commit on `main`. Task 1 starts by creating a feature branch. Every "Commit" step means: stop, show Kyle the exact command, current branch, staged files, and message, and wait for a clear yes. Subagents never run git write operations; they hand back to the main session. No AI attribution in commit messages. No pushes unless Kyle asks separately.
- **Stop gate:** if any rule in Tasks 2 to 5 proves impossible on Spark, stop and bring it to Kyle. Do not fall back to tallying in the browser.

## Review Focus

1. **Two members vote at the same moment, or two clients both try to settle.** Expect: both votes count, the bet settles once, the losing settle attempt returns `null` quietly instead of showing an error. Test in Task 6 (`trySettle on an already-settled bet returns null`) and Task 4 (`second settle write is denied once status is settled`).
2. **A new member is admitted while a bet is in voting.** Expect: the bar rises with the live member count, a bet that was one vote short stays open, and progress text updates. Test in Task 5 (`settle is denied after an admission raises the bar`) and Task 6 (`voteProgress uses the memberCount passed in`).
3. **Blank, whitespace-only, or very long text in bet fields or display names.** Expect: the form blocks it and the rules reject it if the form is bypassed. Test in Task 3 (`rejects description over 2000 chars, stake over 500, and empty stakes`) and Task 9 (`Propose bet is disabled for whitespace-only description`).
4. **A rejected or removed girl signs in again.** Expect: she sees the blocked screen, cannot create a fresh join request, and sees nothing else. Test in Task 2 (`rejected or former user cannot re-request`) and Task 8 (`routes rejected and former to Blocked`).
5. **Sign-in from an iPhone home-screen icon.** Expect: Google sign-in completes and lands on the right screen. No automated test can cover this; Task 11 has the manual check.

---

## Data layout (shared by every task)

```
group/main                      { memberCount: number, lastAdmitted: string | null }
users/{uid}                     { status: 'pending'|'member'|'rejected'|'former', displayName: string, createdAt: Timestamp }
joinRequests/{uid}              { displayName, status: 'open'|'approved'|'rejected', voterCount: number, createdAt }
joinRequests/{uid}/voters/{v}   { }                       // who voted; members only
joinRequests/{uid}/ballots/{v}  { choice: 'yes'|'no' }    // voter + admin only
joinRequests/{uid}/tally/counts { yes: number, no: number } // hidden until decided
bets/{betId}                    { description, sideA, sideB, subject: string|null, stakeA, stakeB,
                                  voteStyle: 'open'|'anonymous',
                                  status: 'proposed'|'active'|'voting'|'settled'|'paid'|'void',
                                  winner: 'A'|'B'|null, createdBy, createdAt,
                                  votesA: map<uid,true>, votesB: map<uid,true>,   // open bets only
                                  voters: map<uid,true>, voterCount: number }      // anonymous bets only
bets/{betId}/ballots/{v}        { choice: 'A'|'B' }       // anonymous only; voter + admin only
bets/{betId}/tally/counts       { A: number, B: number }  // anonymous only; hidden until decided
```

`sideA` is always the creator. `stakeA` is what side A owes if A loses. Join requests keep their voter list in a subcollection (not on the request doc) because the applicant can read her own request doc, and she must see only `voterCount`. Bets keep `voters` on the bet doc because only members read bets.

---

### Task 1: Project scaffold, emulator harness, base access rules

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `.env.example`, `firebase.json`, `.firebaserc`, `firestore.indexes.json`
- Create: `firestore.rules.src`, `scripts/build-rules.mjs`
- Create: `src/model/types.ts`
- Create: `tests/rules/helpers.ts`, `tests/rules/access.test.ts`

**Interfaces:**
- Produces: `src/model/types.ts` with `Uid`, `UserStatus`, `UserDoc`, `GroupDoc`, `JoinStatus`, `JoinRequestDoc`, `JoinTally`, `Side = 'A'|'B'`, `BetStatus`, `VoteStyle`, `BetDoc`, `BetTally`, `Ballot<C>` matching the data layout exactly.
- Produces (`tests/rules/helpers.ts`):
  - `ADMIN_EMAIL = 'admin@example.test'`, `ADMIN_UID = 'kyle'`
  - `makeEnv(): Promise<RulesTestEnvironment>` loads `firestore.rules.src` with `__ADMIN_EMAIL__` replaced by `ADMIN_EMAIL`.
  - `dbAs(env, who: string | 'admin' | null): Firestore`. `'admin'` is uid `kyle` with `{ email: ADMIN_EMAIL, email_verified: true }`; `null` is unauthenticated; any other string is a plain uid with email `<uid>@example.test`.
  - `seed(env, f: Fixture): Promise<void>` writes with rules disabled. `Fixture = { members?: string[]; pending?: string[]; rejected?: string[]; former?: string[]; bets?: Record<string, Partial<BetDoc>>; betTallies?: Record<string, BetTally>; joinTallies?: Record<string, JoinTally> }`. Members get `users/{uid}` status member and `group/main.memberCount = members.length`. Pending get users doc, an open join request with `voterCount: 0`, and a zero tally.
  - `betDoc(overrides: Partial<BetDoc>): BetDoc` defaults: `description 'Test bet'`, `sideA 'ava'`, `sideB 'jo'`, `subject null`, `stakeA '$5'`, `stakeB '$5'`, `voteStyle 'open'`, `status 'proposed'`, `winner null`, `createdBy 'ava'`, empty maps, `voterCount 0`.
- Produces (`firestore.rules.src`): helper functions `isAdmin()`, `isMember()`, `memberCount()`, `isMemberUid(uid)` used by every later rules task.

- [ ] **Step 1: Create the feature branch**

Run: `git checkout -b feature/initial-build` then `git branch --show-current`
Expected: `feature/initial-build`

- [ ] **Step 2: Scaffold the project**

`npm create vite@latest` equivalent by hand: Preact + TypeScript. Install `firebase`, `preact`; dev deps `vite`, `@preact/preset-vite`, `typescript`, `vitest`, `jsdom`, `@testing-library/preact`, `@firebase/rules-unit-testing`, `firebase-tools`. Scripts:

```json
"dev": "vite",
"build": "tsc --noEmit && vite build",
"rules": "node scripts/build-rules.mjs",
"test:unit": "vitest run tests/unit tests/ui",
"test:emu": "firebase emulators:exec --only firestore --project demo-wicb \"vitest run tests/rules tests/data\"",
"test": "npm run test:unit && npm run test:emu"
```

`firebase.json`: firestore rules `firestore.rules`, hosting `public: dist` with SPA rewrite to `/index.html`, `predeploy` running `npm run rules` and `npm run build`, emulator firestore port 8080. `.gitignore` includes `node_modules`, `dist`, `.env.local`, `firestore.rules` (generated), emulator logs. `.env.example` lists `VITE_ADMIN_EMAIL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.

`scripts/build-rules.mjs`: reads `VITE_ADMIN_EMAIL` from `.env.local` (fail loudly if missing), writes `firestore.rules` from `firestore.rules.src` replacing `__ADMIN_EMAIL__`.

- [ ] **Step 3: Write the failing access tests** in `tests/rules/access.test.ts`

Seed: members `ava, jo, maya, priya, sam, zoe` (memberCount 6), pending `riley`, rejected `rex`, former `fay`, one bet `b1`.

```ts
it('stranger cannot read anything', () =>
  assertFails(getDoc(doc(dbAs(env, null), 'bets/b1'))));
it('signed-in non-member cannot read bets, users, or join requests', async () => {
  await assertFails(getDoc(doc(dbAs(env, 'riley'), 'bets/b1')));
  await assertFails(getDocs(collection(dbAs(env, 'riley'), 'users')));
  await assertFails(getDoc(doc(dbAs(env, 'riley'), 'joinRequests/other')));
});
it('pending user reads only her own user doc and join request', async () => {
  await assertSucceeds(getDoc(doc(dbAs(env, 'riley'), 'users/riley')));
  await assertSucceeds(getDoc(doc(dbAs(env, 'riley'), 'joinRequests/riley')));
  await assertFails(getDocs(collection(dbAs(env, 'riley'), 'joinRequests/riley/voters')));
  await assertFails(getDoc(doc(dbAs(env, 'riley'), 'joinRequests/riley/tally/counts')));
});
it('rejected and former users read only their own user doc', async () => {
  await assertSucceeds(getDoc(doc(dbAs(env, 'fay'), 'users/fay')));
  await assertFails(getDoc(doc(dbAs(env, 'fay'), 'bets/b1')));
  await assertFails(getDoc(doc(dbAs(env, 'rex'), 'bets/b1')));
});
it('member reads bets, users, group, join requests and their voter lists', ...assertSucceeds x5);
it('pending user can read group/main', () =>
  assertSucceeds(getDoc(doc(dbAs(env, 'riley'), 'group/main'))));
it('admin reads everything including tallies and ballots', ...);
it('admin email without email_verified is not admin', ...assertFails);
it('nobody but admin writes group/main directly', () =>
  assertFails(setDoc(doc(dbAs(env, 'ava'), 'group/main'), { memberCount: 99, lastAdmitted: null })));
```

- [ ] **Step 4: Run to verify failure**

Run: `npm run test:emu`
Expected: FAIL (rules file missing or deny-all makes the `assertSucceeds` cases fail).

- [ ] **Step 5: Write base rules in `firestore.rules.src`**

`rules_version = '2'`. Helpers: `isAdmin()` = signed in, `token.email == '__ADMIN_EMAIL__'`, `token.email_verified == true`. `isMember()` = `!isAdmin()` and `get(users/{auth.uid}).data.status == 'member'` (guard with `exists`). `memberCount()` = `get(group/main).data.memberCount`. Read rules: `group/main` member, admin, or pending user (it holds only a count and a uid, and the waiting screen needs `memberCount` to show "3 of 6 voted"); `users/{uid}` member, admin, or self; `joinRequests/{uid}` member, admin, or self; `voters` member or admin; `ballots/{v}` admin or `auth.uid == v`; `tally/counts` admin only for now (Tasks 3 and 5 widen it); `bets/**` member or admin. Admin may write anything for now; Tasks 2 to 5 add the admin vote restriction. Everything else denied.

- [ ] **Step 6: Run to verify pass**

Run: `npm run test:emu`
Expected: all `access.test.ts` tests PASS.

- [ ] **Step 7: Commit (ask Kyle first)**

```bash
git add .
git commit -m "Scaffold project, emulator test harness, and base access rules"
```
Staged files must include the spec and this plan under `docs/`, and must not include `.env.local`.

---

### Task 2: Rules for joining (self-registration, anonymous join votes, admission)

**Files:**
- Modify: `firestore.rules.src`
- Test: `tests/rules/joins.test.ts`

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces: the write shapes Task 6's `requestToJoin`, `castJoinVote`, `tryDecideJoin` must match (below).

Write shapes the rules accept:
- **Request to join** (one batch, by uid X, not admin): create `users/X` `{status:'pending', displayName, createdAt: request.time}`, create `joinRequests/X` `{displayName, status:'open', voterCount:0, createdAt}`, create `joinRequests/X/tally/counts` `{yes:0, no:0}`. Denied if `users/X` already exists.
- **New join vote** by member M on X (one batch): create `ballots/M {choice}`, create `voters/M {}`, update `joinRequests/X` changing only `voterCount` by +1, update `tally/counts` changing only the chosen field by +1. Each doc's rule checks the other three with `getAfter`/`existsAfter`. Request must be `open`. Doc id must equal `auth.uid`.
- **Changed join vote** (one batch): update `ballots/M` choice, update tally by -1 on old and +1 on new. No other change.
- **Approve** (one batch, any member): `joinRequests/X.status` open to approved, `users/X.status` pending to member, `group/main` `memberCount` +1 and `lastAdmitted = X`. Allowed only if `tally.yes * 2 > memberCount()` (count before the write). The users rule requires `getAfter(group).memberCount == get(group).memberCount + 1`; the group rule requires `lastAdmitted` pending before and member after. That pairing is what keeps `memberCount` honest.
- **Reject** (one batch, any member): request open to rejected and `users/X` pending to rejected, allowed only if `tally.no * 2 > memberCount()`.
- **Display name**: a pending user or member may change only `displayName` on her own users doc (1 to 30 chars). `status` changes otherwise only by admin.
- **Tally read** widens to: members when `joinRequests/X.status != 'open'` or `voterCount == memberCount()`. The applicant never reads the tally, voters, or ballots.

- [ ] **Step 1: Write the failing tests** in `tests/rules/joins.test.ts`

Seed 6 members, pending `riley`, rejected `rex`, former `fay`.

```ts
it('new user can request to join with the exact batch');           // assertSucceeds
it('rejected or former user cannot re-request');                   // rex, fay: assertFails
it('admin cannot request to join');                                 // assertFails
it('cannot create a request for someone else');                     // uid 'newbie' writes users/other: assertFails
it('member casts a join vote with the four-doc batch');             // assertSucceeds; tally.yes 1, voterCount 1
it('cannot vote twice');                                            // second create of ballots/ava: assertFails
it('cannot vote as someone else');                                  // ava writes ballots/jo: assertFails
it('cannot bump the tally by 2 or without a ballot');               // assertFails x2
it('cannot bump voterCount without a voters doc');                  // assertFails
it('pending user cannot vote on her own request');                  // riley: assertFails
it('admin cannot cast a join vote');                                // assertFails
it('member can change her vote, tally moves -1/+1');                // assertSucceeds; yes 0, no 1
it('member cannot read another member ballot');                     // jo reads ballots/ava: assertFails
it('members cannot read tally while open and not everyone voted');  // assertFails
it('members can read tally once all 6 have voted');                 // assertSucceeds
it('applicant cannot read tally, voters, or ballots even after deciding'); // assertFails x3
it('approve succeeds with 4 of 6 yes and bumps memberCount to 7');  // assertSucceeds; memberCount 7
it('approve denied with 3 of 6 yes');                               // assertFails
it('approve denied if memberCount bumped by 2 or lastAdmitted is a different uid'); // assertFails x2
it('promoting a user to member without an approved request is denied');  // assertFails
it('reject succeeds with 4 of 6 no, user becomes rejected');        // assertSucceeds
it('member edits own displayName only; status change denied');      // succeed, fail
it('displayName over 30 chars or blank is denied');                 // assertFails
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:emu -- tests/rules/joins.test.ts` (or the full `npm run test:emu`)
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the join rules** in `firestore.rules.src` per the write shapes above. Use `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` to pin which fields change. Remove the blanket admin write for ballots and voters docs whose id equals the admin's uid.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:emu`
Expected: `access.test.ts` and `joins.test.ts` PASS.

- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add firestore.rules.src tests/rules/joins.test.ts
git commit -m "Add join request, anonymous join vote, and admission rules"
```

---

### Task 3: Rules for the bet lifecycle (propose, accept, decline, cancel, call it)

**Files:**
- Modify: `firestore.rules.src`
- Test: `tests/rules/bets-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, `betDoc()`.
- Produces: write shapes for Task 6's `proposeBet`, `acceptBet`, `declineBet`, `cancelBet`, `callIt`.

Write shapes:
- **Propose** (member M): create `bets/{id}` with `sideA == createdBy == M`, `sideB` a member and `!= M`, `subject` null or a member not equal to either side, `status 'proposed'`, `winner null`, empty maps, `voterCount 0`, `createdAt == request.time`, `voteStyle` in `['open','anonymous']`, text limits from Global Constraints. If anonymous, the same batch creates `bets/{id}/tally/counts {A:0,B:0}`; its rule requires the bet to exist after the write with `voteStyle 'anonymous'` and `status 'proposed'`.
- **Accept**: only `sideB`, proposed to active, only `status` changes.
- **Decline** (sideB) / **Cancel** (sideA): delete while proposed; the batch also deletes the tally if anonymous.
- **Call it**: any member, active to voting, only `status` changes.
- Admin may edit or delete any bet, except adding the admin's own uid to `votesA`, `votesB`, or `voters`.

- [ ] **Step 1: Write the failing tests**

```ts
it('member proposes an open bet against another member');               // assertSucceeds
it('member proposes an anonymous bet with its zero tally');             // assertSucceeds
it('creator must be side A');                                           // ava creates with sideA 'jo': assertFails
it('cannot bet against yourself or a non-member');                      // assertFails x2
it('subject cannot be either side');                                    // subject 'jo', sideB 'jo': assertFails
it('subject must be a member when set');                                // assertFails
it('rejects description over 2000 chars, stake over 500, and empty stakes'); // assertFails x3; exactly 2000 and 500 succeed
it('voteStyle must be open or anonymous');                              // 'secret': assertFails
it('cannot create a bet already active or with votes');                 // assertFails x2
it('only side B accepts; side A and others cannot');                    // succeed jo, fail ava, fail maya
it('accept cannot change stakes or voteStyle');                         // assertFails
it('side B declines (deletes) a proposed bet; others cannot');
it('side A cancels a proposed bet; cannot delete once active');
it('any member calls it on an active bet; not on a proposed one');
it('pending user cannot propose');                                      // assertFails
it('admin can edit description of any bet');                            // assertSucceeds
it('admin cannot add himself to votesA');                               // assertFails
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:emu`. Expected: new tests FAIL.
- [ ] **Step 3: Implement the lifecycle rules** per the write shapes.
- [ ] **Step 4: Run to verify pass.** Run: `npm run test:emu`. Expected: all rules tests PASS.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add firestore.rules.src tests/rules/bets-lifecycle.test.ts
git commit -m "Add bet lifecycle rules with subject and stakes validation"
```

---

### Task 4: Rules for open-bet voting, settling, and paying

**Files:**
- Modify: `firestore.rules.src`
- Test: `tests/rules/bets-open-vote.test.ts`

**Interfaces:**
- Produces: write shapes for Task 6's `castOpenVote`, `trySettle` (open), `markPaid`.

Write shapes:
- **Open vote** by member M: bet `voting` and `voteStyle 'open'`; only `votesA`/`votesB` change; on each map `diff(...).affectedKeys().hasOnly([M])`; afterwards M is in at most one map with value `true`. This covers add, move, and remove.
- **Settle open**: any member, voting to settled, only `status` and `winner` change; `winner 'A'` requires `votesA.size() * 2 > memberCount()`, likewise B.
- **Mark paid**: settled to paid, only `status` changes, by the winner's uid (`sideA` if winner A) or admin.

- [ ] **Step 1: Write the failing tests**

```ts
it('member votes A on a voting open bet');                 // assertSucceeds
it('member moves her vote from A to B');                   // assertSucceeds
it('member removes her vote');                             // assertSucceeds
it('cannot vote as someone else or add two keys');         // assertFails x2
it('cannot be in both maps');                              // assertFails
it('cannot vote on an active (not voting) bet');           // assertFails
it('cannot write votesA on an anonymous bet');             // assertFails
it('bettors and subject may vote');                        // assertSucceeds x2
it('settle A succeeds with 4 of 6 for A');                 // assertSucceeds
it('settle A denied with 3 of 6 (tie or short)');          // assertFails
it('settle denied if winner is the side without majority');// assertFails
it('second settle write is denied once status is settled');// assertFails
it('winner marks paid; loser and bystander cannot');       // succeed, fail, fail
it('admin marks paid');                                    // assertSucceeds
it('settle is denied after an admission raises the bar');  // votesA has 4 keys, memberCount 8: assertFails
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:emu`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** per the write shapes.
- [ ] **Step 4: Run to verify pass.** Run: `npm run test:emu`. Expected: PASS.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add firestore.rules.src tests/rules/bets-open-vote.test.ts
git commit -m "Add open-vote, majority settle, and mark-paid rules"
```

---

### Task 5: Rules for anonymous-bet voting and settling

**Files:**
- Modify: `firestore.rules.src`
- Test: `tests/rules/bets-anon-vote.test.ts`

**Interfaces:**
- Produces: write shapes for Task 6's `castAnonVote`, `trySettle` (anonymous).

Write shapes:
- **New anonymous vote** by M (one batch): create `bets/{id}/ballots/M {choice}`, update bet changing only `voters` (adds exactly key M) and `voterCount` (+1), update `tally/counts` by +1 on the chosen side. Each checks the others with `getAfter`/`existsAfter`.
- **Changed anonymous vote**: update ballot choice and tally -1/+1, nothing else.
- **Settle anonymous**: voting to settled, `winner 'A'` requires `get(tally).A * 2 > memberCount()`.
- **Tally read** for members: bet `status in ['settled','paid','void']` or `voterCount == memberCount()`.

- [ ] **Step 1: Write the failing tests**

```ts
it('member casts an anonymous vote with the three-doc batch');       // assertSucceeds
it('cannot vote twice or as someone else');                         // assertFails x2
it('cannot change tally without a matching ballot, or by 2');       // assertFails x2
it('cannot add a voters key without a ballot');                     // assertFails
it('member changes vote, tally moves -1/+1');                       // assertSucceeds
it('member cannot read another ballot; can read her own');          // fail, succeed
it('members cannot read tally mid-vote');                           // assertFails
it('members read tally once all have voted (tie case 3-3)');        // assertSucceeds
it('members read tally after settle');                              // assertSucceeds
it('settle A succeeds with hidden tally 4-1');                      // assertSucceeds
it('settle A denied with hidden tally 3-3');                        // assertFails
it('settle is denied after an admission raises the bar');           // seed tally A=4, memberCount 8 (two admitted mid-vote): assertFails
it('voteStyle cannot change after proposal (member)');              // assertFails
it('admin cannot create a ballot as himself');                      // assertFails
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:emu`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** per the write shapes. Check the per-request `get`/`getAfter` budget (20 for batches); restructure if a test hits the limit.
- [ ] **Step 4: Run to verify pass.** Run: `npm run test:emu`. Expected: every rules test PASS.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add firestore.rules.src tests/rules/bets-anon-vote.test.ts
git commit -m "Add anonymous ballot, hidden tally, and anonymous settle rules"
```

- [ ] **Step 6: Stop gate.** Report to Kyle that the rules prototype passes (or what proved impossible) before starting Task 6.

---

### Task 6: Pure model helpers and the member data layer

**Files:**
- Create: `src/model/tally.ts`, `src/data/joins.ts`, `src/data/bets.ts`
- Test: `tests/unit/tally.test.ts`, `tests/data/joins.test.ts`, `tests/data/bets.test.ts`

**Interfaces:**
- Consumes: types from Task 1; write shapes from Tasks 2 to 5; `dbAs`, `seed` from Task 1 helpers (data tests run against the emulator with rules on).
- Produces (`src/model/tally.ts`):
  - `needed(memberCount: number): number` returns `Math.floor(memberCount / 2) + 1`.
  - `voteProgress(p: { forA: number; forB: number; voterCount: number; memberCount: number; nameA: string; nameB: string; style: VoteStyle }): string`.
  - `owesLine(bet: BetDoc, names: Record<Uid, string>): string` returns `"<loser> owes <winner>: <loser's stake>"`.
- Produces (`src/data/joins.ts`), all `db: Firestore` first:
  - `requestToJoin(db, uid: Uid, displayName: string): Promise<void>`
  - `castJoinVote(db, voter: Uid, applicant: Uid, choice: 'yes'|'no'): Promise<void>` (transaction; reads own ballot to choose new vs change; no-op if unchanged)
  - `tryDecideJoin(db, applicant: Uid): Promise<'approved'|'rejected'|null>` (tries approve batch, then reject batch; `permission-denied` on both returns `null`)
- Produces (`src/data/bets.ts`):
  - `type NewBetInput = { description: string; opponent: Uid; subject: Uid | null; stakeMine: string; stakeTheirs: string; voteStyle: VoteStyle }`
  - `proposeBet(db, me: Uid, input: NewBetInput): Promise<string>` (trims text, returns bet id)
  - `acceptBet(db, betId)`, `declineBet(db, betId)`, `cancelBet(db, betId)`, `callIt(db, betId)`: `Promise<void>`
  - `castOpenVote(db, me, betId, side: Side | null): Promise<void>` (`null` removes)
  - `castAnonVote(db, me, betId, side: Side): Promise<void>` (transaction)
  - `trySettle(db, betId): Promise<Side | null>` (tries A then B; denial or already-settled returns `null`)
  - `markPaid(db, betId): Promise<void>`
  - Every caller of a vote function calls `trySettle` / `tryDecideJoin` right after; the UI does this in Task 9.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/tally.test.ts`

```ts
expect(needed(6)).toBe(4); expect(needed(7)).toBe(4); expect(needed(1)).toBe(1);
expect(voteProgress({ forA: 3, forB: 1, voterCount: 4, memberCount: 6, nameA: 'Maya', nameB: 'Priya', style: 'open' }))
  .toBe('4 of 6 voted. 1 more for Maya settles it.');
expect(voteProgress({ forA: 0, forB: 0, voterCount: 3, memberCount: 6, nameA: 'Maya', nameB: 'Sam', style: 'anonymous' }))
  .toBe("3 of 6 voted. Count shown when it's decided.");
expect(voteProgress({ forA: 3, forB: 3, voterCount: 6, memberCount: 6, nameA: 'Maya', nameB: 'Priya', style: 'open' }))
  .toBe('6 of 6 voted. Tied.');   // tie copy is Claude's call
// 'voteProgress uses the memberCount passed in'
expect(voteProgress({ forA: 3, forB: 0, voterCount: 3, memberCount: 7, nameA: 'Maya', nameB: 'Priya', style: 'open' }))
  .toBe('3 of 7 voted. 1 more for Maya settles it.');
expect(owesLine(betDoc({ status: 'settled', winner: 'A', stakeB: 'a ride to the mall' }), { ava: 'Ava', jo: 'Jo' }))
  .toBe('Jo owes Ava: a ride to the mall');
```

When no side leads (0-0 open), the text is `"<n> of <m> voted."` only.

- [ ] **Step 2: Write the failing data tests** (emulator) in `tests/data/joins.test.ts` and `tests/data/bets.test.ts`

```ts
it('requestToJoin then four yes votes then tryDecideJoin approves; memberCount 7');
it('tryDecideJoin returns null with 3 yes of 6');
it('castJoinVote twice with the same choice leaves tally unchanged; switching moves it');
it('four no votes then tryDecideJoin rejects; user status rejected');
it('proposeBet trims text and returns an id; anonymous creates zero tally');
it('full open flow: propose, accept, callIt, 4 votes A, trySettle -> "A", markPaid by winner');
it('full anonymous flow: 4 anon votes for B, trySettle -> "B", tally readable after');
it('trySettle on an already-settled bet returns null');
it('trySettle with no majority returns null without throwing');
it('declineBet deletes an anonymous bet and its tally');
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:unit` and `npm run test:emu`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement** `tally.ts`, `joins.ts`, `bets.ts` per the signatures. Use `writeBatch` for fixed-shape writes, `runTransaction` where the shape depends on the voter's existing ballot, and `increment()` for tally and counter changes so voters never read hidden counts.

- [ ] **Step 5: Run to verify pass.** Run: `npm test`. Expected: PASS.
- [ ] **Step 6: Commit (ask Kyle first)**

```bash
git add src/model/tally.ts src/data/joins.ts src/data/bets.ts tests/unit tests/data
git commit -m "Add tally helpers and member data layer for joins and bets"
```

---

### Task 7: Admin data layer and member removal

**Files:**
- Create: `src/model/removal.ts`, `src/data/admin.ts`
- Test: `tests/unit/removal.test.ts`, `tests/data/admin.test.ts`

**Interfaces:**
- Consumes: types, `needed()` from Task 6.
- Produces (`src/model/removal.ts`):
  - `type Write = { op: 'set' | 'update' | 'delete'; path: string; data?: Record<string, unknown> }`
  - `type RemovalInput = { uid: Uid; memberCount: number; bets: Array<{ id: string; bet: BetDoc; tally?: BetTally; ballot?: Ballot<Side> }>; joins: Array<{ applicant: Uid; req: JoinRequestDoc; tally: JoinTally; ballot?: Ballot<'yes'|'no'>; voted: boolean }> }` (the `ballot` is the removed member's own, if any)
  - `planRemoval(input: RemovalInput): Write[]`
- Produces (`src/data/admin.ts`):
  - `initGroup(db): Promise<void>` (creates `group/main {memberCount: 0, lastAdmitted: null}` if missing)
  - `adminApprove(db, uid)`, `adminReject(db, uid)`, `clearRejection(db, uid)` (deletes users doc, join request, and its subcollections so she can request again)
  - `removeMember(db, uid): Promise<void>` (reads everything, calls `planRemoval`, commits one batch)
  - `adminEditBet(db, betId, patch: Partial<Pick<BetDoc, 'description'|'stakeA'|'stakeB'|'subject'|'voteStyle'|'status'|'winner'>>)`, `adminDeleteBet(db, betId)`, `adminReopenVote(db, betId)` (settled or paid to voting, `winner null`), `adminClearVote(db, betId, voter)` (removes from maps, or deletes ballot and fixes tally, voters, and `voterCount`), `renameUser(db, uid, displayName)`

`planRemoval` behavior (from the spec's Admin page section):
1. `users/{uid}.status = 'former'`; `memberCount - 1`.
2. Remove her key from `votesA`/`votesB` on bets in voting; for anonymous bets delete her ballot, remove her `voters` key, `voterCount - 1`, and decrement the matching tally field.
3. Same for open join requests (ballot, voters doc, `voterCount`, tally).
4. Bets in `proposed` or `active` where she is `sideA`, `sideB`, or `subject` become `status 'void'`. Bets in voting, settled, or paid stay.
5. Re-tally with the new count: join requests in `createdAt` order (each admission adds 1 to the count used afterwards, and sets `lastAdmitted`), then bets in voting. Emit settle, approve, or reject writes where a majority now exists.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/removal.test.ts`

```ts
it('marks her former and drops memberCount by 1');
it('removes her open vote and her anonymous ballot with matching tally decrement');
it('voids proposed and active bets where she is a side or subject, keeps settled ones');
it('settles a bet that was 3 of 6 for A once the count drops to 5');      // writes status settled, winner A
it('a 3-3 bet becomes 3-2 when her B vote is removed, and settles for A with 5 members');
it('admits a pending girl whose 3 yes now beat 5 members, then uses 5 (not 4) for the bets after');
```

- [ ] **Step 2: Write the failing data tests** (emulator, as admin) in `tests/data/admin.test.ts`

```ts
it('initGroup creates group/main once');
it('adminApprove makes a pending user a member and bumps memberCount');
it('clearRejection lets a rejected user request again');
it('removeMember commits the planned batch; removed user can no longer read bets');
it('adminReopenVote returns a settled bet to voting');
it('adminClearVote on an anonymous bet keeps tally and voterCount consistent');
```

- [ ] **Step 3: Run to verify failure.** Run: `npm test`. Expected: FAIL.
- [ ] **Step 4: Implement** `removal.ts` as a pure function and `admin.ts` on top of it.
- [ ] **Step 5: Run to verify pass.** Run: `npm test`. Expected: PASS.
- [ ] **Step 6: Commit (ask Kyle first)**

```bash
git add src/model/removal.ts src/data/admin.ts tests/unit/removal.test.ts tests/data/admin.test.ts
git commit -m "Add admin actions and member removal with re-tally"
```

---

### Task 8: App shell, sign-in, and screen routing

**Files:**
- Create: `src/firebase.ts`, `src/config.ts`, `src/data/subscriptions.ts`, `src/main.tsx`, `src/ui/App.tsx`, `src/ui/route.ts`, `src/ui/SignIn.tsx`, `src/ui/Pending.tsx`, `src/ui/Blocked.tsx`, `src/ui/Profile.tsx`, `src/styles.css`
- Test: `tests/ui/route.test.ts`

**Interfaces:**
- Consumes: `requestToJoin` (Task 6).
- Produces:
  - `src/config.ts`: `ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL`.
  - `src/firebase.ts`: `app`, `auth`, `db`; connects to the Firestore emulator when `import.meta.env.DEV` and `VITE_USE_EMULATOR === 'true'`. Sign-in uses `signInWithRedirect` with `GoogleAuthProvider`, and `authDomain` comes from `VITE_FIREBASE_AUTH_DOMAIN` (set to the hosting domain per the spec's builder note).
  - `src/data/subscriptions.ts` (Preact hooks over `onSnapshot`): `useAuthUser()`, `useMyUser(uid)`, `useGroup()`, `useMembers()`, `useBets()`, `useJoinRequests()`, `useMyJoinRequest(uid)`, `useBetTally(betId, readable: boolean)`, `useJoinTally(applicant, readable: boolean)`, `useMyBallot(path)`.
  - `src/ui/route.ts`: `type Screen = 'loading'|'signIn'|'chooseName'|'pending'|'blocked'|'home'|'admin'`; `route(s: { authLoading: boolean; email: string | null; isAdmin: boolean; userDoc: UserDoc | null | undefined }): Screen` (`undefined` = still loading).

- [ ] **Step 1: Write the failing test** in `tests/ui/route.test.ts`

```ts
expect(route({ authLoading: true, email: null, isAdmin: false, userDoc: undefined })).toBe('loading');
expect(route({ authLoading: false, email: null, isAdmin: false, userDoc: undefined })).toBe('signIn');
expect(route({ authLoading: false, email: 'k@x', isAdmin: true, userDoc: null })).toBe('admin');
expect(route({ authLoading: false, email: 'a@x', isAdmin: false, userDoc: null })).toBe('chooseName');
expect(route({ ..., userDoc: { status: 'pending', ... } })).toBe('pending');
// 'routes rejected and former to Blocked'
expect(route({ ..., userDoc: { status: 'rejected', ... } })).toBe('blocked');
expect(route({ ..., userDoc: { status: 'former', ... } })).toBe('blocked');
expect(route({ ..., userDoc: { status: 'member', ... } })).toBe('home');
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:unit`. Expected: FAIL.
- [ ] **Step 3: Implement** `route.ts`, then the shell: `SignIn` (brand + one Google button), choose-name form (calls `requestToJoin`, display name defaults to the Google first name), `Pending` (shows `<n> of <m> voted` from `useMyJoinRequest` and `useGroup`), `Blocked` (`"You're not in the group right now. Ask Kyle if you think this is a mistake."`), `Profile` (edit own display name, 1 to 30 chars). The admin gets a link to the admin page; the admin page itself is built in Task 10.
- [ ] **Step 4: Run to verify pass.** Run: `npm test`. Expected: PASS. Then `npm run dev` with emulator and sign in through the Auth emulator to confirm the screens route.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add src tests/ui/route.test.ts
git commit -m "Add app shell, Google sign-in, and screen routing"
```

---

### Task 9: Home screen, bet cards, join request cards, new bet form

**Files:**
- Create: `src/ui/Home.tsx`, `src/ui/BetCard.tsx`, `src/ui/JoinRequestCard.tsx`, `src/ui/NewBet.tsx`, `src/ui/sections.ts`
- Test: `tests/ui/sections.test.ts`, `tests/ui/NewBet.test.tsx`, `tests/ui/BetCard.test.tsx`

**Interfaces:**
- Consumes: Task 6 data functions and `voteProgress`/`owesLine`; Task 8 hooks.
- Produces:
  - `sections(me: Uid, bets: Array<{ id: string; bet: BetDoc }>): { needsYou; voting; active; settled; proposedByMe }` (`needsYou` = proposed where `sideB == me`; `settled` includes `paid`, shown greyed; `void` hidden).
  - `NewBet` props: `{ me: Uid; members: Array<{ uid: Uid; displayName: string }>; onSubmit(input: NewBetInput): Promise<void> }`.
  - `BetCard` props: `{ id; bet; me; names; memberCount; tally?: BetTally; myVote?: Side | null; actions }`. `actions` bundles the Task 6 functions; after any vote the card calls `trySettle`.
  - `JoinRequestCard` props: `{ applicant; req; myVote?: 'yes'|'no'; memberCount; onVote(choice) }`. After voting, calls `tryDecideJoin`.

Home layout follows the spec mockup: header `WHITE ICE CREAM BETS` with `+ New Bet`, then sections in order JOIN REQUESTS, NEEDS YOU, VOTING, ACTIVE, SETTLED. Empty sections are hidden. Each voting card shows its style tag `(open)` / `(anonymous)`; anonymous cards show `Voted: <names>` instead of dots.

Long text (Claude's call, since descriptions can run to 2000 chars and stakes to 500): on the home list, descriptions clamp to 3 lines and stakes to 2 lines, with a `more` toggle that expands the card in place. Line breaks the girls type are preserved, and long unbroken words wrap instead of overflowing. The form uses multi-line text boxes with a live `n / 2000` (or `n / 500`) counter that appears once they're within 100 characters of the limit.

- [ ] **Step 1: Write the failing tests**

```ts
// sections.test.ts
it('puts proposed bets where I am side B in needsYou, and mine in proposedByMe');
it('hides void bets; settled lists unpaid bets first, then paid');
// NewBet.test.tsx
it('greys out the chosen subject in the opponent picker');              // option disabled
it('excludes me from opponent and allows me as neither');               // me not in opponent options
it('pre-fills their stake to match mine until edited');
it('Propose bet is disabled for whitespace-only description');
it('submits trimmed NewBetInput with the chosen voteStyle');            // default 'open'
it('stops input at 2000 chars for description and 500 per stake, counter shows near the limit');
// BetCard.test.tsx
it('shows Accept and Decline only to side B on a proposed bet');
it('shows Call it on an active bet');
it('shows the owes line and Mark paid only to the winner on a settled bet');
it('anonymous voting card shows who voted and the hidden-count text');
it('a 2000-char description is clamped with a more toggle that expands it');
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:unit`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and wire `Home` in `App.tsx` with the Task 8 hooks. Tally hooks subscribe only when readable (bet decided, or `voterCount == memberCount`), so the app never triggers permission errors on hidden tallies.
- [ ] **Step 4: Run to verify pass.** Run: `npm test`. Expected: PASS. Then run the app against the emulator with three test accounts and walk one open and one anonymous bet from proposal to paid.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add src/ui tests/ui
git commit -m "Add home screen, bet and join cards, and new bet form"
```

---

### Task 10: Admin page

**Files:**
- Create: `src/ui/Admin.tsx`
- Test: `tests/ui/Admin.test.tsx`

**Interfaces:**
- Consumes: every function in `src/data/admin.ts` (Task 7), `markPaid` (Task 6).
- Produces: `Admin` props `{ users: Array<{ uid; doc: UserDoc }>; bets; joinRequests; memberCount; actions }`.

Sections: Members (rename, Remove with a typed-name confirmation in the page itself, never `window.confirm`), Pending requests (Approve, Reject), Rejected (Clear), Bets (edit fields, delete, reopen vote, clear a vote, mark paid). A "Set up group" button appears only when `group/main` is missing.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows Set up group only when group is missing');
it('Remove requires typing the member name before it calls removeMember');
it('lists pending requests with Approve and Reject wired to adminApprove/adminReject');
it('shows Reopen vote on settled bets and Mark paid on unpaid settled bets');
```

- [ ] **Step 2: Run to verify failure.** Run: `npm run test:unit`. Expected: FAIL.
- [ ] **Step 3: Implement** `Admin.tsx`; the admin route reads all users and bets (the admin may read everything).
- [ ] **Step 4: Run to verify pass.** Run: `npm test`. Expected: PASS. Manually remove a test member in the emulator and confirm her open bets are void and a pending vote re-tallies.
- [ ] **Step 5: Commit (ask Kyle first)**

```bash
git add src/ui/Admin.tsx tests/ui/Admin.test.tsx src/ui/App.tsx
git commit -m "Add admin page"
```

---

### Task 11: Home-screen install, styling pass, and deploy setup

**Files:**
- Create: `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, `README.md`
- Modify: `index.html`, `src/styles.css`

**Interfaces:**
- Consumes: the whole app.

- [ ] **Step 1: Add the manifest** (`name "White Ice Cream Bets"`, `short_name "WIC Bets"`, `display "standalone"`, theme colors from `styles.css`) and link it plus `apple-touch-icon` and `apple-mobile-web-app-capable` meta tags in `index.html`. No service worker (not needed for add-to-home-screen; YAGNI).
- [ ] **Step 2: Styling pass.** Phone-first at 375px wide, fun ice-cream palette, tap targets at least 44px, readable on desktop with a centered max-width column.
- [ ] **Step 3: Write `README.md`** with Kyle's one-time setup: create the Firebase project (Spark), enable Google sign-in, create Firestore, enable Hosting, copy config to `.env.local` (set `VITE_FIREBASE_AUTH_DOMAIN` to `<project>.web.app`), add `https://<project>.web.app/__/auth/handler` to the OAuth client's authorized redirect URIs, set `VITE_ADMIN_EMAIL`, run `npm test`, then `firebase deploy`. Then sign in as admin, press "Set up group", and approve the founding members.
- [ ] **Step 4: Verify the build.** Run: `npm run rules && npm run build`. Expected: `firestore.rules` generated with the admin email, `dist/` built with no type errors.
- [ ] **Step 5: Manual phone check (Kyle, after deploy).** On an iPhone: open the site in Safari, Add to Home Screen, open from the icon, sign in with Google, and confirm it lands on the waiting or home screen. Repeat on one Android phone. Record the result in the PR description.
- [ ] **Step 6: Commit (ask Kyle first)**

```bash
git add public index.html src/styles.css README.md
git commit -m "Add home-screen install, styling, and setup guide"
```
