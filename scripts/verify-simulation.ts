/**
 * Run the real Jev and Luna adapters, and the real game server, against the Postman simulation in
 * postman/simulations/. Nothing here overrides a base URL or transport: the adapters call
 * https://api.typesafe.ai and https://api.openai.com as they ship, and the simulation's proxy answers.
 *
 *   postman simulation run postman/simulations/jev-luna-providers/jev-luna-providers.sim.yaml \
 *     --proxy --proxy-port auto --lift "node --import tsx scripts/verify-simulation.ts baseline"
 *   postman simulation run postman/simulations/jev-luna-degraded/jev-luna-degraded.sim.yaml \
 *     --proxy --proxy-port auto --lift "node --import tsx scripts/verify-simulation.ts degraded"
 *
 * Refuses to run outside `--lift`, so it can never reach a paid provider.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import WebSocket from 'ws';

const mode = process.argv[2];
assert(mode === 'baseline' || mode === 'degraded', 'Usage: verify-simulation.ts baseline|degraded');
assert(process.env.HTTPS_PROXY && process.env.NODE_EXTRA_CA_CERTS && /proxy-agent/.test(process.env.NODE_OPTIONS ?? ''),
  'Run under `postman simulation run … --proxy --lift`; refusing to call providers without the simulation proxy');

// Observe, never redirect: every provider response must carry the stand-in's marker header.
const HOSTS = new Set(['api.typesafe.ai', 'api.openai.com']);
const seen: { host: string; status: number; simulated: string | null }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert(HOSTS.has(url.hostname), `Unexpected outbound host ${url.hostname}`);
  const response = await realFetch(input, init);
  seen.push({ host: url.hostname, status: response.status, simulated: response.headers.get('x-postman-simulation') });
  return response;
};

// Imported after the observer so adapters that resolve `fetch` at construction see it.
const { createBrain, providerConfig } = await import('../server/jev');
const { createLunaBrain, lunaConfig } = await import('../server/luna');
const { tacticalJev, tacticalLuna } = await import('../server/benchmark-providers');
const { createGame, startServe, H, PADDLE_H } = await import('../src/physics');
const { snapshot, intercept, mockBrain } = await import('../src/agents');
const { makeTrials } = await import('../src/benchmark');

const SIM_KEYS = { TYPESAFE_API_KEY: 'sim-only', OPENAI_API_KEY: 'sim-only' };
const jevConfig = providerConfig({ ...SIM_KEYS, JEV_PROVIDER: 'typesafe', JEV_MOCK: '0' });
const luna = lunaConfig({ ...SIM_KEYS, LUNA_MOCK: '0' });
assert.equal(jevConfig.baseURL, 'https://api.typesafe.ai');
assert.equal(luna.baseURL, 'https://api.openai.com/v1');

const game = createGame('table-tennis');
startServe(game);
const left = snapshot(game, 'left'), right = snapshot(game, 'right');
const nearestLane = (y: number) => {
  const step = (H - PADDLE_H) / 16, index = Math.max(0, Math.min(16, Math.round((y - PADDLE_H / 2) / step)));
  return PADDLE_H / 2 + index * step;
};
// The stand-ins' tactical policy: the option that makes the opponent travel furthest.
const trial = makeTrials(4)[0];
const expectedShot = [...trial.read.options].sort((a, b) => Math.round(b.opponentTravel) - Math.round(a.opponentTravel))[0].shot;
const pass = (line: string) => console.log(`PASS ${mode}: ${line}`);

if (mode === 'baseline') {
  const jev = await createBrain(jevConfig)(left, 1);
  assert.equal(jev.source, 'jev', jev.warning);
  assert.equal(jev.action.target_y, nearestLane(Math.round(intercept(left))));
  assert(jev.responseMs >= 160, `Jev answered in ${jev.responseMs} ms, before the 164 ms latency`);
  pass(`Jev exhibition decision via SDK → api.typesafe.ai, lane ${jev.action.target_y}, ${jev.responseMs} ms`);

  const lunaDecision = await createLunaBrain(luna)(right, 1);
  assert.equal(lunaDecision.source, 'luna', lunaDecision.warning);
  assert.equal(lunaDecision.action.target_y, nearestLane(Math.round(intercept(right))));
  assert.match(lunaDecision.api?.requestId ?? '', /^sim-luna-/);
  assert((lunaDecision.retryAfterMs ?? 0) >= luna.intervalMs);
  assert(lunaDecision.responseMs >= 280, `Luna answered in ${lunaDecision.responseMs} ms, before the 285 ms latency`);
  pass(`Luna exhibition decision via fetch → api.openai.com, answers matched by name, cooldown ${lunaDecision.retryAfterMs} ms, ${lunaDecision.responseMs} ms`);

  const jevShot = await tacticalJev(jevConfig)(trial.read);
  const lunaShot = await tacticalLuna(luna)(trial.read);
  assert.equal(jevShot.shot, expectedShot, JSON.stringify(jevShot));
  assert.equal(lunaShot.shot, expectedShot, JSON.stringify(lunaShot));
  pass(`tactical shot "${expectedShot}" on "${trial.id}" from both adapters (Jev ${jevShot.ms} ms, Luna ${lunaShot.ms} ms)`);

  await liveServer();
} else {
  const jev = await createBrain(jevConfig)(left, 1);
  assert.equal(jev.source, 'fallback');
  assert.deepEqual(jev.action, mockBrain(left));
  assert(jev.responseMs >= 1450 && jev.responseMs < 1700, `Jev gave up after ${jev.responseMs} ms`);
  pass(`Jev hang → labeled heuristic fallback after ${jev.responseMs} ms (client timeout, not the 1700 ms hang)`);
  const jevShot = await tacticalJev(jevConfig)(trial.read);
  assert.equal(jevShot.error, 'timeout', JSON.stringify(jevShot));
  pass(`Jev hang → tactical "timeout" after ${jevShot.ms} ms`);

  const brain = createLunaBrain(luna), sources: string[] = [];
  let last;
  for (let i = 1; i <= 3; i++) { last = await brain(right, i); sources.push(last.source); }
  assert.deepEqual(sources, ['luna', 'luna', 'fallback']);
  assert.equal(last!.api?.status, 429);
  assert.match(last!.warning ?? '', /Luna HTTP 429/);
  assert((last!.retryAfterMs ?? 0) >= 2000, `retry ${last!.retryAfterMs} ms`);
  pass(`Luna 2 req/min → 2 decisions, then 429 fallback "${last!.warning}"`);
  const lunaShot = await tacticalLuna(luna)(trial.read);
  assert.equal(lunaShot.error, 'rate-limited', JSON.stringify(lunaShot));
  assert.equal(lunaShot.status, 429);
  assert((lunaShot.retryAfterMs ?? 0) > 0, 'Retry-After was not read');
  pass(`Luna 429 → tactical "rate-limited", retry after ${lunaShot.retryAfterMs} ms`);
}

const unmarked = seen.filter(r => !r.simulated && r.status < 400);
assert.equal(unmarked.length, 0, `Responses that did not come from a stand-in: ${JSON.stringify(unmarked)}`);
console.log(`PASS ${mode}: ${seen.length} provider requests from this process, every success answered by a stand-in. Zero real provider calls.`);

/** Start the real server in live tactical mode behind the same proxy and watch both models choose shots. */
async function liveServer() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  // Inherits HTTPS_PROXY, NODE_EXTRA_CA_CERTS and the proxy preload from --lift.
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    env: { ...process.env, ...SIM_KEYS, PORT: String(address.port), PONG_RULES: 'table-tennis', PONG_MATCHUP: 'jev-vs-luna', JEV_PROVIDER: 'typesafe', JEV_MOCK: '0', LUNA_MOCK: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', d => output += d);
  child.stderr.on('data', d => output += d);
  const peers: WebSocket[] = [];
  try {
    const health = await until(() => new Promise<{ mode: string } | null>(resolve => {
      if (child.exitCode !== null) throw new Error(output);
      get(`${origin}/health`, res => { let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(JSON.parse(raw))); }).on('error', () => resolve(null));
    }), 'server ready', 20_000);
    assert.equal(health.mode, 'live', 'server did not start with both providers live');
    let latest: { tactics?: Record<'left' | 'right', { source: string; status: string; shot?: string; ms?: number } | null>; game: { rally: number } } | undefined;
    const chosen = { left: new Set<string>(), right: new Set<string>() };
    for (const side of ['left', 'right'] as const) {
      const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/ws?side=${side}`, { origin });
      peers.push(ws);
      ws.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.type !== 'state') return;
        latest = message;
        for (const s of ['left', 'right'] as const) {
          const turn = message.tactics?.[s];
          if (turn?.status === 'selected') chosen[s].add(`${turn.source}:${turn.shot}`);
        }
      });
      await once(ws, 'open');
    }
    await until(() => [...chosen.left].some(c => c.startsWith('jev:')) && [...chosen.right].some(c => c.startsWith('luna:')) ? true : null,
      'Jev and Luna each select a tactical shot in the live match', 30_000);
    pass(`live tactical match (server/index.ts, mode live) — Jev chose ${[...chosen.left].join(', ')}; Luna chose ${[...chosen.right].join(', ')}; rally ${latest?.game.rally}`);
  } finally {
    peers.forEach(ws => ws.close());
    child.kill('SIGINT');
    await once(child, 'exit').catch(() => {});
  }
}

async function until<T>(check: () => Promise<T | null> | T | null, label: string, timeout: number): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
