import assert from 'node:assert/strict';
import { createGame, DT, startServe, type GameState, type Side } from '../src/physics';
import { LiveTableTennis, type TurnChoice } from '../src/live-tactics';
import { createPlayers, createShotPicker } from '../server/players';
import type { ShotRead } from '../src/benchmark';
import { hardServe, SCRIPTED_OPPONENTS, type HardMatch } from '../src/hard-match';

function gameAtServe() {
  const game = createGame('table-tennis');
  startServe(game);
  return game;
}
let ms = 0;
const pace = .5;
async function tick(loop: LiveTableTennis, game: GameState) {
  ms += DT * 1000 / pace;
  loop.step(game, pace);
  await Promise.resolve();
}
async function advanceTo(loop: LiveTableTennis, game: GameState, condition: () => boolean) {
  for (let i = 0; i < 600 && !condition(); i++) await tick(loop, game);
  assert(condition(), 'Expected to reach the specified game state');
}

const held: { side: Side; read: ShotRead; current: () => boolean; resolve: (choice: TurnChoice) => void }[] = [];
const game = gameAtServe();
const loop = new LiveTableTennis((side, read, current) =>
  new Promise(resolve => held.push({ side, read, current, resolve })), () => ms);
for (let i = 0; i < 100; i++) await tick(loop, game);
assert.equal(held.length, 0, 'No model calls between points');
await advanceTo(loop, game, () => held.length === 1);
assert.equal(game.tt!.shot, 'serve');
const first = held[0];
const firstTurn = loop.turns[first.side]!;
assert.equal(first.side, 'right');
assert.equal(firstTurn.strokeTick, game.tick);
assert(held[0].read.options.length > 1);
assert(first.current());
await advanceTo(loop, game, () => game.tick === firstTurn.applyTick);
assert.equal(loop.turns.right!.status, 'choosing');
await tick(loop, game);
assert.equal(loop.turns.right!.status, 'fallback');
assert.equal(loop.turns.right!.reason, 'Decision deadline missed');
assert.equal(loop.turns.right!.shot, 'safe');
assert.equal(loop.log.length, 1);
assert.equal(loop.log[0].reason, 'Decision deadline missed');
assert.equal(held.length, 1, 'Exactly one decision request for the serve');
await advanceTo(loop, game, () => game.rally === 1);
assert.equal(game.tt!.strokes.right?.tactic, 'safe', 'Local movement and fallback execute the scheduled return');
assert.equal(game.pointId, 0, 'The ball changed direction during the same point');
assert.equal(held.length, 2, 'The return opens one new decision window for the other seat');
assert(!first.current(), 'The original decision cannot be applied to the new stroke');
first.resolve({ source: 'luna', shot: 'deep', ms: 1000 });
await tick(loop, game);
assert.equal(loop.intents.right, 0);
assert.equal(game.tt!.strokes.right?.tactic, 'safe');

const second = held[1], secondTurn = loop.turns[second.side]!;
const shot = second.read.options.find(o => o.shot !== 'safe')!.shot;
second.resolve({ source: 'jev', shot, ms: 70 });
await advanceTo(loop, game, () => game.tick === secondTurn.applyTick);
assert.equal(loop.intents.left, 0, 'An early answer waits for the shared application rule');
await tick(loop, game);
assert.equal(loop.intents.left, 1);
assert.equal(loop.turns.left!.strokeTick, secondTurn.strokeTick);
assert.equal(loop.turns.left!.shot, shot);
assert.deepEqual(loop.log.map(entry => [entry.side, entry.shot]), [['right','safe'], ['left',shot]]);
await advanceTo(loop, game, () => game.rally === 2);
assert.equal(game.tt!.strokes.left?.tactic, shot);
const old = held.at(-1)!;
loop.cancel(true);
assert(!old.current(), 'Reset invalidates the in-flight turn');
old.resolve({ source: 'luna', shot: 'deep' });
const reset = gameAtServe();
await tick(loop, reset);
assert.deepEqual(loop.turns, { left: null, right: null });
assert.deepEqual(loop.intents, { left: 0, right: 0 });
assert.equal(loop.log.length, 0);

// Isolate the picker from real endpoints and exercise the same reservation and cooldown paths.
const roster = createPlayers({ JEV_MOCK: '1' }, 'jev-vs-luna');
let requests = 0, reservations = 0, canSpend = true;
roster.shotBrains.right = async () => {
  requests++;
  return { ms: 20, status: 429, error: 'rate-limited', retryAfterMs: 45000 };
};
const cooldowns: Partial<Record<'jev' | 'luna', number>> = {};
const pick = createShotPicker(() => roster, cooldowns, () => { reservations++; return canSpend; });
const limited = await pick('right', first.read, () => true);
assert.equal(limited.reason, 'Provider rate limit');
assert((cooldowns.luna ?? 0) - Date.now() > 44000);
assert.equal((await pick('right', first.read, () => true)).reason, 'Provider cooling down');
assert.equal(requests, 1);
assert.equal(reservations, 1);
delete cooldowns.luna;
canSpend = false;
assert.equal((await pick('right', first.read, () => true)).reason, 'Room AI budget exhausted');
assert.equal(requests, 1);

