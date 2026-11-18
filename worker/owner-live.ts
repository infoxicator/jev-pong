import type { Env } from './index';
import { accessConfigured, verifyAccessOwner } from './access';
import { isPairingKey, isPairingRoom, pairingChallenge, LIVE_PAIR_PATH, OWNER_LIVE_PATH } from '../src/live-pairing';
import { isMatchup, readSmallBody } from './room-options';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const privateHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
export const liveConfigured = (env: Env) => accessConfigured(env) && Boolean(env.TYPESAFE_API_KEY?.trim());
const roomStub = (env: Env, room: string) => env.ROOMS.get(env.ROOMS.idFromName(room));

export async function handlePairing(req: Request, env: Env) {
  const respond = (data: unknown, status: number) => Response.json(data, {status, headers: {...cors, ...privateHeaders}});
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  if (req.method !== 'POST') return respond({error: 'Use POST.'}, 405);
  if (!liveConfigured(env)) return respond({error: 'Owner live matches are unavailable.'}, 503);
  try {
    const raw = await readSmallBody(req);
    if (raw === null) return respond({error: 'Pairing request too large.'}, 413);
    const {room, key} = JSON.parse(raw) as {room?: unknown; key?: unknown};
    if (!isPairingRoom(room) || !isPairingKey(key)) return respond({error: 'Invalid pairing.'}, 400);
    const url = new URL(req.url);
    const claim = url.pathname === `${LIVE_PAIR_PATH}/claim`;
    if (!claim) {
      const limit = await env.ROOM_CREATION.limit({key: `live-pair:${req.headers.get('CF-Connecting-IP') ?? 'local'}`});
      if (!limit.success) return respond({error: 'Try again in a minute.'}, 429);
    }
    const challenge = claim ? await pairingChallenge(key) : key;
    const internal = await roomStub(env, room).fetch(new Request(`${url.origin}/${claim ? 'claim-live' : 'pair-live'}`, {
      method: 'POST', body: challenge,
    }));
    return new Response(internal.body, {status: internal.status, headers: {...cors, ...privateHeaders, 'Content-Type':'application/json'}});
  } catch {
    return respond({error: 'Unable to pair this view.'}, 400);
  }
}

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Jev Pong</title>
<style>body{margin:12vh auto;padding:0 20px;max-width:32rem;background:#121718;color:#eeeae1;font:1rem/1.6 system-ui}
h1{line-height:1.15}form{display:grid;justify-items:start;gap:1rem}select,button{font:inherit;padding:.45rem .65rem}
button{background:#d9ff92;color:#151c16;border:0;border-radius:.25rem;cursor:pointer}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`, {
    status,
    headers: {
      ...privateHeaders,
      // A no-referrer form navigation can suppress the browser's Origin header.
      'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    },
  });
}

export async function handleOwnerLive(req: Request, env: Env, verifyOwner: typeof verifyAccessOwner) {
  const url = new URL(req.url);
  if (!liveConfigured(env)) return page('Live matches are unavailable', '<p>Configure this game’s Cloudflare Access application and provider key.</p>', 503);
  if (req.method !== 'GET' && req.method !== 'POST') return page('Method unavailable', '', 405);
  if (req.method === 'POST' && req.headers.get('Origin') !== url.origin) return page('Request rejected', '<p>Submit the form from this page.</p>', 403);
  const unauthorized = () => page('Owner sign-in required', '<p>Sign in through Cloudflare Access to continue.</p>', 403);
  const room = url.searchParams.get('pair');
  if (!isPairingRoom(room)) return page('Pair an arena first', '<p>Open Jev Pong and choose Start live match.</p>', 400);
  const stub = roomStub(env, room);
  if (req.method === 'GET') {
    if (!await verifyOwner(req, env)) return unauthorized();
    const paired = await stub.fetch(`${url.origin}/pending-live`);
    if (!paired.ok) return page('Pairing unavailable', '<p>Return to Jev Pong and request a new pairing.</p>', 410);
    const {challenge} = await paired.json() as {challenge:string};
    const luna = env.OPENAI_API_KEY?.trim() ? 'Jev vs Luna' : 'Jev vs Luna (mock Luna)';
    return page('Confirm live match', `<p>Check that your Jev Pong view shows pairing code <strong>${room.slice(0,8)}</strong>.</p>
<p>Starting a match can use your provider quota. The match ends after one game or 15 minutes.</p>
<form method="post" action="${OWNER_LIVE_PATH}?pair=${room}"><input type="hidden" name="challenge" value="${challenge}"><label>Matchup <select name="matchup">
<option value="jev-vs-jev">Jev vs Jev</option><option value="jev-vs-luna">${luna}</option></select></label>
<button type="submit" name="confirm" value="start">Confirm and start live match</button></form>`);
  }
  if (req.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return page('Confirmation required', '<p>Submit the confirmation form.</p>', 400);
  const raw = await readSmallBody(req);
  if (raw === null) return page('Invalid confirmation', '', 413);
  const form = new URLSearchParams(raw), matchup = form.get('matchup'), challenge = form.get('challenge');
  if (form.get('confirm') !== 'start' || !isMatchup(matchup) || !isPairingKey(challenge)) return page('Confirmation required', '<p>Choose a matchup and submit the confirmation form.</p>', 400);
  if (!await verifyOwner(req, env)) return unauthorized();
  const response = await stub.fetch(new Request(`${url.origin}/start-live`, {method: 'POST', body: JSON.stringify({matchup,challenge})}));
  if (!response.ok) return page('Pairing unavailable', '<p>Return to Jev Pong and request a new pairing.</p>', response.status);
  return page('Live match started', '<p>Return to the Jev Pong view to watch the match.</p>');
}
