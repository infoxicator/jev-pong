import { clamp, createGame, H, PADDLE_H, setIntent, startServe, step, type GameState, type Side } from './physics';
import { projectTableTennis, returnShot, TT_REACH, ttPlane, type TacticalShot } from './table-tennis';

export const BENCHMARK_PACE = .5;
export const DECISION_DEADLINE_MS = 750;
export const APPLY_TICKS = Math.round(120 * DECISION_DEADLINE_MS / 1000 * BENCHMARK_PACE);
const TACTICS = ['safe', 'deep', 'drop'] as const;
export const TACTIC_LABELS = { safe: 'Safe return', deep: 'Deep corner', drop: 'Short drop' };
type Drill = 'wide return' | 'recovery' | 'high ball' | 'serve receive';
type Placement = { x: number; y: number };
export interface ShotOption {
  shot: TacticalShot;
  lane: number;
  landing: Placement;
  opponentTravel: number;
  flightMs: number;
}
export interface ShotRead {
  scenario: string;
  ownPaddleY: number;
  opponentPaddleY: number;
  contactY: number;
  contactHeight: number;
  flightMs: number;
  applyAfterMs: number;
  options: ShotOption[];
}
export interface ShotResult {
  contacted: boolean;
  landing: Placement | null;
  opponentReturned: boolean;
  winner: Side | null;
  reason: string;
}
export interface ReplayClip {
  scenario: string;
  player: string;
  side: Side;
  shot: TacticalShot;
  applyTick: number;
  contactTick: number;
  landingTick: number;
  result: ShotResult;
  frames: GameState[];
}
export interface ReplayFile {
  format: 'jev-benchmark-replay-v1';
  pace: number;
  clips: ReplayClip[];
}
export interface Trial {
  id: string;
  side: Side;
  game: GameState;
  read: ShotRead;
}
export const otherSide = (side: Side): Side => side === 'left' ? 'right' : 'left';
export function nearestLane(y: number): number {
  const increment = (H - PADDLE_H) / 16;
  return PADDLE_H / 2 + clamp(Math.round((y - PADDLE_H / 2) / increment), 0, 16) * increment;
}
export function projectedLane(game: GameState, side: Side): number {
  return nearestLane(Math.round(projectTableTennis(game.ball, game.tt!, side).y));
}
function applyPlan(game: GameState, side: Side, shot: TacticalShot, lane: number) {
  if (!game.tt?.tactical) throw new Error('Tactical rules are required');
  game.tt.tactical.plans[side] = shot;
  setIntent(game, side, lane);
}

function incoming(drill: Drill, seed: number): GameState {
  const game = createGame('table-tennis'), table = game.tt!;
  game.pointId = seed;
  game.score = { left: 4 + seed, right: 2 + seed };
  table.tactical = { plans: {}, landing: null };
  if (drill === 'serve receive') {
    // The seed changes the serve curve. Each trial has an exact opposite-seat counterpart.
    game.score = { left: 4, right: 4 };
    startServe(game);
    while (game.phase === 'serve') step(game);
    return game;
  }
  const drifts = [0, -20, 17];
  const contactY = { 'wide return': 192, recovery: 330, 'high ball': 265 }[drill] + drifts[seed];
  game.paddles = { left: contactY, right: { 'wide return': 370, recovery: 403, 'high ball': 297 }[drill] - drifts[seed] };
  game.targets = { ...game.paddles };
  game.phase = 'play';
  game.ball.x = ttPlane('left');
  game.ball.y = contactY;
  table.height = drill === 'high ball' ? 1.39 : .94;
  game.rally = drill === 'high ball' ? 2 : 0;
  // Put a legal, repeatable feed in play through the same stroke engine.
  if (drill !== 'high ball') table.tactical.plans.left = drill === 'wide return' ? 'deep' : 'safe';
  returnShot(game, 'left');
  return game;
}
function mirrored(game: GameState): GameState {
  const copy = structuredClone(game), table = copy.tt!;
  const swap = <T>(pair: Record<Side, T>): Record<Side, T> => ({ left: pair.right, right: pair.left });
  copy.ball.x = 1000 - copy.ball.x;
  copy.ball.vx *= -1;
  copy.paddles = swap(copy.paddles);
  copy.targets = swap(copy.targets);
  copy.score = swap(copy.score);
  table.velocity = swap(table.velocity);
  table.strokes = swap(table.strokes);
  for (const stroke of Object.values(table.strokes)) {
    if (!stroke) continue;
    stroke.x = 1000 - stroke.x;
    if (stroke.hand !== 'serve') stroke.hand = stroke.hand === 'forehand' ? 'backhand' : 'forehand';
  }
  table.server = otherSide(table.server);
  table.lastHitter = otherSide(table.lastHitter);
  return copy;
}