for (const policy of ['mock tactics', 'all fallbacks'] as const) {
  const sample = gameAtServe();
  const sampleRoster = createPlayers({ JEV_MOCK: '1' }, 'jev-vs-luna');
  const controller = new LiveTableTennis(policy === 'mock tactics'
    ? createShotPicker(() => sampleRoster, {})
    : async () => ({ source: 'fallback', reason: 'Fixture offline' }), () => ms);
  const lengths: number[] = [];
  for (let i = 0; i < 115000 && lengths.length < 60; i++) {
    const point = sample.pointId;
    await tick(controller, sample);
    if (sample.pointId !== point) lengths.push(sample.rally);
  }
  assert.equal(lengths.length, 60, `${policy}: points continue to score`);
  assert.equal(controller.log.length, 40, 'Decision history stays bounded');
  assert.equal(new Set(controller.log.map(entry => entry.strokeTick)).size, 40, 'Each stroke has at most one log entry');
  lengths.sort((a,b) => a-b);
  const median = (lengths[29] + lengths[30]) / 2;
  assert(median >= 5 && median <= 22, `${policy}: rallies stay playable`);
  console.log(`${policy}: 60 points, median ${median} returns, longest ${lengths.at(-1)}`);
}
console.log('PASS: stroke-triggered requests, shared application tick, stale replies, reset, quota, and fallback. Zero external requests.');

const hard: HardMatch = { seed: 3727, opponent: 'models', modelSide: 'left' };
const delivery = (total: number, seed = hard.seed) => hardServe({ ...hard, seed }, { left: total, right: 0 }, total);
assert.deepEqual(delivery(0), delivery(2), 'Both servers get the first delivery of the rotation');
assert.deepEqual(delivery(1), delivery(3), 'Both servers get the second delivery of the rotation');
assert.deepEqual(delivery(20), delivery(21), 'Service rotations stay paired at deuce');
assert.notDeepEqual(delivery(0), delivery(1), 'Openings vary within a match');
assert.notDeepEqual(delivery(0), delivery(0, 1129), 'Changing the seed changes the opening');

const sampleRoster = createPlayers({ JEV_MOCK: '1', LUNA_MOCK: '1' }, 'jev-vs-luna');
const mockPick = createShotPicker(() => sampleRoster, {});
for (const opponent of ['models', ...Object.keys(SCRIPTED_OPPONENTS) as (keyof typeof SCRIPTED_OPPONENTS)[]] as const) {
  for (const [seed, modelSide] of [[3727, 'left'], [1129, 'right']] as const) {
    const sample = createGame('table-tennis', { seed, opponent, modelSide });
    const sources = new Set<TurnChoice['source']>();
    let lineAvailable = false, scriptedRequests = 0, longest = 0, scoredPoints = 0, finished = false;
    const controller = new LiveTableTennis(async (side, read, current) => {
      if (opponent !== 'models' && side !== modelSide) scriptedRequests++;
      lineAvailable ||= read.options.some(option => option.shot === 'line');
      return mockPick(side, read, current);
    }, () => ms);
    startServe(sample);
    for (let i = 0; i < 60000 && !finished; i++) {
      const point = sample.pointId, previousLog = controller.log;
      await tick(controller, sample);
      if (previousLog !== controller.log) sources.add(controller.log.at(-1)!.source);
      if (point !== sample.pointId) {
        scoredPoints++;
        longest = Math.max(longest, sample.rally);
        assert.notEqual(sample.tt!.reason, 'SERVICE FAULT');
      }
      finished = sample.phase === 'won';
    }
    assert(finished && scoredPoints >= 11, 'Play to a genuine match win');
    assert(longest > 2, 'Play continues beyond the first two returns');
    assert(lineAvailable && sources.has('mock'), 'Models see Hard shot options and play actual returns');
    assert.equal(scriptedRequests, 0, 'The scripted side bypasses all model requests');
    assert.equal(sources.has('scripted'), opponent !== 'models');
    console.log(`Hard seed ${seed}, model seat ${modelSide}, opponent ${opponent}: ${sample.score.left}–${sample.score.right}, longest rally ${longest} returns`);
  }
}
