/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { claimToken } from '../tokenAuth.js';

/** A fetch stand-in: registers a token, then returns 401 until `claimAfter` /v1/user calls, then 200. */
function claimingFetch(claimAfter: number): { fetch: typeof fetch; userCalls: () => number; registrationBody: () => unknown } {
	let userCallCount = 0;
	let registrationBody: unknown;
	const fetchFn = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.endsWith('/__api__/tokens') && init?.method === 'POST') {
			registrationBody = init.body ? JSON.parse(init.body as string) : undefined;
			return new Response(JSON.stringify({ token_claim_url: 'https://connect.example.com/__token__/claim/abc' }), { status: 200 });
		}
		if (url.endsWith('/__api__/v1/user')) {
			userCallCount++;
			return userCallCount > claimAfter
				? new Response(JSON.stringify({ username: 'julia' }), { status: 200 })
				: new Response('unauthorized', { status: 401 });
		}
		return new Response('', { status: 404 });
	}) as typeof fetch;
	return { fetch: fetchFn, userCalls: () => userCallCount, registrationBody: () => registrationBody };
}

suite('claimToken', () => {
	test('registers, opens the claim URL, polls until claimed, and returns the credential and user', async () => {
		const { fetch, userCalls, registrationBody } = claimingFetch(2);
		const opened: string[] = [];
		const result = await claimToken('https://connect.example.com', {
			fetch,
			openExternal: async (url) => { opened.push(url); return true; },
			delayMs: 0,
			maxAttempts: 10,
		});

		assert.deepStrictEqual(opened, ['https://connect.example.com/__token__/claim/abc']);
		assert.strictEqual(result.username, 'julia');
		assert.match(result.credential.token, /^T[0-9a-f]{32}$/);
		assert.ok(result.credential.privateKey.length > 0);
		assert.ok(userCalls() >= 3);
		// The registration POST must carry the token id, the public key (so the server can verify
		// signed polls), and user_id 0 (the rsconnect token-pairing convention); a fake that ignored
		// the body would let a missing public key slip through.
		const body = registrationBody() as { token?: string; public_key?: string; user_id?: number };
		assert.deepStrictEqual(
			{ token: body.token, user_id: body.user_id, hasPublicKey: typeof body.public_key === 'string' && body.public_key.length > 0 },
			{ token: result.credential.token, user_id: 0, hasPublicKey: true },
		);
	});

	test('throws when cancelled before the token is claimed', async () => {
		const { fetch, userCalls } = claimingFetch(1000); // never claims in time
		// Expect the cancellation error specifically (not a timeout): a loose /cancelled|timed out/
		// would also pass if cancellation were ignored and the flow merely ran out of attempts.
		await assert.rejects(
			() => claimToken('https://connect.example.com', {
				fetch,
				openExternal: async () => true,
				delayMs: 0,
				maxAttempts: 10,
				isCancelled: () => true,
			}),
			/cancelled/i,
		);
		// Cancellation is checked at the top of the poll loop, so it must short-circuit before any
		// /v1/user poll runs; a nonzero count would mean the flow polled despite being cancelled.
		assert.strictEqual(userCalls(), 0);
	});

	test('throws a clear single sign-on error when registration is redirected off the Connect host', async () => {
		// An SSO-fronted server 307-redirects the unauthenticated POST to its identity provider; fetch
		// follows it, so response.url is on a different host. Detect that and give an actionable error
		// (use an API key) instead of failing later on the identity provider's non-JSON HTML.
		const redirectedToIdp = (async (input: string | URL): Promise<Response> => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.endsWith('/__api__/tokens')) {
				// A Response whose url is the post-redirect location (an external identity provider).
				return new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
			}
			return new Response('', { status: 404 });
		}) as typeof fetch;
		// Response.url is read-only and empty on a constructed Response, so redirect via a wrapper.
		const withRedirectUrl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
			const res = await redirectedToIdp(input, init);
			Object.defineProperty(res, 'url', { value: 'https://posit.okta.com/oauth2/v1/authorize' });
			return res;
		}) as typeof fetch;
		await assert.rejects(
			() => claimToken('https://demo.posit.team', { fetch: withRedirectUrl, openExternal: async () => true, delayMs: 0, maxAttempts: 3 }),
			/single sign-on.*API key/s,
		);
	});

	test('throws a clear error when token registration fails', async () => {
		const failingRegister = (async (input: string | URL): Promise<Response> => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.endsWith('/__api__/tokens')) {
				return new Response('nope', { status: 500 });
			}
			return new Response('', { status: 404 });
		}) as typeof fetch;
		await assert.rejects(
			() => claimToken('https://connect.example.com', { fetch: failingRegister, openExternal: async () => true, delayMs: 0, maxAttempts: 3 }),
			/rejected the sign-in request/,
		);
	});
});
