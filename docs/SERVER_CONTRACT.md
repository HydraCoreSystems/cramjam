# CramJam server contract (client side is built, server is Lotus's)

Base URL lives in one place: `SERVER_BASE` in `src/core/links.ts` (https://cramjam-server.vercel.app).
Every call is JSON over POST. Once the student has signed in with Apple, every call carries
`Authorization: Bearer <Apple identity token>`. The client refreshes the token and retries once on 401.
Calls time out on the client; a timeout or network failure shows the honest "could not reach the server" state and spends nothing.

## POST /v1/build
Request: `{ fingerprint, text, courseName, examDate }` (`examDate` is an ISO date string or null).
One call is one Study Build. The client spends a build only after it has received and validated a usable response.
Response (the client is lenient about key names and kind aliases, see `src/core/build.ts`):
- `title`
- `summary`: sections of text, or one string
- `cards`: `[{ front, back, topic, source }]`
- `questions`: `[{ kind, topic, prompt, answer, reason, source, options?, pairs? }]`
  - `kind`: mcq, tf, short, fill, match. mcq needs `options` and the answer must be one of them. match needs `pairs: [{ left, right }]`.
  - `source`: a pointer to the exact place in the material: string, or `{ label, quote, start, end }`.
- `facts`: `[{ kind: formula|date|definition|name|fact, label, value, source }]`
- `likely`: `[{ topic, prompt, outline, source }]`. The app always labels these as predictions.
Questions without a prompt or answer, or an mcq whose answer is not among its options, are dropped. A response with nothing usable is treated as a bad response and spends nothing.

## POST /v1/syllabus
Request: `{ text }`. Response: `{ items: [ { kind, label, date, weight, detail } ], courseName? }`.
`kind` is one of exam, quiz, assignment, grading, material, officeHours, topic, note (common aliases are mapped). `date` is ISO or null. `weight` is a percent number or null.
The client shows every item on an editable confirmation screen, saves only on confirm, and never spends a build here, on either tier.
Note for Lotus: the contract has no course name field. The client accepts an optional `courseName` and otherwise guesses from the text, and the student can edit it.

## POST /v1/ask
Request: `{ mode, question, chunks }`, `mode` is teachback, tutor, or simpler. `chunks` are the most relevant passages from the student's own builds, picked on device.
Response: `{ answer, sourcePointers }`. Empty answers are treated as bad responses. When the endpoint cannot be reached the app says so and shows nothing else. There is no local grading or tutoring.

## Status codes the client understands
401/403 sign in again. 402/429 allowance reached. Any other non 2xx is a server problem. All of them spend nothing.

## Privacy copy
The app says plainly, where material is picked, that the text of a syllabus or study material is sent to CramJam's server for generation.

## Dev mock
`src/dev/mockServer.ts` answers all three endpoints only when `__DEV__` and `EXPO_PUBLIC_MOCK_GENERATION=1`. The guard is inline in `src/services/apiFactory.ts`, and a production Hermes bundle contains none of the mock.
