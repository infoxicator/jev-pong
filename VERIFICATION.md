# Verification record

Verified locally on 2026-11-12 with **Node.js 24.14.0**. No live provider key was used. No remote, push, publish, or deploy was performed.

The execution environment exposes different default Node versions inside and outside the command sandbox, so permissioned commands explicitly selected Node 24:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH npm run verify
```

This completed successfully, running these exact package commands in sequence:

| Command | Result |
| --- | --- |
| `npm run build` | PASS: strict TypeScript check and Vite production build |
| `npm test` | PASS: 2 Vitest files, 9 tests, real headless Chromium |
| `npm run test:provider` | PASS: actual SDK over local HTTP; valid structured action; 429, malformed answer, and 1500 ms timeout fall back visibly; no retries; provider selection checked |
| `npm run test:e2e` | PASS: 1 Playwright scenario, 23.3 seconds; production server, three separate contexts, 686 authoritative frames, point scored 0:1 after a 13-hit rally, 112/98 left/right agent intent messages, reconnect preserved score |

The e2e also verified that spectators send no agent requests or intents, duplicate seats become spectators, live paddles move in response to accepted intents, replay enters/exits, title card opens, reset clears score, a 480px window has no horizontal overflow, and the full layout fits at 1280×800. It reported zero browser page errors. A final `npm run build` also typechecked the provider-verification script after expanding the TypeScript include list.

Launcher verification:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH PORT=5178 JEV_MOCK=1 npm run demo:smoke
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH PORT=5178 JEV_MOCK=1 npm run demo:smoke -- --headed
```

Both passed: three independent Chromium sessions opened, both player sockets connected, mock decision cards appeared, the game entered play, and HTTP health was OK. The second run exercised visible desktop app windows and window positioning. Both smoke runs closed their own windows and server successfully.

Dev-server reachability:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH npm run dev
curl --fail --silent http://127.0.0.1:5177/health
curl --fail --silent -o /dev/null -w '\nGET / → HTTP %{http_code}\n' http://127.0.0.1:5177/
```

PASS: health returned `ok: true`, `mode: mock`, `physicsHz: 120`, `snapshotHz: 30`, Node `24.14.0`, and an advancing tick. The page returned HTTP 200. The shared browser also loaded the app and its local fonts successfully. The verification server was stopped afterward so `npm run demo` can own the default port.

The initial default-port attempt found an unrelated app on 5173. This demo was moved to 5177; that app was left untouched. Vite HMR was moved to game port + 1000 to avoid another default-port collision. An early physics test fixture incorrectly put a ball beyond the left boundary while moving right; correcting the velocity produced the expected score. The final complete suite above passed.

A direct scan of the built JavaScript found no `TypeSafeClient`, `apiKey`, provider key environment variable names, or TypeSafe API endpoint. `.env.local.example` is tracked; `.env.local` and all actual environment files are ignored. `git remote -v` was empty.

Visual artifacts from the final Playwright run are under:

```text
test-results/arena-two-independent-brow-56f8c--match-replay-and-reconnect/
  arena-live.png
  arena-scored.png
  title-card.png
  narrow-window.png
  laptop-window.png
```

These images were inspected for layout and readability. Test artifacts are intentionally ignored in Git.

## Limits

Offline verification establishes that the integration uses the installed official SDK correctly against a documented HTTP response fixture and that the complete game works in mock mode. A paid Jev call through OpenRouter or Vercel was not made. Provider key validity, model availability, real latency, playing strength, and upstream billing require a real key. The configured provider remains visible while individual failures are labeled as fallback.

## Run it

```sh
npm run demo
```

From a new checkout: Node 22+, `npm ci`, then the command above. No key is needed. See README.md and .env.local.example to enable real Jev decisions.
