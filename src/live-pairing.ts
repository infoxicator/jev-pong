export const OWNER_LIVE_PATH = '/owner/live';
export const LIVE_PAIR_PATH = '/api/live-pair';
export const OWNER_LIVE_ORIGIN = 'https://jev-vs-jev-pong.jev-vs-luna.workers.dev';
export const PAIRING_MS = 5 * 60_000;
export const isPairingRoom = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const isPairingKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export const createPairingKey = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function pairingChallenge(verifier: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
