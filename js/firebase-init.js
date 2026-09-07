// Firebase config is safe to commit: it identifies the project to Firebase's
// client SDK, it does not grant access on its own. Actual access control
// lives in Firestore Security Rules (see firestore.rules in this repo),
// not in this file.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = window.__FIREBASE_CONFIG__;

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
