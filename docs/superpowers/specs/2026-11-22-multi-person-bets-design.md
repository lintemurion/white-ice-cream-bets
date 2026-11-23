# Multi-Person Bets: Design

Date: 2026-11-22
Owner: Kyle
Issue: #4
Builds on: `2026-11-22-white-ice-cream-bets-design.md` (the base design). Everything there still holds unless this doc changes it.

## Intent

The group's first request after launch: bets with more than two people. A bet can be about several people, and each side can have several people, including teammates on the proposer's side. People can join, switch, or leave a bet until everyone on it has said they're in, and a bet can go out as an open challenge that anyone can take.

Success: the group can make the bets they actually make in real life ("Mac and Kaden bet Jo can't do 50 pushups") in one bet, and nobody can use the new freedom to cheat.

## Goals

- **Several people per side.** Side A starts with the proposer and any teammates they add; side B starts with whoever the proposer names, or nobody (an open challenge). (Kyle's decisions.)
- **Several subjects.** "About someone?" becomes "About anyone?": zero or more people the bet is about. (Kyle's decision.)
- **Subjects are never on a side.** The people a bet is about can't be on either side, at creation or by joining or switching later. (Kyle's decision; unchanged rule from the base design, now applied to lists.)
- **Added without asking, but free to leave.** Being named on a side doesn't need your agreement up front. While the bet is proposed, anyone on a side can switch to the other side or leave. (Kyle's decision.)
- **Anyone can join.** Any member who isn't a subject can join either side while the bet is proposed. (Kyle's decision.)
- **Open challenges.** A bet can be proposed with nobody on side B. (Kyle's decision; the proposer can't be a subject, which the subject rule already guarantees.)
- **Everyone named confirms, then sides lock.** Each person on a side either taps **I'm in** or leaves. The proposer and anyone who joins or switches are in automatically. The bet becomes active when everyone on both sides is in and both sides have at least one person. From then on nobody can join, switch, or leave. (Kyle's decision, after the builder check showed two problems with "one acceptance is enough, move until voting": people could switch to the winning side after the result was known, and people could be locked into a bet they never saw. This replaces Kyle's earlier answer that one acceptance from side B is enough.)
- **Combined stakes.** Each side has one stake ("a pizza", "$10"), owed as a group by the losing side to the winning side. Joining a side means sharing that side's stake, not adding a new one. (Kyle's decision on combined stakes; Claude's call that the amount doesn't change as people join.)
- **Paid by each winner.** Each person on the winning side marks that they've been paid. The bet becomes paid when the last winner has. (Kyle's decision.)

## Non-goals

- Per-person stakes or splitting amounts. Anyone who wants "$5 each" writes that in the stake text.
- Joining, changing sides, or leaving once the bet is active.
- Subjects removing themselves.
- Inviting people from outside the group. Every person on a bet is a current member.
- Changes to voting, majorities, anonymity, or join votes. Bettors and subjects still vote, exactly as today.

## Anti-goals

- Anyone moving, adding, or removing **someone else** on a bet (except the admin).
- A subject ending up on a side by any path (create, join, switch, admin edit).
- Someone who isn't a current member on a side or as a subject.
- A bet changing who is on it once it's active (outside admin removal), which would let people switch to the winning side after the outcome is known.
- A bet becoming active while anyone on it hasn't confirmed.
- Marking someone else as "in".
- A loser, a bystander, or a subject marking a winner as paid, or one winner marking another winner as paid.
- A bet stuck as "proposed" or "active" with an empty side.

## Constraints

- Free Spark plan, Firestore rules only, no server code (unchanged).
- Rules have no loops and a per-request lookup limit (10 for a single write, 20 for a batch). Team membership must be checkable in one lookup.
- Tests first for every rules change, per `docs/DEVELOPING.md`.
- Deploys happen on merge to `main`. The rules and app ship together.
- Kyle's git rules: feature branch `feature/multi-person-bets`, his yes on every commit, he merges.

## Approaches considered (how a team is stored)

