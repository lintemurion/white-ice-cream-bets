# White Ice Cream Bets

A small phone-first web app for the White Ice Cream group to log friendly bets, vote on who won, and keep track of who owes what. It runs on Firebase's free Spark plan: Google sign-in, Firestore, and Hosting. There are no Cloud Functions; the security rules in `firestore.rules.src` enforce every vote and majority.

## What you need

- Node 22.12 or newer (Vitest 5 needs `^22.12.0 || ^24.0.0`; Node 24 works)
- Java 21 or newer (firebase-tools 15 refuses to start the emulators on older Java)
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
9. **Set up automatic deploys.** Follow [Automatic deploys](#automatic-deploys) below. `.env.local` (step 6) is then only needed for running or deploying from your own computer.

## Automatic deploys

GitHub Actions deploys the site. Nobody runs deploy commands by hand.

- **Every pull request:** `.github/workflows/ci.yml` runs all the tests and the build. It never touches Firebase.
- **Every push to `main`** (so every merged pull request), and **Actions > Deploy > Run workflow** on any branch: `.github/workflows/deploy.yml` runs the same tests, then deploys the site, the security rules, and the Firestore indexes to Firebase. A manual run from a branch deploys **that branch** to the live site; the next push to `main` puts `main` back.

Deploys sign in to Google Cloud without a key (Workload Identity Federation): Google Cloud trusts GitHub Actions runs from this repository only, and each run gets a short-lived token. Nothing secret is stored in GitHub.

### One-time setup

1. **Run the setup script in Google Cloud Shell.** Open [shell.cloud.google.com](https://shell.cloud.google.com) (signed in as the project owner). Upload [`scripts/setup-github-deploy.sh`](scripts/setup-github-deploy.sh) with the three-dot menu > Upload, then run `bash setup-github-deploy.sh`. Run it as a file; don't copy its lines into the terminal, because its strict error settings would close the Cloud Shell session on the first error. It enables the APIs, creates a `github-deploy` service account with only the deploy roles, and sets up the trust for `lintemurion/white-ice-cream-bets`. It's safe to re-run. At the end it prints two lines: `WIF_PROVIDER=...` and `WIF_SERVICE_ACCOUNT=...`.
2. **Add seven repository variables.** On GitHub: Settings > Secrets and variables > Actions > **Variables** tab > New repository variable. These are variables, not secrets: the Firebase web config is public by design.

   | Variable | Value |
   |---|---|
   | `FIREBASE_PROJECT_ID` | `projectId` from the web app config |
   | `FIREBASE_API_KEY` | `apiKey` from the web app config |
   | `FIREBASE_APP_ID` | `appId` from the web app config |
   | `FIREBASE_AUTH_DOMAIN` | `<project>.web.app` (not the `firebaseapp.com` value) |
   | `ADMIN_EMAIL` | `<your google email>` |
   | `WIF_PROVIDER` | printed by the setup script |
   | `WIF_SERVICE_ACCOUNT` | printed by the setup script |

3. **Deploy.** Merge to `main`, or go to Actions > Deploy > Run workflow and pick a branch. The site is at `https://<project>.web.app`.

If a variable is missing, the deploy stops at "Check required variables" and names it. `firebase deploy` rebuilds the site and runs `npm run check-bundle` on exactly what it's about to upload (this also covers hand deploys); it stops the deploy if the site contains test settings (`demo-wicb`, the test admin email, or the auth emulator address).

**If a deploy fails with a permission error,** the error names the missing permission or role. Add that role to the service account in Cloud Shell:

```
gcloud projects add-iam-policy-binding <project> --member="serviceAccount:github-deploy@<project>.iam.gserviceaccount.com" --role=<role>
```

### Deploying by hand (emergency only)

From your own computer, with `.env.local` filled in and `npx firebase login` done:

```
npm test
npx firebase deploy --project <project>
```

`firebase.json` runs `npm run rules` (your admin email from the environment or `.env.local`, lowercased) and `npm run build` first. Always pass `--project`: `.firebaserc` deliberately points at the fake `demo-wicb` project used by the tests.

## First run

1. Open `https://<project>.web.app` and sign in with the admin email. You land on the admin page.
2. Press **Set up group**. This creates the group record (member count 0).
3. Have the founding members open the site, sign in with Google, and pick a name. Each one shows up under **Pending requests**.
4. Approve each founding member from the admin page. After that, new people are voted in by the group, and you can still approve or reject directly.

## Tests

```
npm test
```

This runs the unit and screen tests, then the security-rules and data tests inside the Firestore emulator. It needs Java 21 or newer on your PATH. It never uses your real email: the rules for tests are generated with a fixed test admin address.

To run only the fast tests: `npm run test:unit`. To run one emulator file: `npm run test:emu -- tests/rules/joins.test.ts`.

## Running locally against the emulators

Keep the emulator settings out of `.env.local`. That file feeds `npm run rules` and every production build, so emulator values there could deploy a site pointed at the fake `demo-wicb` project.

1. Make `.env.development.local` (git-ignored). Vite loads it only for `npm run dev`, and its values override `.env.local`:

   ```
   VITE_USE_EMULATOR=true
   VITE_FIREBASE_PROJECT_ID=demo-wicb
   VITE_FIREBASE_AUTH_DOMAIN=127.0.0.1
   VITE_FIREBASE_API_KEY=demo-key
   VITE_FIREBASE_APP_ID=demo-app
   VITE_ADMIN_EMAIL=admin@example.test
   ```

   (Any non-empty API key and app ID work against the emulators.)
2. In one terminal, start the emulators:

   ```
   npm run emulators
   ```

   This writes the test rules (`node scripts/build-rules.mjs --test`, which uses `admin@example.test` and writes `.emulator/firestore.rules`) and starts the auth emulator on port 9099 and Firestore on 8080, using `firebase.dev.json`. It never touches your real `firestore.rules`.
3. In another terminal:

   ```
   npm run dev -- --host 127.0.0.1
   ```

   Open **http://127.0.0.1:5173**, not `localhost`. The auth emulator runs on 127.0.0.1, and sign-in silently comes back signed out when the page is on `localhost`. Pass `--host` explicitly; on Windows Vite otherwise listens on `localhost` only.
4. The auth emulator shows a fake Google sign-in page where you can type any email. Use `admin@example.test` for the admin page.

The emulator switch only works in dev builds, so a production build never talks to the emulators, and `npm run build` and `npm run rules` never read `.env.development.local`.

## Updating the icon

The home-screen icon is drawn in `public/icon.svg`. After editing it, run `npm run icons` to regenerate `icon-192.png`, `icon-512.png`, and `apple-touch-icon.png`.

## Phone check after deploy (Kyle)

No automated test can cover home-screen sign-in, so check it by hand after each deploy that touches sign-in:

- [ ] iPhone: open `https://<project>.web.app` in Safari, tap Share > Add to Home Screen.
- [ ] Open it from the new icon. It opens full-screen with no Safari bar.
- [ ] Sign in with Google. It comes back to the app and lands on the waiting screen (new person) or the home screen (member).
- [ ] Android: open the site in Chrome, menu > Add to Home screen (or Install app), open from the icon, sign in, and confirm the same.
- [ ] After the first deploy only: do one real anonymous bet vote, one real join vote, and one admin approval, to confirm the rules work on the live project.
- [ ] Note the results in the PR description.

## Known limits

- **Anonymous votes aren't perfectly secret.** Members can see who has voted, and the counts appear the moment a vote is decided. A determined member watching closely (for example with browser dev tools open) can often guess who cast the deciding vote and which way it went. The rules stop anyone from reading another girl's ballot directly.
- **The admin can see everything** in the Firebase console, including every anonymous ballot. The app keeps them hidden from members, not from whoever owns the project.
- One group per site. No notifications, no email, no money handling: "owes" is just a note between friends.
- The free Spark plan has daily read and write limits. A friend group won't come close, but a script hammering the site could hit them for the day.
