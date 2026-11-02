import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "firebase/app-check";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const firebaseEnvironmentNames = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
};

export const missingFirebaseConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => firebaseEnvironmentNames[key]);

const app = missingFirebaseConfig.length === 0
  ? initializeApp(firebaseConfig)
  : null;
const emulatorSetting = import.meta.env.VITE_USE_FIREBASE_EMULATORS;
const useEmulators = emulatorSetting === "true"
  || (emulatorSetting !== "false" && import.meta.env.DEV);
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;

if (app && !useEmulators && appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, "us-central1") : null;
export const authReady = auth
  ? setPersistence(auth, browserLocalPersistence)
  : Promise.resolve();

if (app && useEmulators) {
  const emulatorHost = window.location.hostname || "127.0.0.1";
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, emulatorHost, 8080);
  connectFunctionsEmulator(functions, emulatorHost, 5001);
}