/** Each receiver gets one decision window. An identical reactive policy plays the reply. */
export function playTrial(start: GameState, side: Side, shot: TacticalShot, lane: number, record = false) {
  const game = structuredClone(start), opponent = otherSide(side), startRally = game.rally;
  const applyTick = start.tick + APPLY_TICKS;
  const frames = record ? [structuredClone(game)] : [];
  let contactTick = -1, landingTick = -1, landing: Placement | null = null;
  let opponentTravel = 0, flightMs = 0, responseTick = Infinity;
  while (game.phase === 'play' && game.tick - start.tick < 480) {
    if (game.tick === applyTick) applyPlan(game, side, shot, lane);
    if (game.tick === responseTick) applyPlan(game, opponent, 'safe', projectedLane(game, opponent));
    step(game);
    if (game.rally === startRally + 1 && contactTick < 0) {
      contactTick = game.tick;
      const flight = projectTableTennis(game.ball, game.tt!, opponent);
      opponentTravel = Math.abs(flight.y - game.paddles[opponent]);
      flightMs = flight.time / BENCHMARK_PACE * 1000;
      responseTick = game.tick + APPLY_TICKS;
    }
    const bounce = game.tt!.tactical!.landing;
    if (!landing && contactTick >= 0 && bounce?.strokeTick === contactTick) {
      landing = { x: bounce.x, y: bounce.y };
      landingTick = game.tick;
    }
    const replied = game.rally > startRally + 1;
    if (record && (game.tick % 4 === 0 || game.tick === contactTick || game.tick === landingTick || game.phase !== 'play' || replied)) {
      frames.push(structuredClone(game));
    }
    if (replied) break;
  }
  const result: ShotResult = {
    contacted: contactTick >= 0,
    landing,
    opponentReturned: game.rally > startRally + 1,
    winner: game.lastScorer,
    reason: game.phase === 'play' ? 'OPPONENT RETURNED' : game.tt!.reason,
  };
  return { result, frames, applyTick, contactTick, landingTick, opponentTravel, flightMs };
}

export function makeTrials(limit = 12): Trial[] {
  const drills: Drill[] = ['wide return', 'recovery', 'high ball', 'serve receive'];
  const trials: Trial[] = [];
  for (let seed = 0; seed < 3; seed++) for (const drill of drills) {
    if (trials.length === limit * 2) return trials;
    const game = incoming(drill, seed);
    const projected = projectTableTennis(game.ball, game.tt!, 'right');
    const lane = nearestLane(projected.y);
    const options = TACTICS.flatMap(shot => {
      const attempt = playTrial(game, 'right', shot, lane);
      if (!attempt.result.contacted || !attempt.result.landing) return [];
      return [{ shot, lane, landing: attempt.result.landing, opponentTravel: attempt.opponentTravel, flightMs: attempt.flightMs }];
    });
    if (!options.some(option => option.shot === 'safe') || options.length < 2 || Math.abs(projected.y - lane) > TT_REACH) continue;
    const id = `${drill} ${seed + 1}`;
    const read: ShotRead = {
      scenario: id, ownPaddleY: game.paddles.right, opponentPaddleY: game.paddles.left,
      contactY: projected.y, contactHeight: projected.height,
      flightMs: projected.time / BENCHMARK_PACE * 1000,
      applyAfterMs: DECISION_DEADLINE_MS, options,
    };
    trials.push({ id, side: 'right', game, read });
    // Canonical read normalizes horizontal coordinates, so both seats get identical inputs.
    trials.push({ id, side: 'left', game: mirrored(game), read });
  }
  return trials;
}
