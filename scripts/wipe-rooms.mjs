import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

if (!process.argv.includes("--confirm")) {
  console.error("This deletes every room. Run: npm run rooms:wipe -- --confirm");
  process.exit(1);
}

const envText = await readFile(resolve(process.cwd(), ".env"), "utf8");
const fileEnv = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);

const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? fileEnv.NEXT_PUBLIC_FIREBASE_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("NEXT_PUBLIC_FIREBASE_DATABASE_URL is missing from .env.");
}

const root = new URL(databaseUrl);
const isFirebaseDatabase = root.protocol === "https:"
  && (root.hostname.endsWith(".firebaseio.com") || root.hostname.endsWith(".firebasedatabase.app"))
  && ["", "/"].includes(root.pathname)
  && !root.search
  && !root.hash;

if (!isFirebaseDatabase) {
  throw new Error("NEXT_PUBLIC_FIREBASE_DATABASE_URL must be the root URL of a Firebase Realtime Database.");
}

const rootHref = root.href.endsWith("/") ? root.href : `${root.href}/`;
const roomsUrl = new URL("rooms.json", rootHref);
const existing = await fetch(`${roomsUrl.href}?shallow=true`);

if (!existing.ok) {
  throw new Error(`Could not inspect rooms (${existing.status} ${existing.statusText}). Check your Realtime Database rules.`);
}

const rooms = await existing.json();
const roomCount = rooms && typeof rooms === "object" ? Object.keys(rooms).length : 0;

if (roomCount === 0) {
  console.log("No rooms to delete.");
  process.exit(0);
}

const removed = await fetch(roomsUrl, { method: "DELETE" });

if (!removed.ok) {
  throw new Error(`Could not delete rooms (${removed.status} ${removed.statusText}). Check your Realtime Database rules.`);
}

console.log(`Deleted ${roomCount} room${roomCount === 1 ? "" : "s"} from ${root.hostname}.`);
