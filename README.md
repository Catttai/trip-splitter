# Trip Splitter

A small web app for Shinyi, Shilya, Aichen and Cat to log trip expenses and see,
live, who owes who how much.

- Anyone with the link can add, edit or delete expenses from their own phone.
- Everyone's screen updates instantly as expenses change.
- Everything is saved, so nothing needs retyping. A half-filled form is kept too.
- Split each expense equally among whoever was part of it, or enter exact amounts.
- Tap an expense to edit or delete it.
- "Who owes who" uses as few payments as possible.

Trip settings (names, currency) are in `config.js`.

## One-time setup (about 10 minutes)

### 1. Create the shared database (Firebase, free)

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Create a project**, name it `trip-splitter`. You can turn Google Analytics off.
3. In the left menu open **Build → Firestore Database** and click **Create database**.
   Pick a location near you, then choose **Start in production mode**.
4. Open the **Rules** tab, replace everything with the contents of
   [`firestore.rules`](firestore.rules), and click **Publish**.
5. Click the gear icon → **Project settings**. Under **Your apps**, click the
   web icon `</>`, name it `trip-splitter`, and click **Register app**
   (leave Firebase Hosting unticked).
6. Copy the `firebaseConfig` object it shows, open `config.js` in this repo,
   and replace `null` in `FIREBASE_CONFIG = null` with it:

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: '...',
     authDomain: '...',
     projectId: '...',
     storageBucket: '...',
     messagingSenderId: '...',
     appId: '...',
   };
   ```

   These values are meant to be public; the rules from step 4 are what protect the data.

### 2. Put the site online (GitHub Pages)

1. In this repo on GitHub open **Settings → Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**,
   branch **main**, folder **/ (root)**, and click **Save**.
3. After a minute the site is live at `https://<your-username>.github.io/trip-splitter/`.
   Send that link to everyone.

The line under the title shows **Live. Shared with everyone.** once the database
is connected. Until then it says **Saved on this device only**.

## Notes

- The link is the only "password": anyone who has it can edit. Don't post it publicly.
- To start a new trip later, change `TRIP_ID` in `config.js`. The old trip's data stays in Firebase.
- To change the currency, edit `CURRENCY` in `config.js` (e.g. `'SGD'`, `'MYR'`, `'EUR'`).
