# School Ballon d'Or 2026 voting

The voting app is a React/Vite site. It can be hosted on Vercel or Firebase Hosting. Firebase Anonymous Authentication gives each browser profile a persistent voting account. A callable Cloud Function validates the nominee and uses a Firestore transaction to create that account's one-time vote lock and increment an aggregate total. The chosen nominee is never stored alongside the voter ID.

The React/Vite app is the only web application in this repository. Firebase Cloud Functions provide the trusted voting and admin operations.

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

Students vote without a visible login. Firebase silently creates a persistent anonymous session for the browser. The admin dashboard uses a password verified by a callable Cloud Function; the password is stored as a Firebase Functions secret and is never embedded in the frontend.

1. Set a unique random administrator password of at least 32 characters as a Firebase Functions secret:

   ```powershell
   firebase functions:secrets:set ADMIN_PASSWORD
   ```

   Enter the password at the CLI prompt. Vite environment files are not used by deployed Functions. Do not put the password in frontend variables, source files, or chat. For local emulator testing, copy `functions/.secret.local.example` to `functions/.secret.local` and replace the example value with a long random password.
2. Open `/admin` and enter the password. The function checks it server-side and returns a short-lived HMAC-signed admin session, held only in browser memory. A callable function checks that session and returns aggregate totals; the browser is never granted direct results access. Failed sign-in attempts are limited per source IP. This avoids Firebase custom-token signing and does not require the service account Token Creator role.

## Run with Firebase emulators

Follow local setup steps 4–5. Emulator data is separate from production. To use the emulator UI, enable it in `firebase.json` and use the port printed by the Firebase CLI.

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
4. Vercel deploys only the frontend. The Firebase project must separately have the `castVote`, `authenticateAdmin`, and `getAdminResults` Cloud Functions deployed, the Firestore rules deployed, and the `ADMIN_PASSWORD` Functions secret configured. Configure these once from a Firebase CLI account with access to the project:

   ```powershell
   firebase use school-ballon-d-or
   firebase functions:secrets:set ADMIN_PASSWORD
   firebase deploy --only firestore:rules,functions
   ```

5. Trigger a new Vercel deployment after changing its environment variables. Test `/vote`, `/admin`, refresh/deep links, anonymous voting, and admin results on the Vercel URL. Do not cast test votes against production.

### Deploy everything with Firebase Hosting

Install Firebase CLI if necessary, select the project, build the frontend, then deploy:

```powershell
firebase use school-ballon-d-or
npm run build
firebase deploy --only firestore:rules,functions,hosting
```

Firebase Functions deployment requires the project to have billing enabled. Hosting serves `dist/` and rewrites page routes such as `/admin` to the React entry point. Callable functions run in `us-central1` with Firebase-managed Admin credentials; no downloaded service-account key or Token Creator role is needed. The admin password is read from the `ADMIN_PASSWORD` Functions secret. For production, enable Firestore TTL on the `adminLoginAttempts.expiresAt` field so expired rate-limit records are automatically removed.

## Privacy and voting limits

- `devices/{anonymousUid}` contains only a vote lock and server timestamp. A signed-in voter may read only their own lock.
- `results/{nomineeId}` contains aggregate vote totals. Direct client reads and writes are denied; the vote and admin-results callable functions use the Admin SDK.
- Individual nominee selections are not retained with voter IDs, and the admin dashboard does not display voter IDs.
- Anonymous Firebase accounts identify a browser profile, not a physical device or student. Clearing browser/app data, using private browsing, or switching browsers can create another account and permit another vote. Managed/verified student identities are needed to guarantee one vote per person.

The two nominees without supplied images, Government and Thoni (Respect), display initials. The supplied images for the other nominees are reused from `public/`.

## Secret hygiene

Any administrator password previously shared in chat must be considered compromised. Choose a new random password before enabling production admin access, and store it only in Firebase Functions Secret Manager. Keep local emulator secrets and service-account credentials out of version control.
