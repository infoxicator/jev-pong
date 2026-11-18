import { beforeAll, describe, expect, it } from 'vitest';
import { verifyAccessOwner } from '../worker/access';

const env = {
  ACCESS_ISSUER: 'https://pong-test.cloudflareaccess.com',
  ACCESS_AUD: 'pong-owner-audience',
  ACCESS_OWNER_EMAIL: 'owner@example.test',
};
const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
const bytes = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encode = (value: unknown) => bytes(new TextEncoder().encode(JSON.stringify(value)));
let keys: CryptoKeyPair, other: CryptoKeyPair, jwk: JsonWebKey;
beforeAll(async () => {
  keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  other = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
});

async function request(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, signingKey = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({alg: 'RS256', kid: 'key-1', ...header})}.${encode({
    iss: env.ACCESS_ISSUER, aud: [env.ACCESS_AUD], exp: now + 60,
    email: env.ACCESS_OWNER_EMAIL, ...claims,
  })}`;
  const signature = await crypto.subtle.sign(algorithm, signingKey, new TextEncoder().encode(data));
  return new Request('https://pong.example.test/owner/live', {headers: {'Cf-Access-Jwt-Assertion': `${data}.${bytes(new Uint8Array(signature))}`}});
}
const fetchKeys: typeof fetch = async (input, options) => {
  expect(String(input)).toBe(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`);
  expect(options?.redirect).toBe('error');
  return Response.json({keys: [{...jwk, kid: 'key-1'}]});
};

describe('Cloudflare Access owner JWT', () => {
  it('requires the exact owner and a token signed by the configured issuer', async () => {
    expect(await verifyAccessOwner(await request(), env, fetchKeys)).toBe(true);
    for (const claims of [
      {iss: 'https://different.cloudflareaccess.com'}, {aud: ['other-app']}, {email: 'other@example.test'},
      {email: 'Owner@example.test'}, {exp: 0}, {exp: undefined}, {nbf: Date.now() / 1000 + 30},
    ]) expect(await verifyAccessOwner(await request(claims), env, fetchKeys)).toBe(false);
    expect(await verifyAccessOwner(await request({}, {alg: 'none'}), env, fetchKeys)).toBe(false);
    expect(await verifyAccessOwner(await request({}, {kid: 'stale'}), env, fetchKeys)).toBe(false);
    expect(await verifyAccessOwner(await request({}, {}, other.privateKey), env, fetchKeys)).toBe(false);
  });

  it('fails closed with missing config, missing JWT, or unavailable signing keys', async () => {
    expect(await verifyAccessOwner(await request(), {...env, ACCESS_AUD: undefined}, fetchKeys)).toBe(false);
    expect(await verifyAccessOwner(new Request('https://pong.example.test/owner/live'), env, fetchKeys)).toBe(false);
    expect(await verifyAccessOwner(await request(), env, async () => new Response(null, {status: 503}))).toBe(false);
  });
});
