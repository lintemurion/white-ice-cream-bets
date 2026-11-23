# White Ice Cream Bets: Design

Date: 2026-11-22
Owner: Kyle (admin)

## Intent

"White Ice Cream" is a friend group (Kyle's daughter and her friends, all over 21). They make friendly bets with each other and want one shared place to log them, decide who won, and keep track of who owes what. Each girl uses her own phone and needs to see the same live list.

Success: the girls actually use it instead of losing track of bets in group texts, and nobody can cheat their way to a win.

## Goals

- Any member can propose a bet with custom stakes.
- Everyone in the group sees the same list, updated live.
- Winners are decided by majority vote of the group.
- A person who is the subject of a bet (controls the outcome) cannot be a party to it.
- New members join by group vote.
- Kyle has an admin view to fix problems, and is not counted as a member.

## Non-goals (first version)

- No push notifications or email. They check the site or text each other.
- No real money moves through the site. It only records what is owed.
- No removing members by vote. Kyle removes members as admin.
- No multiple groups. One site, one group.
- No native app store app. It is a web app they can add to their home screen.

## Anti-goals

- A member being able to declare herself the winner, vote twice, vote as someone else, or let a friend in without a vote. If that is possible from the browser (dev tools, editing requests), the site has failed even if the UI looks right.
- Anyone outside the group being able to see or change anything.
- Monthly costs or a credit card on file for a kids' hobby site, unless Kyle decides otherwise (see Open question 1).

## Constraints

- Platform: Firebase (Kyle's choice). Firebase Authentication with Google sign-in, Cloud Firestore, Firebase Hosting.
- Google sign-in only. All users are adults (21+).
- Phone-first layout; must also work on desktop.
- Group size is small (around 6 to start; design for up to ~20).

## Approaches considered

1. **Firebase** (chosen). Google sign-in, database, and hosting in one place; live updates; integrity rules enforced server-side. Trade-offs: vendor lock-in, and Firestore security rules are fiddly to write.
2. **Supabase + Netlify.** Regular Postgres database, easier to export. Rejected: free projects pause after a week of inactivity, which a sporadically used bet site would hit.
3. **Own small server** (e.g., Node on a cheap host). Full control. Rejected: costs a few dollars a month and Kyle would have to maintain and secure it.

Kyle picked Firebase.

## How it works

### People and roles

- **Member:** a signed-in Google account that has been approved into the group. Can create bets, accept bets, vote on bet outcomes, vote on join requests, mark stakes as paid.
- **Pending:** signed in with Google but not yet approved. Sees only a "waiting to join" screen showing their request's vote progress. Sees no bets.
- **Admin (Kyle):** identified by a fixed email address in configuration. Not a member: cannot bet, cannot vote, and is never counted in any majority. Has an admin page (below).
- **Stranger:** anyone else. Sees only the sign-in screen.

Each member has a display name (defaults to their Google first name, editable by them) used everywhere in the UI.

### Bets

A bet has:

- **Description**: free text, e.g. "Jo gets her license before March."
- **Two sides**, each one member. (Decided by Claude: one person per side for v1. Kyle did not object when this was proposed.)
- **What each side owes if they lose**: free text, e.g. "$5", "a friendship bracelet", "a ride to the mall". Stakes are set per bet. (Claude's call: each side has its own stakes field, pre-filled to match the other, since a lot of bets are uneven, e.g. "$5 vs. a ride".)
- **Subject** (optional): a member the bet is about who controls the outcome. The subject cannot be either side. The form greys the subject out of the side pickers, and this must also be enforced in the database rules. Bets about things nobody controls (weather, sports) have no subject.
- **Vote style**: open or anonymous, picked by the creator when proposing (Kyle's decision). The other side sees it before accepting. It can't be changed once proposed, except by the admin. (Claude's call on the lock, so nobody switches styles mid-vote.)
- **Created by** and timestamps.

Vote styles (Kyle's decision on who picks; the mechanics are Claude's proposal):

- **Open:** everyone can see who voted which way, and the running count shows live.
- **Anonymous:** members can see *who* has voted but not *which way*. Each voter's choice is in a private ballot that only she (and the admin) can read, so she can see and change her own vote. The yes/no counts stay hidden until the bet settles or every current member has voted, because a live count would reveal each vote as it lands. Known limits, accepted: whoever casts the deciding vote can be guessed by someone watching closely, and Kyle can see every ballot in the Firebase console.

  **Known limit, accepted by Kyle (2026-11-22): anonymity is not proof against a determined member.** The Task 5 review found that a member who writes her own database requests from the browser's developer tools can recover the hidden count by trial and error. The rules must check each new count against the old one, so a guessed count is rejected and the right one accepted. Combined with watching who votes when, that can reveal how each person voted. This applies to anonymous bets and to join votes. It cannot be closed on the free Spark plan; it would take a server-side tally (Blaze plan + Cloud Functions). It does **not** let anyone change an outcome: voting twice, voting as someone else, faking the count, and settling without a true majority all stay blocked. In practice, "anonymous" means the app never shows how anyone voted, not that it's impossible to find out.

Bet lifecycle:

1. **Proposed.** A member creates the bet. The creator must be one of the two sides. (Claude's call, so nobody can drop a bet onto two other people.)
2. **Active.** The other side accepts. She can also decline, which deletes it. (Claude's call, so nobody can be signed up for a bet she didn't agree to.) The creator can cancel a proposed bet.
3. **Voting.** Any member taps "Call it," which opens the vote. Every member gets one vote: side A won or side B won. Bettors and the subject vote too. Members can change their vote while voting is open.
4. **Settled.** As soon as one side has votes from more than half of current members, the bet is settled for that side. Ties or too few votes keep it open. Settled bets show "X owes Y: <stakes>". On an anonymous bet the final counts are revealed at settlement. If every member has voted and there's still no majority (a tie), the counts are revealed and the bet stays open until someone changes her vote or the admin steps in. (Claude's call.)
5. **Paid.** The winner marks the stakes as delivered. (Claude's call: the person owed confirms, not the person who owes.)

"Current members" means the member count when the vote is tallied, excluding the admin. (Claude's call; with a small stable group, snapshotting at vote-open adds complexity for little benefit. Builder may revisit.)

### Joining the group

1. A new person signs in with Google. She becomes Pending and is asked for a display name.
2. Members see the join request on their main screen and vote yes or no. Join votes are always anonymous (Kyle's decision), working the same way as anonymous bets. The person waiting to join sees only how many have voted ("3 of 6 voted"), never who voted which way, and the rules must keep that true even if she opens dev tools.
3. More than half of current members voting yes makes her a member. More than half voting no rejects the request (she sees a "not approved" message and can't re-request; admin can clear that).
4. Admin can approve or reject a request directly.

Founding members: Kyle adds the first members from the admin page (by approving their pending requests after they sign in), since there is no one yet to vote.

### Admin page

Visible only to the admin email. Lets Kyle:

- See all members and pending requests.
- Approve or reject a pending request directly.
- Remove a member. Removal is a soft delete: she becomes a "former member" and is fully blocked, seeing the same screen as a rejected join request (Kyle's decision; he'll revisit if it becomes a problem). Her votes and ballots on bets still being voted on, and on join requests, are removed. Proposed and active bets where she's a side or the subject are voided. Settled bets and debts she owes or is owed stay visible to members. Kyle marks paid any debt owed *to* her from the admin page, and the person who owes still sees the debt. Open votes are re-tallied as part of the removal, since the majority bar drops.
- Mark any settled bet paid.
- Edit or delete any bet.
- Reopen a settled bet's vote, or clear a vote.
- Edit display names.

### Screens

```
 WHITE ICE CREAM BETS          [+ New Bet]
 ─────────────────────────────────────────
 JOIN REQUESTS
 Riley wants to join    3 of 6 voted   [Yes] [No]
 NEEDS YOU
 Maya proposed: "Snow before Dec 1"  $5 vs $5  (anonymous)
                                     [Accept] [Decline]
 VOTING
 Jo gets her license before March   (open)
 Maya vs Priya          Maya won ●●●○  Priya won ●○○○
 4 of 6 voted. 1 more for Maya settles it.   [Vote]
 Snow before Dec 1                  (anonymous)
 Maya vs Sam            Voted: Ava, Jo, Priya
 3 of 6 voted. Count shown when it's decided. [Vote]
 ACTIVE
 Ava vs Sam  "Ava finishes the book first"   [Call it]
 SETTLED
 Ava beat Jo  "Jo can't do 20 pushups"
   Jo owes Ava: a ride to the mall          [Mark paid]
```

```
 New Bet
 What's the bet?  [Jo gets her license before March]
 About someone?   [Jo ▾]          (optional)
 Me vs:           [Priya ▾]       (Jo greyed out)
 If I lose:       [a ride to the mall]
 If Priya loses:  [a ride to the mall]
 Votes:           (•) Open  ( ) Anonymous
 [Propose bet]
```

Also: sign-in screen, pending/waiting screen, admin page, a simple profile spot to change display name.

## Integrity requirements

These must hold even against a member editing requests from the browser:

- Only members can read bets, members, and join requests. Pending users can read only their own request.
- A user can only cast votes as herself, one per bet or join request.
- Only members can vote. The admin cannot vote at all; the rules reject it. (Claude's call, to resolve an earlier wording that allowed admin votes that "never count".)
- The subject of a bet cannot be a side.
- Only the non-creator side can accept a proposed bet.
- A bet becomes settled, and a pending user becomes a member, only when a true majority of members has voted for it (or the admin did it).
- Only the winner (or admin) can mark a bet paid.
- Former members can read and write nothing.
- On anonymous bets and all join requests: no member can read another member's ballot; nobody (except the admin) can read the counts before the vote is decided or everyone has voted; and the pending user can't learn who voted which way. (Direct reads are blocked; trial-and-error writes can still reveal counts. See the accepted known limit under Vote styles.)
- The vote style of a bet can't be changed after it's proposed, except by the admin.

## Decision: free plan, rules-enforced majority

Kyle chose to stay on the free **Spark** plan with no card on file and no Cloud Functions, with the majority made tamper-proof in Firestore security rules.

Options considered:
- (a) Blaze plan + Cloud Functions do the tally. Simplest and clearly tamper-proof, but needs a card on file. Not chosen.
- (b) **Spark plan, rules enforce the majority.** Chosen.
- (c) Spark plan, browser does the tally. Rejected: breaks the anti-goal.

How (b) works (builder's starting point, to be proven first):
- Each bet stores its votes as two maps, `votesA` and `votesB`, keyed by voter uid. Join requests do the same with `votesYes` and `votesNo`. Rules allow a member to add, move, or remove only her own uid's entry.
- A `memberCount` field (e.g., on a single group doc) that the rules keep accurate: it can change only through an admin action or through an admission the rules have verified, checked with `getAfter` in the same transaction or batch.
- Rules allow a bet to become settled for side A only if `votesA.size() > memberCount / 2` (and likewise for B), and a pending user to become a member only if `votesYes.size() > memberCount / 2`.
- Re-tally on member removal (see Admin page) is done by the admin's removal transaction.

Anonymous votes (open bets use the maps above; anonymous bets and all join requests use this instead):
- Each voter's choice is a private ballot document readable only by her and the admin.
- Hidden yes/no (or A/B) counts live in a separate document whose read rule allows the admin always, and members only once the vote is decided or the number of voters equals `memberCount`. A public list of who has voted (no choices) drives the "3 of 6 voted" display.
- Votes update the counts with `FieldValue.increment`, so the client never needs to read them. The rules use `getAfter` to check that the ballot write and the count change match: +1 on a new vote, -1/+1 on a changed vote, nothing else.
- Settling is a separate write that the rules allow only if the hidden counts show a majority. The deciding voter's client tries it after voting, and any member's client can retry it.
- Admin removal deletes the removed member's ballots and decrements the matching counts in the same transaction.

**First task in the plan:** prototype these rules and test them against the Firebase emulator, including attempts to cheat (voting as someone else, settling without a majority, inflating or shrinking `memberCount`, admitting without votes, reading another member's anonymous ballot, reading hidden counts early, a pending user finding out who voted no, and changing a count without a matching ballot). Build the rest of the app only once that passes. If a rule turns out to be impossible on Spark, stop and bring it back to Kyle rather than quietly falling back to (c).

## Left to the builder

- Front-end framework and styling (keep it light; a single-page app is fine).
- Exact Firestore data layout.
- Visual design, as long as it's phone-first and fun. The group name "White Ice Cream" is the brand.
- Making it installable to the home screen (web app manifest).
- How the admin email is configured.
- Testing approach, including tests for the security rules against the Firebase emulator.

Builder note (Claude's call): Google sign-in can fail in Safari and in iPhone home-screen apps when the site is served from `*.web.app` but the Firebase `authDomain` is `*.firebaseapp.com`. Set `authDomain` to the hosting domain (or follow Firebase's current redirect-sign-in guidance) and test sign-in from an iPhone home-screen icon.
