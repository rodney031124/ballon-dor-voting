# School Ballon d'Or 2026 voting

The voting app is a React/Vite site. Firebase Anonymous Authentication gives each browser profile a persistent voting account. In production on Vercel, a same-origin API verifies the Firebase ID token and uses a Firestore transaction to create that account's one-time vote lock and increment an aggregate total. The chosen nominee is never stored alongside the voter ID. Local development uses the Firebase callable function emulator.

The React/Vite app is the only web application in this repository. Vercel API routes provide production voting and admin operations; Firebase Cloud Functions support emulator development and optional Firebase Hosting deployments.

## Local setup

1. In Firebase Console for `school-ballon-d-or`, enable **Anonymous** sign-in under Authentication, create the Firestore database, and add `localhost` to Authentication's authorized domains if needed.
2. Copy `.env.example` to `.env.development.local` and set the Firebase web app configuration. Leave `VITE_USE_FIREBASE_EMULATORS` blank for local development; Vite uses the local emulators by default. Set it to `false` only when intentionally connecting a development server to the live Firebase project. Production builds default to the live Firebase services unless this variable is explicitly set to `true`. Firebase App Check with reCAPTCHA v3 is optional; if enabled, set `VITE_FIREBASE_APPCHECK_SITE_KEY` to its site key. The Firebase web API key and App Check site key are public client configuration, not secrets. Never put a service-account JSON file or admin password in the React app.
3. Install the frontend and Cloud Function dependencies:

   ```powershell
   npm install
   npm --prefix functions install
   ```

4. Create `functions/.secret.local` from `functions/.secret.local.example` and set a local-only `ADMIN_PASSWORD` of at least 32 characters. Keep the value quoted, especially if it contains `#`, so dotenv does not treat the rest of the password as a comment. Then start the Firebase emulators:

   ```powershell
   firebase emulators:start --only auth,firestore,functions --project school-ballon-d-or
   ```

5. In another terminal, start the React app:

   ```powershell
   npm start
   ```

   Open the Vite URL printed in the terminal (normally `http://localhost:5173`). Local votes and admin sign-ins stay out of production.
## Admin access

Students vote without a visible login. Firebase silently creates a persistent anonymous session for the browser. The admin dashboard uses a password verified server-side by the Vercel API; the password is stored in a private Vercel environment variable and is never embedded in the frontend. Local emulator development uses a Firebase Functions secret.

1. In production, set `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and `FIREBASE_SERVICE_ACCOUNT_B64` as **private Vercel Production environment variables**. `FIREBASE_SERVICE_ACCOUNT_B64` is the base64-encoded Firebase service-account JSON for this project. Never use a `VITE_` prefix for these server-only values or commit the service-account key.

   `ADMIN_PASSWORD` must contain at least 32 characters. Generate a separate random value of at least 32 characters for `ADMIN_SESSION_SECRET`. The deployed Vercel API validates the password server-side, rate-limits attempts, and issues a short-lived HttpOnly session cookie. Results are read server-side; the browser is never granted direct results access.
2. Open `/admin` and enter the administrator password. For local emulator development, copy `functions/.secret.local.example` to `functions/.secret.local` and use `npm start`; local development calls the Firebase Functions emulator.

## Run with Firebase emulators

Follow local setup steps 4–5. Emulator data is separate from production. To use the emulator UI, enable it in `firebase.json` and use the port printed by the Firebase CLI. Local vote submissions call the `castVote` emulator.

## Build and deploy

### Deploy the frontend to Vercel

1. Push the project to a Git provider and import it into Vercel. Use the project root as the Root Directory; Vercel uses `vercel.json` to run `npm run build`, publish `dist/`, and serve React routes such as `/admin` and `/vote`.
2. In Vercel project settings, add these environment variables for **Production** (and Preview if previews should use Firebase):

   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

   Use the Web app config from the Firebase project. These `VITE_` values are public client configuration; do not add `ADMIN_PASSWORD`, session secrets, voter secrets, or service-account credentials to Vercel frontend variables. Leave `VITE_USE_FIREBASE_EMULATORS` unset for production.
3. Before opening the deployed site, in Firebase Console enable Anonymous sign-in and add the Vercel production domain (for example, `your-project.vercel.app`) to Authentication's authorized domains. If App Check is enabled, register the Vercel domain with the configured provider too.
4. Vercel builds the React frontend and deploys the `api/*` server endpoints. The production vote endpoint verifies the anonymous Firebase ID token, then atomically writes the vote lock and aggregate result using the Firebase service account. The same private service-account variable described in **Admin access** is used by voting and admin endpoints. No Firebase Functions deployment is required for Vercel voting.

   ```powershell
   git push
   ```

5. Trigger a new Vercel deployment after changing its environment variables. Test `/vote`, `/admin`, refresh/deep links, and admin results on the Vercel URL. Use Firebase emulators or a staging project to test vote submission; do not cast test votes against production.

### Deploy everything with Firebase Hosting

For Firebase Hosting, enable the callable-function vote path when building, select the project, and deploy:

```powershell
firebase use school-ballon-d-or
$env:VITE_USE_FIREBASE_VOTE_FUNCTION = "true"
npm run build
firebase deploy --only firestore:rules,functions,hosting
```

Firebase Functions deployment requires the project to have billing enabled. Hosting serves `dist/` and rewrites page routes such as `/admin` to the React entry point. Callable voting functions run in `us-central1` with Firebase-managed Admin credentials. Vercel deployments should leave `VITE_USE_FIREBASE_VOTE_FUNCTION` unset so votes use `/api/vote`. For production, enable Firestore TTL on the `adminLoginAttempts.expiresAt` field so expired rate-limit records are automatically removed.

## Privacy and voting limits

- `devices/{anonymousUid}` contains only a vote lock and server timestamp. A signed-in voter may read only their own lock.
- `results/{nomineeId}` contains aggregate vote totals. Direct client reads and writes are denied; production vote and admin-results API routes use the Admin SDK. The local callable function emulator uses the Admin SDK too.
- Individual nominee selections are not retained with voter IDs, and the admin dashboard does not display voter IDs.
- Anonymous Firebase accounts identify a browser profile, not a physical device or student. Clearing browser/app data, using private browsing, or switching browsers can create another account and permit another vote. Managed/verified student identities are needed to guarantee one vote per person.

The two nominees without supplied images, Government and Thoni (Respect), display initials. The supplied images for the other nominees are reused from `public/`.

## Secret hygiene

Any administrator password previously shared in chat must be considered compromised. Choose a new random password before enabling production admin access, and store it only in Firebase Functions Secret Manager. Keep local emulator secrets and service-account credentials out of version control.
