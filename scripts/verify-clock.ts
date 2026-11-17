import assert from 'node:assert/strict';
import { FixedClock } from '../worker/clock';
import { createGame, startServe, step } from '../src/physics';
const game=createGame();startServe(game);
const direct=structuredClone(game);const clock=new FixedClock(0);
// Irregular callbacks, including coalesced timers, must agree with fixed stepping.
for(const ms of [31,70,96,138,167,203,240,266,301,340,371,400,449,480,511,550,580,620,650,690,720,761,800,840,880,910,951,1000])clock.advance(ms,()=>step(game));
for(let i=0;i<120;i++)step(direct);
assert.deepEqual(game,direct);assert.equal(game.tick,120);
const before=game.tick;assert.equal(clock.advance(6000,()=>step(game)),30);assert.equal(game.tick-before,30);assert.equal(clock.droppedSeconds,4.75);
assert.equal(clock.advance(6000,()=>step(game)),0);
console.log('PASS: irregular Workers scheduling → deterministic 120 Hz; 5 s stall capped to 30 steps with no runaway catch-up.');

const {roomOptions}=await import('../worker/room-options');
const request=(body:string)=>new Request('https://arena.example/api/rooms',{method:'POST',body});
assert.deepEqual(await roomOptions(request('')), {matchup:'jev-vs-jev'});
assert.deepEqual(await roomOptions(request('{"matchup":"jev-vs-luna"}')), {matchup:'jev-vs-luna'});
for(const [body,status] of [['{"matchup":"unknown"}',400],['null',400],['{',400],['x'.repeat(1025),413]] as const){const result=await roomOptions(request(body));assert(result instanceof Response);assert.equal(result.status,status);}
console.log('PASS: hosted matchup defaults/selection; unknown, malformed and oversized room options rejected.');

const {gameSpeed}=await import('../src/pace');
const tt=createGame('table-tennis');startServe(tt);const expected=structuredClone(tt),slowClock=new FixedClock(0);
assert.equal(gameSpeed(tt,'jev-vs-luna'),.5);assert.equal(gameSpeed(tt,'jev-vs-jev'),1);
assert.equal(gameSpeed(createGame(),'jev-vs-luna'),1);
for(let ms=25;ms<=1000;ms+=25)slowClock.advance(ms,()=>step(tt),gameSpeed(tt,'jev-vs-luna'));
for(let i=0;i<60;i++)step(expected);
assert.deepEqual(tt,expected);assert.equal(tt.tick,60);
console.log('PASS: half-speed applies identical fixed substeps to the whole table-tennis world; Jev-vs-Jev and classic Pong keep full speed.');
