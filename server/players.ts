import { createBrain, providerConfig } from './jev';
import { createLunaBrain, lunaConfig } from './luna';
import { tacticalJev, tacticalLuna, type TacticalBrain } from './benchmark-providers';
import { engineFor, engineLabel, type Engine, type Matchup, type PlayerInfo } from '../src/match';
import { SIDES, type Side } from '../src/physics';
import type { Decision, Snapshot } from '../src/agents';
import type { ShotRead } from '../src/benchmark';
import type { TurnChoice } from '../src/live-tactics';
export type Brain = (state: Snapshot, sequence: number) => Promise<Decision>;
export function createPlayers(env: Record<string, string | undefined>, matchup: Matchup) {
  const jev = providerConfig(env);
  const luna = matchup === 'jev-vs-luna' ? lunaConfig(env) : null;
  const players = {} as Record<Side, PlayerInfo>, brains = {} as Record<Side, Brain>;
  const shotBrains: Partial<Record<Side, TacticalBrain>> = {};
  for (const side of SIDES) {
    const engine = engineFor(matchup, side), config = engine === 'luna' ? luna! : jev;
    players[side] = { engine, name: engineLabel(engine), model: config.model, provider: engine === 'luna' ? (config.mock ? 'mock' : 'openai') : jev.provider, mock: config.mock };
    brains[side] = engine === 'luna' ? createLunaBrain(luna!) : createBrain(jev);
    if (!config.mock) shotBrains[side] = engine === 'luna' ? tacticalLuna(luna!) : tacticalJev(jev);
  }
  const mockCount = SIDES.filter(side => players[side].mock).length;
  return { brains, shotBrains, players, mode: mockCount === 2 ? 'mock' : mockCount === 1 ? 'mixed' : matchup === 'jev-vs-jev' ? jev.provider : 'live' };
}

export function createShotPicker(
  currentRoster: () => ReturnType<typeof createPlayers>,
  cooldowns: Partial<Record<Engine, number>>,
  reserve: () => boolean | Promise<boolean> = () => true,
) {
  const busy = new Set<Side>(), failures: Partial<Record<Engine, number>> = {};
  return async (side: Side, read: ShotRead, isCurrent: () => boolean): Promise<TurnChoice> => {
    const { players, shotBrains } = currentRoster();
    const engine = players[side].engine, brain = shotBrains[side];
    if (!brain) {
      const variation = ((read.point ?? 0) * 7 + (read.rally ?? 0) * 3) % 10;
      const attack = engine === 'luna' ? 'drop' : 'deep';
      const preferred = variation < 2 ? 'safe' : variation < 4 ? (attack === 'deep' ? 'drop' : 'deep') : attack;
      const downTheLine = variation === 4 && read.options.find(option => option.shot === 'line');
      const shot = (downTheLine || read.options.find(option => option.shot === preferred) || read.options[0]).shot;
      return { source: 'mock', shot, ms: 0 };
    }
    if (busy.has(side) || (cooldowns[engine] ?? 0) > Date.now()) {
      return { source: 'fallback', reason: 'Provider cooling down' };
    }
    busy.add(side);
    try {
      if (!await reserve()) return { source: 'fallback', reason: 'Room AI budget exhausted' };
      if (!isCurrent()) return { source: 'fallback', reason: 'Stroke changed before request' };
      const decision = await brain(read);
      failures[engine] = decision.error ? (failures[engine] ?? 0) + 1 : 0;
      const backoff = decision.error ? Math.min(60000, 1000 * 2 ** Math.min(failures[engine]!, 6)) : 0;
      const delay = Math.max(decision.retryAfterMs ?? 0, backoff);
      if (delay) cooldowns[engine] = Math.max(cooldowns[engine] ?? 0, Date.now() + delay);
      if (decision.shot && !decision.error) return { source: engine, shot: decision.shot, ms: decision.ms };
      return { source: 'fallback', ms: decision.ms, reason: decision.status === 429 ? 'Provider rate limit' : `Provider ${decision.error ?? 'unavailable'}` };
    } finally {
      busy.delete(side);
    }
  };
}
