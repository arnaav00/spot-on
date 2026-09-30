import { getApps, initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { logEvent, logWarn } from "./debug";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function isDatabaseRoot(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const isFirebaseHost =
      url.hostname.endsWith(".firebaseio.com") ||
      url.hostname.endsWith(".firebasedatabase.app");
    return url.protocol === "https:" && isFirebaseHost && ["", "/"].includes(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export const firebaseReady = Boolean(
  firebaseConfig.apiKey && isDatabaseRoot(firebaseConfig.databaseURL) && firebaseConfig.projectId,
);

const appName = "spot-on-web";
const app = firebaseReady
  ? getApps().find((candidate) => candidate.name === appName) ?? initializeApp(firebaseConfig, appName)
  : null;

export const db = app
  ? getDatabase(app, firebaseConfig.databaseURL)
  : null;

if (firebaseReady && firebaseConfig.databaseURL) {
  logEvent("firebase.ready", {
    projectId: firebaseConfig.projectId,
    databaseHost: new URL(firebaseConfig.databaseURL).hostname,
    appName,
  });
} else {
  logWarn("firebase.not_ready", {
    hasApiKey: Boolean(firebaseConfig.apiKey),
    hasProjectId: Boolean(firebaseConfig.projectId),
    hasValidDatabaseRoot: isDatabaseRoot(firebaseConfig.databaseURL),
  });
}
