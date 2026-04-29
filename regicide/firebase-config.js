// ══════════════════════════════════════════════════════════════
//  Firebase configuration – fill in your project details below.
//
//  SETUP (one-time, ~5 minutes):
//
//  1. Go to https://console.firebase.google.com
//  2. Create a new project (no Analytics needed).
//  3. Left menu → Build → Realtime Database → Create database
//     • Start in TEST mode (or use the rules below).
//  4. Left menu → Project settings → General → Your apps → Web app (</>)
//     • Register the app, copy the firebaseConfig object.
//     • Paste the values into window.FIREBASE_CONFIG below.
//  5. In Realtime Database → Rules tab, paste:
//
//     {
//       "rules": {
//         "rooms": {
//           "$roomId": {
//             ".read": true,
//             ".write": true
//           }
//         }
//       }
//     }
//
//  6. Commit this file to GitHub and deploy.
//  Note: these rules let anyone with the 6-char room code read/write
//  that room – fine for a private game between friends.
// ══════════════════════════════════════════════════════════════

window.FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