1. **Lists per side (chosen by Kyle).** `sideA` and `sideB` are lists of member ids, `subjects` is a list. Joining, leaving, and switching add or remove only your own id; Firestore's `arrayUnion`/`arrayRemove` merge simultaneous joins. The winning side is just a list, so "paid when every winner has marked it" is a direct check.
2. **One map of person to side.** Simpler "only your own entry changed" checks, but rules can't extract "everyone on side A" from a map, so the paid check would need hand-maintained counts. Rejected.
3. **A record per participant.** Rules can't count records, so they couldn't tell when a side is empty. Rejected.

## How it works

### Bet fields (changed)

| Field | Before | After |
|---|---|---|
| `sideA` | one id | list of ids (proposer first) |
| `sideB` | one id | list of ids, may be empty |
| `subject` | one id or null | replaced by `subjects`: list of ids, may be empty |
| `confirmed` | (none) | list of people on a side who are in; starts as the proposer |
| `paidBy` | (none) | list of winners who have marked paid; starts empty |
| `createdBy` | proposer | unchanged; the proposer stays the creator even if they leave |

Everything else (description, stakes, vote style, votes, tally, ballots, status, winner) is unchanged.

**Size cap:** at most 8 distinct people across `sideA`, `sideB`, and `subjects` combined. (Claude's call, to stay inside the rules' limits.) No list has duplicates, and no person appears in more than one of the three lists.

### Current member list

A new document `group/members` holds a map of current member ids. Only members and the admin can read it. (Claude's call; `group/main` is readable by people waiting to join, and the member list doesn't need to be.)

- Admission (group vote or admin approve) adds the new member's id in the same batch that sets them to member and adds 1 to `memberCount`. The rules check all three move together, the same way they already tie the member update to `memberCount`.
- Removal (admin) removes the id.
- The rules check "everyone named on this bet is a current member" with one read of this document.

### Lifecycle

**Proposing.** The proposer must be in `sideA`. `sideB` may be empty (open challenge). `subjects` may be empty. All named people are current members; no subject is on a side; within the size cap. `confirmed` is exactly `[proposer]`. Status `proposed`.

**While proposed**, any member can:
- **Join** a side, if they aren't on the bet already and aren't a subject. They're added to the side and to `confirmed`.
- **Switch** to the other side, if they're on a side. They're added to `confirmed` (acting counts as being in).
- **Leave**, if they're on a side. They're removed from the side and from `confirmed`.
- **I'm in**, if they're on a side and not yet confirmed. Adds them to `confirmed`.

Each of these changes only the acting person's own id, and the rules enforce that.

**Becoming active.** The write that leaves every person on both sides in `confirmed`, with both sides non-empty, must also set status `active`; a bet can't be `active` otherwise. (So an open challenge goes active when someone joins side B, provided everyone on side A is in.)

**If a move empties side A, the bet is cancelled** (status `void`) in the same write. Side B may be empty while proposed (it's then an open challenge). (Claude's call.) Members no longer delete bets: today's Decline and Cancel become Leave, and a cancelled bet is `void`, which is already hidden. (Claude's call: one way to end a bet, no tally-delete coordination.)

**Once active, sides are locked.** Nobody can join, switch, leave, or change `confirmed`. **Calling it** (`active` → `voting`), voting, and settling are unchanged.

**Paid.** After a bet settles, each winner taps **I got paid**, which adds their own id to `paidBy`. The rules allow this only for people on the winning side, only their own id, and only once. The write that adds the last winner also sets status `paid`. The admin can mark any winner as paid (needed if a winner is removed from the group).

### Removal (admin)

When the admin removes a member (in addition to what removal does today):
- On `proposed` bets: take them off any side, `confirmed`, and `subjects`. If that empties side A, the bet is cancelled (`void`). If it leaves everyone remaining confirmed with both sides non-empty, the bet becomes `active`, as if they'd left. (Claude's call; today such bets are always voided, which would be too harsh when only one of several people is removed.)
- On `active` bets: take them off their side and `subjects`. If that empties a side, the bet is cancelled (`void`). (Claude's call; the admin is the only one who can change an active bet's sides, and only through removal.)
- On bets in voting, settled, or paid: they stay on the sides as recorded, like today. Their votes are removed and open votes re-counted, like today.
- If they're a winner who hasn't marked paid, the admin can mark it for them.
- They're removed from `group/members`.

