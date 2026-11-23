# White Ice Cream Bets

A small phone-first web app for the White Ice Cream group to log friendly bets, vote on who won, and keep track of who owes what. It runs on Firebase's free Spark plan: Google sign-in, Firestore, and Hosting. There are no Cloud Functions; the security rules in `firestore.rules.src` enforce every vote and majority.

## What you need

- Node 20 or newer
- Java 11 or newer (the Firestore emulator needs it for the tests)
- The Firebase CLI, which is already a dev dependency (`npx firebase ...`). Run `npx firebase login` once.

## One-time setup (Kyle)

1. **Create the Firebase project.** In the [Firebase console](https://console.firebase.google.com/), add a project. Call it whatever you like; below it's `<project>`. Stay on the free Spark plan and don't add a card.
2. **Turn on Google sign-in.** Build > Authentication > Get started > Sign-in method > Google > Enable. Pick a support email and save.
3. **Create Firestore.** Build > Firestore Database > Create database. Production mode, any nearby location.
4. **Turn on Hosting.** Build > Hosting > Get started. You can click through the CLI steps; this repo already has `firebase.json`.
5. **Register a web app.** Project settings > General > Your apps > Add app > Web. You don't need Firebase Hosting setup from this screen. Copy the config values it shows.
6. **Make `.env.local`.** Copy `.env.example` to `.env.local` (it's git-ignored) and fill it in:

   ```
   VITE_ADMIN_EMAIL=<your google email>
   VITE_FIREBASE_API_KEY=<apiKey>
   VITE_FIREBASE_AUTH_DOMAIN=<project>.web.app
   VITE_FIREBASE_PROJECT_ID=<project>
   VITE_FIREBASE_APP_ID=<appId>
   VITE_USE_EMULATOR=false
   ```

   Use `<project>.web.app` for the auth domain, **not** the `<project>.firebaseapp.com` value the console shows. Sign-in from Safari and from an iPhone home-screen icon breaks when the auth domain differs from the site's domain.

   `VITE_ADMIN_EMAIL` is the one Google account that gets the admin page. The admin is never a member and never votes.
7. **Allow the sign-in redirect.** Open [Google Cloud console > APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials) for the same project. Edit the OAuth 2.0 client named "Web client (auto created by Google Service)". Under **Authorized redirect URIs**, add:

   ```
   https://<project>.web.app/__/auth/handler
   ```

   Save. It can take a few minutes to take effect.
8. **Check the authorized domain.** Authentication > Settings > Authorized domains should list `<project>.web.app`. Add it if it's missing.
9. **Point the CLI at your project.** `.firebaserc` uses the placeholder project `demo-wicb` (used by the emulator tests). Run:

   ```
   npx firebase use --add <project>
   ```

   and give it the alias `default` when asked, or edit `.firebaserc` by hand.
10. **Run the tests** (see below). They should all pass before the first deploy.
11. **Deploy.**

    ```
    npx firebase deploy
    ```

    This runs `npm run rules` (writes `firestore.rules` with your admin email from `.env.local`) and `npm run build`, then uploads the site and the rules. The site is at `https://<project>.web.app`.

## First run

1. Open `https://<project>.web.app` and sign in with the admin email. You land on the admin page.
2. Press **Set up group**. This creates the group record (member count 0).
3. Have the founding members open the site, sign in with Google, and pick a name. Each one shows up under **Pending requests**.
4. Approve each founding member from the admin page. After that, new people are voted in by the group, and you can still approve or reject directly.

## Tests

```
npm test
```

This runs the unit and screen tests, then the security-rules and data tests inside the Firestore emulator. It needs Java 11 or newer on your PATH. It never uses your real email: the rules for tests are generated with a fixed test admin address.

To run only the fast tests: `npm run test:unit`. To run one emulator file: `npm run test:emu -- tests/rules/joins.test.ts`.

## Running locally against the emulators

1. In `.env.local`, set:

   ```
   VITE_USE_EMULATOR=true
   VITE_FIREBASE_PROJECT_ID=demo-wicb
   ```

   (Any non-empty API key and app ID work against the emulators.)
2. Generate the rules: `npm run rules`.
3. In one terminal:

   ```
   npx firebase emulators:start --only auth,firestore --project demo-wicb
   ```

4. In another terminal: `npm run dev`, then open the address Vite prints. The auth emulator shows a fake Google sign-in page where you can type any email, including the admin one.

Set `VITE_USE_EMULATOR` and the project ID back before you deploy. The emulator switch only works in dev builds, so a production build never talks to the emulators.

## Updating the icon

The home-screen icon is drawn in `public/icon.svg`. After editing it, run `npm run icons` to regenerate `icon-192.png`, `icon-512.png`, and `apple-touch-icon.png`.

## Phone check after deploy (Kyle)

No automated test can cover home-screen sign-in, so check it by hand after each deploy that touches sign-in:

- [ ] iPhone: open `https://<project>.web.app` in Safari, tap Share > Add to Home Screen.
- [ ] Open it from the new icon. It opens full-screen with no Safari bar.
- [ ] Sign in with Google. It comes back to the app and lands on the waiting screen (new person) or the home screen (member).
- [ ] Android: open the site in Chrome, menu > Add to Home screen (or Install app), open from the icon, sign in, and confirm the same.
- [ ] Note the results in the PR description.

## Known limits

- **Anonymous votes aren't perfectly secret.** Members can see who has voted, and the counts appear the moment a vote is decided. A determined member watching closely (for example with browser dev tools open) can often guess who cast the deciding vote and which way it went. The rules stop anyone from reading another girl's ballot directly.
- **The admin can see everything** in the Firebase console, including every anonymous ballot. The app keeps them hidden from members, not from whoever owns the project.
- One group per site. No notifications, no email, no money handling: "owes" is just a note between friends.
- The free Spark plan has daily read and write limits. A friend group won't come close, but a script hammering the site could hit them for the day.
