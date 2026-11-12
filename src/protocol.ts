import type { GameState, Side } from './physics';
import type { Decision } from './agents';
export interface ArenaState {
  type: 'state'; game: GameState; connected: Record<Side, boolean>; serverTime: number;
  decisions: Record<Side, Decision | null>; intents: Record<Side, number>; mode: string;
}
export type ServerMessage = ArenaState | {type:'joined';side:Side|null;reason?:string} | {type:'decision';decision:Decision} | {type:'pong';sent:number} | {type:'replay';frames:GameState[]} | {type:'error';message:string};
export type ClientMessage = {type:'decide'} | {type:'intent';sequence:number;target_y:number} | {type:'ping';sent:number} | {type:'replay'} | {type:'reset'};
