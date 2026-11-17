import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { benchmarkTiming } from './benchmark-timing';
import { APPLY_TICKS, BENCHMARK_PACE, DECISION_DEADLINE_MS, makeTrials, otherSide, playTrial, type ReplayClip, type ReplayFile, type ShotRead, type Trial } from '../src/benchmark';
import { tacticalJev, tacticalLuna, type TacticalBrain, type TacticalDecision } from '../server/benchmark-providers';
import { providerConfig } from '../server/jev';
import { lunaConfig } from '../server/luna';

const { values } = parseArgs({ options: {
  live: { type: 'boolean' },
  'env-file': { type: 'string', default: '.env.local' },
  limit: { type: 'string', default: '12' },
} });
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('--limit must be an integer between 1 and 12.');
const trials = makeTrials(limit);
assert.equal(trials.length, 2 * limit, 'Expected two seats for every requested drill');
type Status = 'on-time' | 'late' | NonNullable<TacticalDecision['error']> | 'skipped';
interface Entry {
  scenario: string;
  side: Trial['side'];
  player: string;
  status: Status;
  chosen: TacticalDecision['shot'];
  responseMs?: number;
  httpStatus?: number;
  replayedFallback: boolean;
  result: ReplayClip['result'];
}
const clips: ReplayClip[] = [];
const entries: Entry[] = [];
function evaluate(trial: Trial, player: string, decision: TacticalDecision | null) {
  const status: Status = !decision ? 'skipped' : decision.error ?? (decision.ms > DECISION_DEADLINE_MS ? 'late' : 'on-time');
  const chosen = status === 'on-time' ? decision?.shot : undefined;
  const option = trial.read.options.find(({ shot }) => shot === (chosen ?? 'safe'));
  assert(option, 'A legal option or the safe baseline must exist');
  const { result, frames, applyTick, contactTick, landingTick } = playTrial(trial.game, trial.side, option.shot, option.lane, true);
  assert.equal(applyTick - trial.game.tick, APPLY_TICKS);
  clips.push({ scenario: trial.id, side: trial.side, player: chosen ? player : `${player} · safe fallback`, shot: option.shot, result, frames, applyTick, contactTick, landingTick });
  entries.push({ scenario: trial.id, side: trial.side, player, status, chosen, responseMs: decision?.ms, httpStatus: decision?.status, replayedFallback: !chosen, result });
}
for (let i = 0; i < trials.length; i += 2) {
  const [a, b] = [trials[i], trials[i + 1]];
  assert.deepEqual(a.read, b.read);
  for (const option of a.read.options) {
    const forward = playTrial(a.game, a.side, option.shot, option.lane);
    const reverse = playTrial(b.game, b.side, option.shot, option.lane);
    assert.equal(forward.contactTick, reverse.contactTick, 'Mirror contact tick');
    assert.equal(forward.landingTick, reverse.landingTick, 'Mirror landing tick');
    assert.equal(forward.result.reason, reverse.result.reason, 'Mirror point outcome');
    assert.equal(forward.result.winner ? otherSide(forward.result.winner) : null, reverse.result.winner);
    assert(forward.result.landing && reverse.result.landing);
    assert(Math.abs(forward.result.landing.x + reverse.result.landing.x - 1000) < 1e-6);
    assert(Math.abs(forward.result.landing.y - reverse.result.landing.y) < 1e-6);
  }
}

const timing = benchmarkTiming();
const percent = (count: number, total: number) => total ? `${(100 * count / total).toFixed(1)}%` : '—';
console.table(timing.unequal.map(({ pace, fast, slow }) => ({
  pace, points: fast.points + slow.points,
  'fast point share': percent(fast.points, fast.points + slow.points),
  'slow return rate': percent(slow.returns, slow.returns + slow.misses),
  'requests outside play': percent(fast.outsidePlay + slow.outsidePlay, fast.requests + slow.requests),
})));
console.log(`Equal timing at 0.5×: ${timing.equal.left.points} left / ${timing.equal.right.points} right points.`);
assert(timing.unequal.every(row => row.fast.points > row.slow.points));
assert(timing.unequal[1].slow.returns / (timing.unequal[1].slow.returns + timing.unequal[1].slow.misses) >
  timing.unequal[0].slow.returns / (timing.unequal[0].slow.returns + timing.unequal[0].slow.misses));

