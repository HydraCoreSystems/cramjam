# CramJam

Expo SDK 58 app that turns a syllabus and student material into an exam campaign.

## Run

```
npm install
npm test
npm run typecheck
npm run start
```

## Layout

- `src/core`: pure logic and the app store (state layer, persistence, gates, SRS, syllabus, plans, API client). Runs under vitest with in memory fakes.
- `src/services`: device ports (Apple sign in, StoreKit, notifications, OCR, sharing, speech, Keychain).
- `src/app`: expo-router screens. `src/components`: shared UI.
- `docs/SERVER_CONTRACT.md`: what the client sends and expects from the server.

## Rules kept

Product IDs live only in `src/core/entitlement.ts`. The server base URL lives only in `src/core/links.ts`. There is no fake entitlement path. The dev mock needs a development build and `EXPO_PUBLIC_MOCK_GENERATION=1`. `eas.json` is untouched.

Student material goes to the server for generation and the app says so where it is sent. Studying built material is always free.
