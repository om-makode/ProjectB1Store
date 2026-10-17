# NearKart mobile app

Expo (SDK 58) + React Native + TypeScript app: customer app, store mode and admin (also builds for web).
See the root [README](../README.md) for setup.

| Script                                            | What it does                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `npm start`                                       | Metro dev server for the dev build (`--dev-client`)              |
| `npm run android` / `npm run ios`                 | Build and install the dev build locally                          |
| `npm run web`                                     | Run in the browser                                               |
| `npm run lint` / `npm run typecheck` / `npm test` | Quality checks (also run in CI)                                  |
| `npm run format`                                  | Prettier                                                         |
| `npm run gen:types`                               | Regenerate `src/types/database.ts` from the local Supabase stack |
