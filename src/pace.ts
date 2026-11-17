import type { Matchup } from './match';
import type { GameState } from './physics';
/** Slow the entire shared simulation, never one player or its decision cadence. */
export function gameSpeed(game:GameState,matchup:Matchup):number{
  return game.tt&&matchup==='jev-vs-luna'?.5:1;
}