### Admin edits

The admin can edit the description, stakes, and subjects (with the same rules: subjects are current members, never on a side). The admin can't edit sides from the admin page; members manage sides themselves, and the admin can delete a bet. (Claude's call.)

As today, the admin's writes are not limited by these rules; `src/data/admin.ts` checks them (subjects not on a side, current members, size cap) and has tests for it. The admin is trusted per the base design, and holding the admin to the rules would block removal, which deliberately leaves removed members on bets in voting or settled, and the one-time data upgrade. (Claude's call, after the builder check.)

### Converting existing data

The new rules expect the new fields and `group/members`. After this ships:
- The admin page shows a one-time **Upgrade data** button while anything needs converting. It builds `group/members` from users with status member, and converts any old-format bets (`sideA` → `[sideA]`, `sideB` → `[sideB]`, `subject` → `subjects`, add `paidBy`, with all winners in `paidBy` for bets already paid). (Claude's call.)
- Until Kyle presses it, members can't propose bets (the member list doesn't exist yet). Kyle presses it right after the deploy. There are no bets yet, so in practice it only builds the member list.

### Screens

New bet form (follows the base design's mockup):

```
 New Bet
 What's the bet?   [Kaden can do 50 pushups]
 About anyone?     (Kaden ×) [+ add]        (optional)
 My side:          Mac (you) (+ add)
 Against:          [+ add]   (leave empty for an open challenge)
 If my side loses:    [a pizza]
 If their side loses: [a pizza]
 Votes:            (•) Open  ( ) Anonymous
 [Propose bet]
```

Subjects are greyed out in both side pickers and vice versa. The form stops at 8 people.

Bet card, before voting:

```
 Kaden can do 50 pushups            (open)
 About: Kaden
 Mac & Jo  vs  (open challenge)
 a pizza vs a pizza
 Waiting on: Jo                           <- people not yet in
 [Join Mac's side] [Join other side]      <- someone not on the bet
 [I'm in] [Switch sides] [Leave]          <- someone named, not yet in
 [Switch sides] [Leave]                   <- someone already in
```

These buttons show only while the bet is proposed. "Needs you" lists proposed bets where you're named and not yet in.

Names join with "&"; long sides show the first two and "+N". Vote buttons read "<side names> won". Settled: "Jo & Kayla owe Mac & Kaden: a pizza", with **I got paid** for winners who haven't, and "Paid: 1 of 2" until all have.

### Integrity requirements (new; all enforced in rules, all tested against cheating attempts)

- Only you can add, move, or remove yourself on a side, or mark yourself in, and only while the bet is proposed.
- Joining or switching onto a side is refused if you're a subject.
- `confirmed` only ever holds people on a side. A bet is `active` only if every person on both sides is in `confirmed` and both sides are non-empty, and the write that completes that must set `active`.
- Once active, `sideA`, `sideB`, `confirmed`, and `subjects` don't change through member writes.
- Everyone on a bet is a current member (one read of `group/members`).
- The 8-person cap and no-duplicates hold after every write.
- Side A is never empty on a `proposed` bet; the write that empties it must also cancel the bet.
- Only a winner can add themselves to `paidBy`; `paid` is set exactly when `paidBy` covers the winning side.
- `group/members` changes only through admission (together with the member update and `memberCount`) or the admin.

## Left to the builder

- Exact rules expressions (list/set operations) and test names.
- How the form's multi-pickers look and behave, within the sketch.
- How "+N" truncation works.
- Whether `memberCount` stays a stored number or is checked against `group/members` size (it must stay consistent either way).
- How the Upgrade data button detects what needs converting.
