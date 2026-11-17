import { choice, type TypeSafeClientConfig } from '@typesafe-ai/sdk';
import { BENCHMARK_PACE, DECISION_DEADLINE_MS, TACTIC_LABELS, type ShotRead } from '../src/benchmark';
import { TT_PADDLE_ACCELERATION, TT_PADDLE_SPEED, TT_REACH, type TacticalShot } from '../src/table-tennis';
import { createJevClient, type ProviderConfig } from './jev';
import { choiceAnswer, fetchLuna, type LunaConfig } from './luna';

export interface TacticalDecision {
  shot?: TacticalShot;
  ms: number;
  error?: 'timeout' | 'unavailable' | 'invalid' | 'rate-limited';
  status?: number;
  retryAfterMs?: number;
}
export type TacticalBrain = (read: ShotRead) => Promise<TacticalDecision>;
const instruction = [
  'You are returning a shot in open-table robot table tennis. Choose one feasible return to win the point.',
  'A shared motor controller positions the racket and executes the chosen shot.',
  'Coordinates are in pixels. For landingDepth, 0 is your end, 500 the net, 1000 the opponent’s end.',
  `The opponent starts moving ${DECISION_DEADLINE_MS} ms after your return. Its speed is at most ${TT_PADDLE_SPEED * BENCHMARK_PACE} px/s with ${TT_PADDLE_ACCELERATION * BENCHMARK_PACE ** 2} px/s² acceleration and a racket reach of ${TT_REACH} px.`,
  'Opponent travel is the predicted lateral displacement to center the racket.',
].join(' ');
const question = 'Which return should the robot play?';
function describe(read: ShotRead) {
  return {
    paddleY: Math.round(read.ownPaddleY),
    opponentY: Math.round(read.opponentPaddleY),
    incomingY: Math.round(read.contactY),
    contactHeightMeters: Math.round(read.contactHeight * 100) / 100,
    incomingFlightMs: Math.round(read.flightMs),
    options: read.options.map(option => ({
      id: option.shot,
      landingDepth: 1000 - Math.round(option.landing.x),
      landingY: Math.round(option.landing.y),
      opponentTravelPx: Math.round(option.opponentTravel),
      opponentFlightMs: Math.round(option.flightMs),
    })),
  };
}
function choiceOptions(read: ShotRead) {
  return read.options.map(({shot}) => ({ value: shot, description: TACTIC_LABELS[shot] }));
}
function retryAfter(response: Response) {
  const retry = response.headers.get('retry-after');
  const retryMs = retry === null ? 0 : Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
  return Math.max(0, Number.isFinite(retryMs) ? retryMs : 0);
}
function failure(error: unknown): TacticalDecision['error'] {
  return error instanceof Error && /timeout|abort/i.test(error.name) ? 'timeout' : 'unavailable';
}
export function tacticalJev(config: ProviderConfig, transport?: TypeSafeClientConfig['fetch']): TacticalBrain {
  const guardedTransport = transport ?? fetch;
  let response: Response | undefined;
  const client = createJevClient(config, async (input, init) => {
    response = await guardedTransport(input, init);
    return response;
  });
  return async read => {
    const start = performance.now(), ms = () => Math.round(performance.now() - start);
    response = undefined;
    const options = choiceOptions(read);
    let answer: string | undefined;
    try {
      const { answers } = await client.systemOne({
        model: config.model,
        state: { instruction, situation: describe(read) },
        questions: { shot: choice(question, Object.fromEntries(options.map(option => [option.value, option.description]))) },
      }, { signal: AbortSignal.timeout(1500) });
      answer = answers.shot?.choice;
    } catch (error) {
      const status: number | undefined = (response as Response | undefined)?.status;
      if (status === 429) return { ms: ms(), error: 'rate-limited', status, retryAfterMs: response ? retryAfter(response) : 0 };
      return { ms: ms(), status, error: status === 200 ? 'invalid' : failure(error) };
    }
    const selected = options.find(option => option.value === answer);
    return selected ? { shot: selected.value, ms: ms() } : { ms: ms(), error: 'invalid' };
  };
}
export function tacticalLuna(config: LunaConfig, transport?: typeof fetch): TacticalBrain {
  return async read => {
    const start = performance.now(), ms = () => Math.round(performance.now() - start);
    const options = choiceOptions(read);
    let response: Response | undefined;
    try {
      response = await fetchLuna(config, {
        model: config.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: instruction }, { type: 'input_json', data: describe(read) }] }],
        questions: [{ type: 'choice', name: 'shot', instructions: question, choices: options }],
      }, transport);
      if (response.status === 429) return { ms: ms(), error: 'rate-limited', status: 429, retryAfterMs: retryAfter(response) };
      if (!response.ok) return { ms: ms(), error: 'unavailable', status: response.status };
      const body = await response.json() as { answers?: unknown; model?: string };
      if (!/^gpt-6-luna(?:-|$)/.test(body.model ?? '')) return { ms: ms(), error: 'invalid', status: response.status };
      const answer = choiceAnswer(body.answers, 'shot', options.map(option => option.value));
      return { ms: ms(), shot: options.find(option => option.value === answer.choice)!.value };
    } catch (error) {
      return { ms: ms(), status: response?.status, error: response?.ok ? 'invalid' : failure(error) };
    }
  };
}
