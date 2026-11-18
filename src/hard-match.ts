import type { Side } from './physics';
import type { TacticalShot } from './table-tennis';

export const SCRIPTED_OPPONENTS = {
  defender: { name: 'Defender', shots: ['safe', 'line', 'drop', 'deep'] },
  attacker: { name: 'Attacker', shots: ['deep', 'line', 'drop', 'safe'] },
  placement: { name: 'Placement', shots: ['drop', 'line', 'deep', 'safe'] },
} as const satisfies Record<string, { name: string; shots: readonly TacticalShot[] }>;
export const HARD_SHOTS = ['safe', 'deep', 'drop', 'line'] as const;

export interface HardMatch {
  seed: number;
  opponent: 'models' | keyof typeof SCRIPTED_OPPONENTS;
  modelSide: Side;
}

export function isHardMatch(value: unknown): value is HardMatch {
  if (typeof value !== 'object' || value === null) return false;
  const { seed, opponent, modelSide } = value as Partial<HardMatch>;
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff
    && typeof opponent === 'string' && (opponent === 'models' || Object.hasOwn(SCRIPTED_OPPONENTS, opponent))
    && (modelSide === 'left' || modelSide === 'right');
}

export function scriptFor(hard: HardMatch | undefined, side: Side) {
  if (!hard || hard.opponent === 'models' || side === hard.modelSide) return undefined;
  return SCRIPTED_OPPONENTS[hard.opponent];
}

export function seatsReady(hard: HardMatch | undefined, connected: Record<Side, boolean>) {
  return hard && hard.opponent !== 'models' ? connected[hard.modelSide] : connected.left && connected.right;
}

export function hardServe(hard: HardMatch, score: Record<Side, number>, pointId: number) {
  const total = score.left + score.right;
  // Each side gets the same two deliveries in a service rotation, or one each at deuce.
  const delivery = total < 20 ? Math.floor(total / 4) * 2 + total % 2 : 10 + Math.floor((total - 20) / 2);
  let state = (hard.seed ^ Math.imul(pointId - total, 0x9e3779b1) ^ Math.imul(delivery + 1, 0x85ebca6b)) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000;
  };
  return {
    serverY: 170 + 220 * next(),
    // Keep the receiver centered enough to reach both the line and cross-court serves.
    receiverY: 210 + 140 * next(),
    aim: 120 + 320 * next(),
    speed: 3.14 + .24 * next(),
  };
}