const oracle: TacticalBrain = async read => {
  const trial = trials.find(trial => trial.id === read.scenario)!;
  const winner = read.options.find(option => playTrial(trial.game, trial.side, option.shot, option.lane).result.winner === trial.side);
  return { shot: winner?.shot ?? 'safe', ms: 0 };
};
for (const trial of trials) {
  evaluate(trial, 'Nearest lane', { shot: 'safe', ms: 0 });
  evaluate(trial, 'Best available outcome', await oracle(trial.read));
}

async function verifyProviderFixtures() {
  const requests: Record<string, { situation: unknown; options: string[]; instruction: string }[]> = { jev: [], luna: [] };
  const errors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer benchmark-fixture');
      assert.equal(req.method, 'POST');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const jev = req.url === '/v1/systemone';
      assert(jev || req.url === '/v1/decisions');
      const name = jev ? 'jev' : 'luna';
      const state = jev ? body.state.situation : body.input[0].content[1].data;
      const instruction = jev ? body.state.instruction : body.input[0].content[0].text;
      const options: string[] = jev ? Object.keys(body.questions.shot.criteria) : body.questions[0].choices.map((c: { value: string }) => c.value);
      assert.equal(jev ? Object.keys(body.questions).length : body.questions.length, 1);
      assert.equal(body.model, jev ? 'jev-latest' : 'gpt-6-luna');
      requests[name].push({ situation: state, options, instruction });
      const call = requests[name].length;
      if (call === 3) {
        res.writeHead(429, { 'retry-after': '12' }).end('{}');
        return;
      }
      if (call === 2 && !jev) await delay(820);
      const shot = call === 4 ? 'not-a-shot' : options.includes('drop') ? 'drop' : 'safe';
      const answer = { type: 'choice', choice: shot, confidence: .9 };
      const answers = jev ? { shot: { ...answer, probabilities: { [shot]: 1 } } } : [{ ...answer, name: 'shot', probabilities: [{ value: shot, probability: 1 }] }];
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: body.model, answers }));
    } catch (error) {
      errors.push(String(error));
      res.writeHead(500).end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: typeof fetch = (input, init) => {
    assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, origin);
    return fetch(input, init);
  };
  const jev = tacticalJev({ mock: false, provider: 'typesafe', apiKey: 'benchmark-fixture', baseURL: origin, model: 'jev-latest' }, transport);
  const luna = tacticalLuna({ ...lunaConfig({ OPENAI_API_KEY: 'benchmark-fixture' }), baseURL: `${origin}/v1` }, transport);
  try {
    for (const trial of [trials[0], trials[1], trials[0], trials[1]]) {
      const [a, b] = await Promise.all([jev(trial.read), luna(trial.read)]);
      evaluate(trial, 'Jev fixture', a);
      evaluate(trial, 'Luna fixture', b);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.jev, requests.luna);
    assert.deepEqual(entries.filter(row => row.player === 'Jev fixture').map(row => row.status), ['on-time', 'on-time', 'rate-limited', 'invalid']);
    assert.deepEqual(entries.filter(row => row.player === 'Luna fixture').map(row => row.status), ['on-time', 'late', 'rate-limited', 'invalid']);
    console.log('Fixture adapters sent identical state and choices, one question per incoming ball. Verified success, late, HTTP 429 and invalid answers.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function runLive() {
  loadEnv({ path: values['env-file'], quiet: true });
  const jev = providerConfig(process.env), luna = lunaConfig(process.env);
  if (jev.mock || luna.mock) throw new Error('Both live providers must be configured with mock mode disabled.');
  const providers = [
    { player: `Jev · ${jev.model}`, brain: tacticalJev(jev), blocked: false, next: 0, pace: 200 },
    { player: `Luna · ${luna.model}`, brain: tacticalLuna(luna), blocked: false, next: 0, pace: Math.max(luna.intervalMs, 800) },
  ];
  for (const trial of trials) {
    await Promise.all(providers.map(async provider => {
      if (provider.blocked) {
        evaluate(trial, provider.player, null);
        return;
      }
      await delay(Math.max(0, provider.next - performance.now()));
      const decision = await provider.brain(trial.read);
      provider.next = performance.now() + provider.pace;
      if (decision.error === 'rate-limited' || decision.status === 401 || decision.status === 403) {
        provider.blocked = true;
        console.log(`${provider.player}: HTTP ${decision.status}; stopping its requests for this run.`);
      }
      evaluate(trial, provider.player, decision);
    }));
  }
  return providers.map(provider => provider.player);
}

let livePlayers: string[] = [];
if (values.live) livePlayers = await runLive();
else await verifyProviderFixtures();

function summarize(rows: Entry[]) {
  const qualifying = rows.filter(row => row.status === 'on-time');
  const count = (status: Status) => rows.filter(row => row.status === status).length;
  return {
    attempted: rows.length - count('skipped'),
    onTime: qualifying.length,
    late: count('late'),
    timedOut: count('timeout'),
    rateLimited: count('rate-limited'),
    errors: count('unavailable') + count('invalid'),
    skipped: count('skipped'),
    fallbacks: rows.filter(row => row.replayedFallback).length,
    contacted: qualifying.filter(row => row.result.contacted).length,
    legalPlacement: qualifying.filter(row => row.result.landing).length,
    winners: qualifying.filter(row => row.result.winner === row.side).length,
  };
}
const players = [...new Set(entries.map(entry => entry.player))];
const summary = Object.fromEntries(players.map(player => [player, summarize(entries.filter(entry => entry.player === player))]));
console.table(summary);
const matched = new Set(trials.filter((_, index) => index % 2 === 0).filter(trial =>
  livePlayers.length > 0 && livePlayers.every(player => entries.filter(entry =>
    entry.player === player && entry.scenario === trial.id && entry.status === 'on-time').length === 2)).map(trial => trial.id));
const matchedSummary = Object.fromEntries(livePlayers.map(player => [player,
  summarize(entries.filter(entry => entry.player === player && matched.has(entry.scenario)))]));
const fixedTactics = ['safe', 'deep', 'drop'].map(shot => {
  const attempts = trials.flatMap(trial => {
    const option = trial.read.options.find(option => option.shot === shot);
    if (!option) return [];
    const { result } = playTrial(trial.game, trial.side, option.shot, option.lane);
    return [{ id: trial.id, winner: result.winner === trial.side }];
  });
  return {
    shot,
    available: attempts.length,
    winners: attempts.filter(attempt => attempt.winner).length,
    matchedWinners: attempts.filter(attempt => attempt.winner && matched.has(attempt.id)).length,
  };
});
console.table(fixedTactics);
if (values.live) {
  console.log(`Complete mirrored live scenarios: ${matched.size}/${limit}. Only these qualify for the paired model comparison.`);
  console.table(matchedSummary);
}
const replay: ReplayFile = { format: 'jev-benchmark-replay-v1', pace: BENCHMARK_PACE, clips };
const stem = values.live ? 'benchmark-live' : 'benchmark';
await mkdir('artifacts', { recursive: true });
await Promise.all([
  writeFile(`artifacts/${stem}.json`, JSON.stringify({ timing, deadlineMs: DECISION_DEADLINE_MS, trials: trials.map(({ id, side, read }) => ({ id, side, read })), summary, fixedTactics, matchedScenarios: [...matched], matchedSummary, entries }, null, 2)),
  writeFile(`artifacts/${stem}-replay.json`, JSON.stringify(replay)),
]);
console.log(`Wrote artifacts/${stem}.json and artifacts/${stem}-replay.json`);
