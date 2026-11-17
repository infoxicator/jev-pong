import { nearestLane } from '../src/benchmark';
import { intercept, snapshot } from '../src/agents';
import { createGame, H, setIntent, SIDES, startServe, step, type Side } from '../src/physics';

const schedules = {
  fast: { latency: 164, cooldown: 0 },
  slow: { latency: 285, cooldown: 600 },
} as const;
type Schedule = keyof typeof schedules;
function stats() {
  return { points: 0, returns: 0, misses: 0, requests: 0, outsidePlay: 0 };
}
function sample(pace: number, schedulesBySeat: Record<Side, Schedule>) {
  const result = { left: stats(), right: stats() };
  for (let offset = 0; offset < 24; offset++) {
    const game = createGame('table-tennis');
    startServe(game);
    const pending: Partial<Record<Side, { due: number; point: number; lane: number }>> = {};
    const next = { left: 0, right: 0 }, lastIntent = { left: 0, right: 0 };
    const pollOffset = { left: offset, right: (offset * 7 + 5) % 24 };
    for (let wallTick = 0; game.pointId < 60; wallTick++) {
      for (const side of SIDES) {
        const timing = schedules[schedulesBySeat[side]];
        const decision = pending[side];
        if (decision?.due === wallTick) {
          if (decision.point === game.pointId) {
            setIntent(game, side, decision.lane);
            lastIntent[side] = game.tick;
          }
          next[side] = wallTick + Math.ceil(timing.cooldown * .12);
          delete pending[side];
        }
        if ((wallTick + pollOffset[side]) % 24 === 0 && !pending[side] && wallTick >= next[side] && game.phase !== 'won') {
          pending[side] = {
            due: wallTick + Math.ceil(timing.latency * .12),
            point: game.pointId,
            lane: nearestLane(Math.round(intercept(snapshot(game, side)))),
          };
          result[side].requests++;
          if (game.phase !== 'play') result[side].outsidePlay++;
        }
        if (game.tick - lastIntent[side] > 240) setIntent(game, side, H / 2);
      }
      if ((wallTick + 1) % (1 / pace) !== 0) continue;
      const { rally, pointId } = game;
      step(game);
      if (game.rally > rally) result[game.tt!.lastHitter].returns++;
      if (game.pointId !== pointId && game.lastScorer) {
        result[game.lastScorer].points++;
        if (game.tt!.reason === 'MISSED RETURN') result[game.lastScorer === 'left' ? 'right' : 'left'].misses++;
      }
    }
  }
  return result;
}
export function benchmarkTiming() {
  const unequal = [1, .5].map(pace => {
    const a = sample(pace, { left: 'fast', right: 'slow' });
    const b = sample(pace, { left: 'slow', right: 'fast' });
    const sum = (first: ReturnType<typeof stats>, second: ReturnType<typeof stats>) => ({
      points: first.points + second.points,
      returns: first.returns + second.returns,
      misses: first.misses + second.misses,
      requests: first.requests + second.requests,
      outsidePlay: first.outsidePlay + second.outsidePlay,
    });
    return { pace, fast: sum(a.left, b.right), slow: sum(a.right, b.left) };
  });
  const equal = sample(.5, { left: 'slow', right: 'slow' });
  return { parameters: schedules, unequal, equal };
}
