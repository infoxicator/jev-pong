/** Official OpenAI Decisions wire contract, exercised through real HTTP without any paid API calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLunaBrain, lunaConfig, LUNA_MODEL } from '../server/luna';
import { createPlayers } from '../server/players';
import { createGame } from '../src/physics';
import { mockBrain, snapshot } from '../src/agents';
const failures = ['rate-limit', 'server-error', 'malformed', 'refusal', 'missing', 'duplicate', 'invalid-confidence', 'wrong-model', 'timeout'] as const;
let scenario: 'success' | typeof failures[number] = 'success', requests = 0;
const fixture = createServer(async (req, res) => {
  requests++;
  assert.equal(req.url, '/v1/decisions');assert.equal(req.method, 'POST');assert.equal(req.headers.authorization, 'Bearer local-luna-fixture-only');
  let body = '';for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);assert.equal(request.model, LUNA_MODEL);
  assert.equal(request.input[0].role, 'user');assert.equal(request.input[0].content[1].type, 'input_json');assert.equal(request.input[0].content[1].data.side, 'right');
  assert.deepEqual(request.questions.map((q: {name:string;type:string}) => [q.name,q.type]), [['target','choice'],['move','choice'],['taunt','choice']]);
  assert.equal(request.questions[0].choices.length, 17);assert.equal(request.questions[0].choices[8].value, 'lane_8');assert.equal(request.questions[2].choices.length,4);
  if (scenario === 'timeout') { await new Promise(resolve => setTimeout(resolve, 1900));if (res.destroyed) return; }
  res.setHeader('Content-Type', 'application/json');
  if (scenario === 'rate-limit' || scenario === 'server-error') {res.writeHead(scenario === 'rate-limit' ? 429 : 503);res.end(JSON.stringify({error:{message:'Simulated provider failure'}}));return;}
  const answer = (name:string, choice:string) => ({type:'choice',name,choice,confidence:0.93,probabilities:[{value:choice,probability:1}]});
  const answers:unknown[] = [answer('taunt','line_1'),answer('target',scenario === 'malformed' ? 'lane_999' : 'lane_8'),answer('move','down')];
  if(scenario==='refusal')answers[1]={type:'refusal',name:'target'};
  if(scenario==='missing')answers.splice(1,1);
  if(scenario==='duplicate')answers.push(answer('target','lane_8'));
  if(scenario==='invalid-confidence')(answers[1] as {confidence:number}).confidence=2;
  res.end(JSON.stringify({model:scenario==='wrong-model'?'gpt-6-astra':LUNA_MODEL,answers,usage:{input_tokens:100,output_tokens:0,total_tokens:100}}));
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const address=fixture.address();assert(address&&typeof address!=='string');
const config={...lunaConfig({OPENAI_API_KEY:'local-luna-fixture-only'}),baseURL:`http://127.0.0.1:${address.port}/v1`};
try{
  assert.equal(lunaConfig({}).mock,true);assert.equal(lunaConfig({OPENAI_API_KEY:'unused',JEV_MOCK:'1'}).mock,true);assert.equal(lunaConfig({OPENAI_API_KEY:'unused',LUNA_MOCK:'1'}).mock,true);
  assert.throws(()=>lunaConfig({LUNA_MOCK:'0'}));assert.equal(lunaConfig({LUNA_MODEL:'gpt-6-astra'}).model,'gpt-6-luna');
  const brain=createLunaBrain(config),s=snapshot(createGame(),'right');
  const decision=await brain(s,1);assert.equal(decision.source,'luna');assert.equal(decision.action.target_y,280);assert.equal(decision.action.move,'down');assert.equal(decision.action.taunt,'Oops. Did I do that?');assert.equal(decision.action.confidence,.93);
  console.log('PASS: OpenAI POST /v1/decisions, gpt-6-luna, JSON evidence and three typed choice questions; named answers decoded regardless of order.');
  for(const failure of failures){scenario=failure;const before=requests,start=performance.now(),d=await brain(s,2);assert.equal(d.source,'fallback');assert.deepEqual(d.action,mockBrain(s));assert(d.warning?.includes('Luna'));assert.equal(requests-before,1);assert(performance.now()-start<1850);console.log(`PASS: Luna ${failure} -> labeled fallback, one attempt, ${Math.round(performance.now()-start)} ms.`);}
  const none=createPlayers({},'jev-vs-luna');assert.equal(none.mode,'mock');assert.equal(none.players.left.engine,'jev');assert.equal(none.players.right.engine,'luna');assert.equal(none.players.right.model,LUNA_MODEL);
  const mixed=createPlayers({OPENAI_API_KEY:'not-sent'},'jev-vs-luna');assert.equal(mixed.mode,'mixed');assert.equal(mixed.players.left.mock,true);assert.equal(mixed.players.right.mock,false);assert(!JSON.stringify(mixed.players).includes('not-sent'));
  const real=createPlayers({OPENAI_API_KEY:'not-sent',OPENROUTER_API_KEY:'also-not-sent'},'jev-vs-luna');assert.equal(real.mode,'live');assert.equal(real.players.left.provider,'openrouter');assert.equal(real.players.right.provider,'openai');
  const forced=createPlayers({OPENAI_API_KEY:'not-sent',OPENROUTER_API_KEY:'also-not-sent',JEV_MOCK:'1'},'jev-vs-luna');assert.equal(forced.mode,'mock');
  assert.equal((await forced.brains.right(s,3)).source,'mock');assert.equal((await none.brains.left(snapshot(createGame(),'left'),3)).source,'mock');
  console.log('PASS: independent providers, original Jev mode, no-key and forced mocks, mixed live/mock metadata, no credentials in player metadata.');
}finally{fixture.closeAllConnections();fixture.close();await once(fixture,'close');}
