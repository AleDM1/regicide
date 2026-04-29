// ══════════════════════════════════════════════════════════════
//  Firebase configuration – formato compat CDN (no build tool).
//
//  NOTA: la apiKey è pubblica per design in Firebase.
//  La sicurezza è gestita dalle Security Rules nel database,
//  non nascondendo la chiave.
//
//  Aggiorna le Security Rules entro il 29/05/2026:
//  Realtime Database → Rules → incolla:
//  {
//    "rules": {
//      "rooms": {
//        "$roomId": { ".read": true, ".write": true }
//      }
//    }
//  }
// ══════════════════════════════════════════════════════════════

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC0JmNaGKmYgx-ClABMvvuDd-a8ExtDc0c",
  authDomain:        "regicide-dddd9.firebaseapp.com",
  databaseURL:       "https://regicide-dddd9-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "regicide-dddd9",
  storageBucket:     "regicide-dddd9.firebasestorage.app",
  messagingSenderId: "901172808180",
  appId:             "1:901172808180:web:316b30e1aa6ff3fd5dd1a1",
};
