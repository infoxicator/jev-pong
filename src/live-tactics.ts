import { DECISION_DEADLINE_MS, otherSide, type ShotOption, type ShotRead } from './benchmark';
import { HARD_SHOTS, scriptFor } from './hard-match';
import { DT, H, W, setIntent, step, type GameState, type Side } from './physics';
import { projectTableTennis, type TacticalShot } from './table-tennis';

export interface TurnChoice {
  shot?: TacticalShot;
  source: 'mock' | 'jev' | 'luna' | 'fallback' | 'scripted';
  ms?: number;
  reason?: string;
}
export interface TacticalTurn extends TurnChoice {
  strokeTick: number;
  applyTick: number;
  status: 'choosing' | 'selected' | 'fallback' | 'unreachable';
}
export interface TacticalLogEntry extends TacticalTurn {
  side: Side;
}
const LOG_LIMIT = 40;
type Pick = (side: Side, read: ShotRead, isCurrent: () => boolean) => Promise<TurnChoice>;
type TurnWindow = {
  game: GameState;
  point: number;
  side: Side;
  strokeTick: number;
  applyTick: number;
  deadline: number;
  fallback: TacticalShot;
  answer?: TurnChoice;
  options: TacticalShot[];
  applied: boolean;
};

function footwork(game: GameState) {
  const table = game.tt!;
  if (game.phase !== 'play') {
    if (game.phase === 'serve' && table.hard) return;
    setIntent(game, 'left', H / 2);
    setIntent(game, 'right', H / 2);
    return;
  }
  const receiver = otherSide(table.lastHitter);
  setIntent(game, receiver, projectTableTennis(game.ball, table, receiver).y);
  setIntent(game, table.lastHitter, H / 2);
}

/** Forecast a candidate with the same movement, collisions and stroke controller as the match. */
function forecast(start: GameState, side: Side, shot: TacticalShot, pace: number): ShotOption | null {
  const game = structuredClone(start), table = game.tt!, opponent = otherSide(side);
  table.tactical!.plans[side] = shot;
  let outgoingTick: number | undefined, lane = 0, opponentTravel = 0, flightMs = 0;
  for (let i = 0; i < 360 && game.phase === 'play'; i++) {
    if (i === 0 || game.tick % 6 === 0) footwork(game);
    step(game);
    if (outgoingTick === undefined && game.rally > start.rally) {
      outgoingTick = table.strokes[side]?.tick;
      lane = game.paddles[side];
      const next = projectTableTennis(game.ball, table, opponent);
      opponentTravel = Math.abs(next.y - game.paddles[opponent]);
      flightMs = next.time * 1000 / pace;
    }
    const bounce = table.tactical!.landing;
    if (bounce && bounce.strokeTick === outgoingTick) {
      return {
        shot, lane,
        landing: { x: side === 'left' ? W - bounce.x : bounce.x, y: bounce.y },
        opponentTravel, flightMs,
      };
    }
    if (game.rally > start.rally + 1) break;
  }
  return null;
}

export class LiveTableTennis {
  private active: TurnWindow | null = null;
  turns: Record<Side, TacticalTurn | null> = { left: null, right: null };
  intents = { left: 0, right: 0 };
  log: readonly TacticalLogEntry[] = [];

  constructor(private readonly pick: Pick, private readonly now = () => performance.now()) {}

  cancel(reset = false) {
    this.active = null;
    this.turns = { left: null, right: null };
    if (reset) {
      this.intents = { left: 0, right: 0 };
      this.log = [];
    }
  }

  private record(side: Side, turn: TacticalTurn) {
    this.turns[side] = turn;
    this.log = [...this.log.slice(1 - LOG_LIMIT), { ...turn, side }];
  }

  step(game: GameState, pace: number) {
    const table = game.tt!;
    table.tactical ??= { plans: {}, landing: null };
    table.tactical.live = true;
    const incoming = table.strokes[table.lastHitter]?.tick;
    const turn = this.active;
    if (turn && this.isCurrent(turn, game) && !turn.applied && game.tick >= turn.applyTick) this.apply(turn);
    if (game.tick % 6 === 0) footwork(game);
    step(game);
    if (game.phase !== 'play') {
      this.active = null;
      table.tactical.plans = {};
      return;
    }
    const stroke = table.strokes[table.lastHitter];
    if (stroke && stroke.tick !== incoming) {
      footwork(game);
      this.begin(game, stroke.tick, pace);
    }
  }

