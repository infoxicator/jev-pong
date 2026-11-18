import type { GameState, Side, Rules } from './physics';
import type { Decision } from './agents';
import type { Matchup, PlayerInfo } from './match';
import type { TacticalLogEntry, TacticalTurn } from './live-tactics';
import type { HardMatch } from './hard-match';
export interface ArenaState {
  type: 'state'; gameSpeed?: number; game: GameState; connected: Record<Side, boolean>; serverTime: number;
  decisions: Record<Side, Decision | null>; intents: Record<Side, number>; mode: string; matchup: Matchup; players: Record<Side, PlayerInfo>;
  privateMatchEnded?: boolean;
  tactics?: Record<Side, TacticalTurn | null>;
}
export type ServerMessage = ArenaState | {type:'tactical-log';entries:readonly TacticalLogEntry[]} | {type:'joined';side:Side|null;reason?:string;canReset?:boolean} | {type:'decision';decision:Decision} | {type:'decision-cancelled'} | {type:'cooldown';retryAfterMs:number} | {type:'pong';sent:number} | {type:'replay';frames:GameState[]} | {type:'error';message:string};
export type ClientMessage = {type:'join';side:Side|null;token:string;rules?:Rules} | {type:'decide'} | {type:'intent';sequence:number;target_y:number} | {type:'ping';sent:number} | {type:'replay'} | {type:'reset'} | {type:'matchup';matchup:Matchup} | {type:'table-settings';hard:HardMatch|null};
