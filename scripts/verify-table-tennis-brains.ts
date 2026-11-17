/** Exercise real decision adapters against loopback stand-ins. Never reads .env or calls a provider. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { FixedClock } from '../src/clock';
import { gameSpeed } from '../src/pace';
import { createBrain } from '../server/jev';
import { createLunaBrain, LUNA_MODEL } from '../server/luna';
import { createGame,startServe,step,setIntent,SIDES,H,PADDLE_H,type Side } from '../src/physics';
import { snapshot,intercept,mockBrain,type Decision,type Snapshot } from '../src/agents';
let fixtureTokens=100;
let failure:'none'|'429'|'malformed'='none';
const expected=new Map<Side,Snapshot>(),calls={jev:0,luna:0},fixtureErrors:string[]=[];
const fixture=createServer(async(req,res)=>{
  try{
    assert.equal(req.method,'POST');assert.equal(req.headers.authorization,'Bearer table-tennis-fixture-only');
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
    const jev=req.url==='/v1/systemone';assert(jev||req.url==='/v1/decisions');calls[jev?'jev':'luna']++;
    const state=jev?body.state:body.input[0].content[1].data,prompt=jev?state.game:body.input[0].content[0].text;
    assert.match(prompt,/Table tennis/);assert.match(prompt,/NO wall bounces|No side walls/);
    assert.equal(body.model,jev?'jev-latest':LUNA_MODEL);
    const s=expected.get(state.side)!;assert(s?.tt);
    assert.equal(jev?state.ball_height:state.height,s.tt.height+0);assert.equal(state.spin,s.tt.spin+0);
    assert.equal(jev?state.last_stroke:state.shot,s.tt.shot);assert.equal(state.projected_intercept_y,Math.round(intercept(s))+0);
    assert.equal(jev?Object.keys(body.questions.target.criteria).length:body.questions[0].choices.length,17);
    res.setHeader('Content-Type','application/json');
    if(failure==='429'){res.writeHead(429);res.end(JSON.stringify({error:{message:'Local fixture rate limit'}}));return;}
    // Choose only from serialized evidence: no fixture access to hidden game state for decision-making.
    const index=Math.max(0,Math.min(16,Math.round((state.projected_intercept_y-PADDLE_H/2)/((H-PADDLE_H)/16))));
    const target=PADDLE_H/2+index*(H-PADDLE_H)/16,move=Math.abs(target-state.paddle)<7?'stay':target<state.paddle?'up':'down';
    const choices={target:failure==='malformed'?'lane_999':`lane_${index}`,move,taunt:'line_0'};
    const answers=jev?Object.fromEntries(Object.entries(choices).map(([name,choice])=>[name,{type:'choice',choice,confidence:.9,probabilities:{[choice]:1}}])):Object.entries(choices).reverse().map(([name,choice])=>({name,type:'choice',choice,confidence:.9,probabilities:[{value:choice,probability:1}]}));
    res.end(JSON.stringify({model:jev?'jev-latest':LUNA_MODEL,answers,usage:{input_tokens:fixtureTokens,output_tokens:0,total_tokens:fixtureTokens}}));
  }catch(error){fixtureErrors.push(String(error));res.writeHead(500);res.end('{}');}
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const address=fixture.address();assert(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
const guardedFetch:typeof fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  assert.equal(url.origin,origin,'External network request forbidden');
  return fetch(input,init);
};
const jev=()=>createBrain({mock:false,provider:'typesafe',apiKey:'table-tennis-fixture-only',baseURL:origin,model:'jev-latest'},guardedFetch);
const luna=()=>createLunaBrain({mock:false,apiKey:'table-tennis-fixture-only',baseURL:`${origin}/v1`,model:LUNA_MODEL,intervalMs:600,tokensPerMinute:60000},guardedFetch);
try{
  for(const [matchup,tokens] of [['jev-vs-jev',100],['jev-vs-luna',100],['jev-vs-luna',1000]] as const){
    fixtureTokens=tokens;
    const s=createGame('table-tennis');startServe(s);
    const brains={left:jev(),right:matchup==='jev-vs-luna'?luna():jev()},sources={left:'jev',right:matchup==='jev-vs-luna'?'luna':'jev'};
    const next={left:0,right:0},sequences={left:0,right:0},returns={left:0,right:0},misses={left:0,right:0},min={left:280,right:280},max={left:280,right:280},lastIntent={left:0,right:0};
    const pending:Partial<Record<Side,{tick:number;point:number;decision:Decision}>>={};let points=0,cancelled=0;
    const clock=new FixedClock(0),speed=gameSpeed(s,matchup);
    // Five wall-clock minutes, replaying observed 164ms Jev / 285ms Luna latency.
    // HTTP fixtures run immediately; virtual time models their arrival without paid calls or sleeps.
    for(let tick=0;tick<36000;tick++){
      for(const side of SIDES){
        const reply=pending[side];
        if(reply&&tick>=reply.tick){
          next[side]=tick+Math.ceil((reply.decision.retryAfterMs??0)*120/1000);
          if(reply.point===s.pointId){setIntent(s,side,reply.decision.action.target_y);lastIntent[side]=s.tick;}
          else cancelled++; // Explicit cancellation releases the browser's awaiting flag.
          delete pending[side];
        }
        // Same 200ms browser polling and cooldown starting AFTER response as production.
        if(tick%24===0&&!pending[side]&&tick>=next[side]&&s.phase!=='won'&&s.phase!=='lobby'){
          const input=snapshot(s,side);expected.set(side,input);const d=await brains[side](input,++sequences[side]);
          assert.equal(d.source,sources[side],fixtureErrors.join('\n'));assert.equal(d.sequence,sequences[side]);assert.equal(d.warning,undefined);
          pending[side]={tick:tick+Math.ceil((sources[side]==='luna'?285:164)*120/1000),point:s.pointId,decision:d};
        }
      }
      clock.advance((tick+1)*1000/120,()=>{
        for(const side of SIDES)if(s.tick-lastIntent[side]>240)setIntent(s,side,280);
        const rally=s.rally,point=s.pointId;step(s);
        if(s.rally>rally)returns[s.tt!.lastHitter]++;
        if(s.pointId>point){points++;if(s.tt!.reason==='MISSED RETURN')misses[s.lastScorer==='left'?'right':'left']++;}
        for(const side of SIDES){min[side]=Math.min(min[side],s.paddles[side]);max[side]=Math.max(max[side],s.paddles[side]);}
      },speed);
    }
    assert(points>10);assert(s.bestRally>=2);assert(cancelled>0);
    for(const side of SIDES){assert(returns[side]>10,`${matchup}: ${side} returns=${returns[side]}`);assert(max[side]-min[side]>100);}
    if(matchup==='jev-vs-luna'&&tokens===100)assert(returns.right/(returns.right+misses.right)>=.5,'Luna must return at least half its reachable attempts with a valid request-time choice');
    console.log(`PASS ${matchup}: ${points} points, ${returns.left}/${returns.right} legal returns, ${misses.left}/${misses.right} misses, best rally ${s.bestRally}; ${cancelled} cancelled stale replies. Actual structured adapters; ${matchup==='jev-vs-luna'?`164/285ms latency, ${Math.max(600,tokens*1.25)}ms Luna cooldown after response`:'164ms latency on both sides'}, 200ms polling, ${speed}× shared pace.`);
    for(const mode of ['429','malformed'] as const){
      failure=mode;
      for(const side of SIDES){const input=snapshot(s,side);expected.set(side,input);const d=await brains[side](input,++sequences[side]);assert.equal(d.source,'fallback');assert.deepEqual(d.action,mockBrain(input));setIntent(s,side,d.action.target_y);}
      failure='none';
    }
  }
  assert.deepEqual(fixtureErrors,[]);assert(calls.jev>100&&calls.luna>100);
  console.log(`PASS: table-tennis 429/malformed fallbacks; ${calls.jev} Jev + ${calls.luna} Luna requests, all guarded loopback HTTP. No real API calls or credentials.`);
}finally{fixture.closeAllConnections();fixture.close();await once(fixture,'close');}
