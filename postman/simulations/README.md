# Provider simulations

Stand-ins for the two paid decision APIs, served by `postman simulation` (CLI 1.70+) behind a local
HTTPS proxy. The game keeps its shipped base URLs (`https://api.typesafe.ai`, `https://api.openai.com`);
the proxy answers for those hosts, so nothing in `server/` or `src/` changes to use them.

| Simulation | Jev (`jev-systemone`) | Luna (`luna-decisions`) | Use it to |
| --- | --- | --- | --- |
| `jev-luna-providers` | 164 ms latency | 285 ms latency | run live mode with no quota |
| `jev-luna-degraded` | hangs 1700 ms (client times out at 1500 ms) | 2 requests/min, then `429` + `Retry-After` | exercise fallbacks and cooldowns |

The stand-ins (`postman/mocks/*/default.js`) answer only from what the request serializes. They do not
imitate either model, so **a score earned against them says nothing about Jev or Luna**. Use them for
plumbing; compare the models only with a live run.

What is and isn't established about the real providers (latency, rate-limit headers, whether a
timed-out request is still billed) is recorded in each simulation's `*.context.yaml`. Read it before
relying on a result, and add to it after a run that teaches you something.

## Verify the adapters and the live server

```bash
postman simulation run postman/simulations/jev-luna-providers/jev-luna-providers.sim.yaml \
  --proxy --proxy-port auto --lift "node --import tsx scripts/verify-simulation.ts baseline"

postman simulation run postman/simulations/jev-luna-degraded/jev-luna-degraded.sim.yaml \
  --proxy --proxy-port auto --lift "node --import tsx scripts/verify-simulation.ts degraded"
```

`--lift` starts the command with `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS` and a proxy preload for Node's
built-in `fetch`, which ignores `HTTPS_PROXY` on its own. The script refuses to run without them.

## Play the game against the stand-ins

```bash
npm run build
postman simulation run postman/simulations/jev-luna-providers/jev-luna-providers.sim.yaml --proxy --proxy-port auto \
  --lift "env TYPESAFE_API_KEY=sim-only OPENAI_API_KEY=sim-only JEV_PROVIDER=typesafe JEV_MOCK=0 LUNA_MOCK=0 PONG_RULES=table-tennis PONG_MATCHUP=jev-vs-luna PORT=5277 node --import tsx server/index.ts --production"
```

Then open http://127.0.0.1:5277/arena3d.html. `/health` reports `"mode":"live"`, and the decision log
shows `jev` and `luna` as sources, because the real adapters ran and the stand-ins answered. Swap in
`jev-luna-degraded` to watch fallbacks during play. The server loads `.env.local`, but explicitly set
variables win, and the proxy answers for both provider hosts either way.

## Logs

Add `--log-format json` to see each proxied request's host, path, member (`destination`) and status.
A `destination` of `passthrough` means a request reached a real host. Write logs under `artifacts/`
(git-ignored), never into `postman/`, because bodies are logged as sent.