  private isCurrent(turn: TurnWindow, game = turn.game) {
    const table = game.tt!;
    return this.active === turn && turn.game === game && game.phase === 'play' && game.pointId === turn.point
      && table.lastHitter !== turn.side && table.strokes[table.lastHitter]?.tick === turn.strokeTick;
  }

  private begin(game: GameState, strokeTick: number, pace: number) {
    const contactAt = this.now();
    const table = game.tt!, side = otherSide(table.lastHitter);
    this.active = null;
    const contact = projectTableTennis(game.ball, table, side);
    // Reserve six physics ticks before contact. Both receivers get the same rule.
    const windowTicks = Math.min(Math.floor(DECISION_DEADLINE_MS * pace / (1000 * DT)), Math.floor(contact.time / DT) - 6);
    const applyTick = game.tick + Math.max(0, windowTicks);
    const shots = table.hard ? HARD_SHOTS : ['safe', 'deep', 'drop'] as const;
    const options = shots.flatMap(shot => {
      const option = forecast(game, side, shot, pace);
      return option ? [option] : [];
    });
    if (!options.length) {
      table.tactical!.plans[side] = 'safe';
      this.record(side, { strokeTick, applyTick, status: 'unreachable', source: 'fallback', reason: 'No legal return forecast' });
      return;
    }
    const fallback = options[0].shot;
    const windowMs = Math.round(windowTicks * DT * 1000 / pace);
    if (options.length === 1 || windowMs <= 0) {
      table.tactical!.plans[side] = fallback;
      this.record(side, {
        strokeTick, applyTick: game.tick, status: 'fallback', source: 'fallback', shot: fallback,
        reason: options.length === 1 ? 'Only legal return' : 'Shot too close',
      });
      return;
    }
    const turn: TurnWindow = {
      game, side, strokeTick, point: game.pointId, applyTick,
      deadline: contactAt + windowMs, fallback, options: options.map(option => option.shot), applied: false,
    };
    this.active = turn;
    this.turns[side] = { strokeTick, applyTick, status: 'choosing', source: 'fallback' };
    const script = scriptFor(table.hard, side);
    if (script) {
      turn.answer = { source: 'scripted', shot: script.shots.find(shot => turn.options.includes(shot)) ?? fallback };
      return;
    }
    const read: ShotRead = {
      scenario: table.hard ? 'hard rally' : 'live rally', ownPaddleY: game.paddles[side], opponentPaddleY: game.paddles[otherSide(side)],
      contactY: contact.y, contactHeight: contact.height, flightMs: contact.time * 1000 / pace,
      applyAfterMs: windowMs, pace, opponentReactionMs: 0, rally: game.rally, point: game.pointId, options,
    };
    if (table.hard) read.matchContext = {
      ownScore: game.score[side], opponentScore: game.score[table.lastHitter],
      incomingShot: table.strokes[table.lastHitter]?.tactic ?? 'serve',
    };
    const isCurrent = () => this.isCurrent(turn) && !turn.applied && this.now() <= turn.deadline;
    void this.pick(side, read, isCurrent).then(answer => {
      if (isCurrent()) turn.answer = answer;
    }, () => {
      if (isCurrent()) turn.answer = { source: 'fallback', reason: 'Provider unavailable' };
    });
  }

  private apply(turn: TurnWindow) {
    const { game, side, answer, strokeTick, applyTick, fallback } = turn;
    turn.applied = true;
    const chosen = answer?.source !== 'fallback' && answer?.shot && turn.options.includes(answer.shot) ? answer.shot : undefined;
    const shot = chosen ?? fallback;
    game.tt!.tactical!.plans[side] = shot;
    if (chosen) this.intents[side]++;
    this.record(side, {
      strokeTick, applyTick, shot, ms: answer?.ms, status: chosen ? 'selected' : 'fallback',
      source: chosen ? answer!.source : 'fallback', reason: chosen ? undefined : answer?.reason ?? 'Decision deadline missed',
    });
  }
}
