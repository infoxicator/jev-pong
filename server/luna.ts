import { H, PADDLE_H, clamp } from '../src/physics';
import { intercept, mockBrain, PERSONAS, type Decision, type Snapshot } from '../src/agents';
export const LUNA_MODEL = 'gpt-6-luna';
export interface LunaConfig { mock: boolean; apiKey?: string; baseURL: string; model: typeof LUNA_MODEL }
export function lunaConfig(env: Record<string, string | undefined>): LunaConfig {
  const mock = env.JEV_MOCK === '1' || env.LUNA_MOCK === '1' || !env.OPENAI_API_KEY;
  if (env.JEV_MOCK !== '1' && env.LUNA_MOCK === '0' && !env.OPENAI_API_KEY) throw new Error('LUNA_MOCK=0 requires OPENAI_API_KEY');
  return { mock, apiKey: env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', model: LUNA_MODEL };
}
interface ChoiceAnswer { type: 'choice'; name: string; choice: string; confidence: number }
function choiceAnswer(answers: unknown, name: string, allowed: string[]): ChoiceAnswer {
  if (!Array.isArray(answers)) throw new Error('Missing Decisions answers');
  const matches = answers.filter((a: unknown): a is ChoiceAnswer => !!a && typeof a === 'object' && (a as ChoiceAnswer).name === name);
  const a = matches[0];
  if (matches.length !== 1 || a.type !== 'choice' || !allowed.includes(a.choice) || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) throw new Error('Invalid or refused Decisions answer');
  return a;
}
export function lunaRequest(s: Snapshot) {
  const persona = PERSONAS[s.side];
  return {
    model: LUNA_MODEL,
    input: [{ role: 'user' as const, content: [
      { type: 'input_text' as const, text: `Pong. Arena 1000x560. y increases downward. Ball reflects at y=7 and 553. Paddle height 86, speed 470px/s. Predict ball arrival at your paddle x=53 (left) or 947 (right). You are ${persona.name}: ${persona.subtitle}. ${persona.motto}` },
      { type: 'input_json' as const, data: { ...s, projected_intercept_y: Math.round(intercept(s)) } },
    ] }],
    questions: [
      { type: 'choice' as const, name: 'target', instructions: 'Choose the paddle center lane that intercepts the approaching ball; recover toward center when it travels away.', choices: Array.from({ length: 17 }, (_, i) => ({ value: `lane_${i}`, description: `Paddle center y=${Math.round(PADDLE_H / 2 + i * (H - PADDLE_H) / 16)} pixels` })) },
      { type: 'choice' as const, name: 'move', instructions: 'Which direction should your paddle move now?', choices: [{ value: 'up', description: 'toward y=0' }, { value: 'down', description: 'toward y=560' }, { value: 'stay', description: 'hold position' }] },
      { type: 'choice' as const, name: 'taunt', instructions: 'Pick a short in-character line for this moment.', choices: persona.taunts.map((description, i) => ({ value: `line_${i}`, description })) },
    ],
  };
}
/** OpenAI Decisions REST API, using Web-standard fetch so Node and Workers share the adapter. */
export function createLunaBrain(config: LunaConfig, transport: typeof fetch = fetch) {
  return async (s: Snapshot, sequence: number): Promise<Decision> => {
    const start = performance.now();
    if (config.mock) {
      await new Promise(resolve => setTimeout(resolve, 45 + s.tick % 47));
      return { action: mockBrain(s), source: 'mock', responseMs: Math.round(performance.now() - start), sequence };
    }
    try {
      if (!config.apiKey) throw new Error('Missing OpenAI key');
      const request = lunaRequest(s);
      const response = await transport(`${config.baseURL.replace(/\/$/, '')}/decisions`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(1500) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Decisions request failed'); }
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('answers' in result) || !('model' in result) || typeof result.model !== 'string' || !/^gpt-6-luna(?:-|$)/.test(result.model)) throw new Error('Unexpected Decisions response');
      const target = choiceAnswer(result.answers, 'target', request.questions[0].choices.map(c => c.value));
      const move = choiceAnswer(result.answers, 'move', ['up', 'down', 'stay']);
      const taunt = choiceAnswer(result.answers, 'taunt', ['line_0', 'line_1', 'line_2', 'line_3']);
      const index = Number(target.choice.replace('lane_', ''));
      return { source: 'luna', sequence, responseMs: Math.round(performance.now() - start), action: { target_y: clamp(PADDLE_H / 2 + index * (H - PADDLE_H) / 16, PADDLE_H / 2, H - PADDLE_H / 2), move: move.choice as 'up' | 'down' | 'stay', taunt: PERSONAS[s.side].taunts[Number(taunt.choice.replace('line_', ''))], confidence: target.confidence } };
    } catch {
      return { action: mockBrain(s), source: 'fallback', responseMs: Math.round(performance.now() - start), sequence, warning: 'Luna Decisions unavailable · heuristic fallback' };
    }
  };
}
