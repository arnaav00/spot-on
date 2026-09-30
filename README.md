# Spot On!

A mobile-first multiplayer party game where friends choose cards for the player in the spotlight, who then ranks the choices. Built with Next.js, React, Firebase Realtime Database, and Firebase Hosting.

## Features

- Live rooms for 3–6 players
- Rotating spotlight turns and cumulative scoring
- Touch-friendly card selection, reshuffling, ranking, and animated reveals
- Configurable game count and optional themed expansions
- Session restoration after refreshing or briefly disconnecting

## Run locally

Requires Node.js 22 or newer.

1. Create a Firebase web app and Realtime Database.
2. Add the Firebase web configuration to a local `.env` file using the variables referenced in `lib/firebase.ts`.
3. Install and start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Use separate browser profiles or private windows to test multiple players.

## Build and deploy

```bash
npm run build
firebase deploy --only hosting:spot-on,database
```

The Firebase project and Hosting target are configured in `.firebaserc` and `firebase.json`. Local environment files are excluded from Git.

## Useful commands

```bash
npm run lint
npm run rooms:wipe -- --confirm
```

The wipe command permanently removes all rooms from the configured Realtime Database.
