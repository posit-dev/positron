/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createHash } from 'crypto';
import {
	buildAuthorizeUrl,
	exchangeCodeForTokens,
	generatePkcePair,
	generateState,
	normalizeHost,
	refreshTokens,
} from '../databricksOAuth';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function mockFetch(
	handler: (url: string, init?: RequestInit) => Response
): { calls: { url: string; init?: RequestInit }[] } {
	const calls: { url: string; init?: RequestInit }[] = [];
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		return handler(url, init);
	};
	return { calls };
}

function tokenResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

suite('databricksOAuth', () => {
	let originalFetch: typeof globalThis.fetch;

	setup(() => {
		originalFetch = globalThis.fetch;
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
	});

	suite('generatePkcePair', () => {
		test('verifier is 32 bytes of base64url', () => {
			const { verifier } = generatePkcePair();
			// 32 bytes -> 43 base64url chars, no padding.
			assert.strictEqual(verifier.length, 43);
			assert.match(verifier, BASE64URL_PATTERN);
		});

		test('challenge is base64url(sha256(verifier))', () => {
			const { verifier, challenge } = generatePkcePair();
			const expected = createHash('sha256').update(verifier).digest('base64url');
			assert.strictEqual(challenge, expected);
			assert.match(challenge, BASE64URL_PATTERN);
		});

		test('pairs are unique', () => {
			const a = generatePkcePair();
			const b = generatePkcePair();
			assert.notStrictEqual(a.verifier, b.verifier);
		});
	});

	suite('generateState', () => {
		test('is 16 bytes of base64url', () => {
			const state = generateState();
			// 16 bytes -> 22 base64url chars, no padding.
			assert.strictEqual(state.length, 22);
			assert.match(state, BASE64URL_PATTERN);
		});
	});

	suite('normalizeHost', () => {
		test('trims whitespace', () => {
			assert.strictEqual(
				normalizeHost('  https://example.cloud.databricks.com  '),
				'https://example.cloud.databricks.com'
			);
		});

		test('prepends https:// when no scheme', () => {
			assert.strictEqual(
				normalizeHost('example.cloud.databricks.com'),
				'https://example.cloud.databricks.com'
			);
		});

		test('keeps an existing scheme', () => {
			assert.strictEqual(
				normalizeHost('http://localhost:8080'),
				'http://localhost:8080'
			);
		});

		test('strips trailing slashes', () => {
			assert.strictEqual(
				normalizeHost('https://example.cloud.databricks.com///'),
				'https://example.cloud.databricks.com'
			);
		});

		test('combines all normalizations', () => {
			assert.strictEqual(
				normalizeHost(' example.cloud.databricks.com/ '),
				'https://example.cloud.databricks.com'
			);
		});
	});

	suite('buildAuthorizeUrl', () => {
		test('builds the authorize URL with exact params', () => {
			const url = new URL(buildAuthorizeUrl(
				'https://example.cloud.databricks.com', 'the-state', 'the-challenge'
			));
			assert.strictEqual(url.origin, 'https://example.cloud.databricks.com');
			assert.strictEqual(url.pathname, '/oidc/v1/authorize');
			assert.strictEqual(url.searchParams.get('client_id'), 'databricks-cli');
			assert.strictEqual(url.searchParams.get('response_type'), 'code');
			assert.strictEqual(url.searchParams.get('redirect_uri'), 'http://localhost:8020');
			assert.strictEqual(url.searchParams.get('scope'), 'all-apis offline_access');
			assert.strictEqual(url.searchParams.get('state'), 'the-state');
			assert.strictEqual(url.searchParams.get('code_challenge'), 'the-challenge');
			assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
			assert.strictEqual([...url.searchParams.keys()].length, 7);
		});

		test('normalizes the host', () => {
			const url = buildAuthorizeUrl('example.cloud.databricks.com/', 's', 'c');
			assert.ok(url.startsWith('https://example.cloud.databricks.com/oidc/v1/authorize?'));
		});
	});

	suite('exchangeCodeForTokens', () => {
		test('posts the form-encoded exchange request and computes expiry', async () => {
			const before = Date.now();
			const { calls } = mockFetch(() => tokenResponse({
				access_token: 'access-1',
				refresh_token: 'refresh-1',
				expires_in: 3600,
				token_type: 'Bearer',
			}));

			const tokens = await exchangeCodeForTokens(
				'https://example.cloud.databricks.com', 'the-code', 'the-verifier'
			);

			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].url, 'https://example.cloud.databricks.com/oidc/v1/token');
			assert.strictEqual(calls[0].init?.method, 'POST');
			assert.strictEqual(
				(calls[0].init?.headers as Record<string, string>)['Content-Type'],
				'application/x-www-form-urlencoded'
			);
			const body = new URLSearchParams(calls[0].init?.body as string);
			assert.strictEqual(body.get('grant_type'), 'authorization_code');
			assert.strictEqual(body.get('code'), 'the-code');
			assert.strictEqual(body.get('redirect_uri'), 'http://localhost:8020');
			assert.strictEqual(body.get('client_id'), 'databricks-cli');
			assert.strictEqual(body.get('code_verifier'), 'the-verifier');

			assert.strictEqual(tokens.accessToken, 'access-1');
			assert.strictEqual(tokens.refreshToken, 'refresh-1');
			assert.ok(tokens.expiresAt >= before + 3600 * 1000);
			assert.ok(tokens.expiresAt <= Date.now() + 3600 * 1000);
		});

		test('throws an informative error on non-200', async () => {
			mockFetch(() => tokenResponse({
				error: 'invalid_grant',
				error_description: 'Authorization code expired',
			}, 400));

			await assert.rejects(
				() => exchangeCodeForTokens('https://example.com', 'code', 'verifier'),
				(err: Error) =>
					err.message.includes('token exchange') &&
					err.message.includes('400') &&
					err.message.includes('Authorization code expired')
			);
		});

		test('throws on non-200 with a non-JSON body', async () => {
			mockFetch(() => new Response('Bad Gateway', {
				status: 502, statusText: 'Bad Gateway',
			}));

			await assert.rejects(
				() => exchangeCodeForTokens('https://example.com', 'code', 'verifier'),
				(err: Error) => err.message.includes('502')
			);
		});
	});

	suite('refreshTokens', () => {
		test('posts the form-encoded refresh request', async () => {
			const { calls } = mockFetch(() => tokenResponse({
				access_token: 'access-2',
				refresh_token: 'refresh-2',
				expires_in: 1800,
			}));

			const tokens = await refreshTokens(
				'https://example.cloud.databricks.com', 'refresh-1'
			);

			assert.strictEqual(calls[0].url, 'https://example.cloud.databricks.com/oidc/v1/token');
			const body = new URLSearchParams(calls[0].init?.body as string);
			assert.strictEqual(body.get('grant_type'), 'refresh_token');
			assert.strictEqual(body.get('refresh_token'), 'refresh-1');
			assert.strictEqual(body.get('client_id'), 'databricks-cli');
			assert.strictEqual([...body.keys()].length, 3);

			// Rotated refresh token is returned.
			assert.strictEqual(tokens.accessToken, 'access-2');
			assert.strictEqual(tokens.refreshToken, 'refresh-2');
		});

		test('keeps the old refresh token when the response omits one', async () => {
			mockFetch(() => tokenResponse({
				access_token: 'access-2',
				expires_in: 1800,
			}));

			const tokens = await refreshTokens('https://example.com', 'refresh-1');
			assert.strictEqual(tokens.refreshToken, 'refresh-1');
		});

		test('throws an informative error on non-200', async () => {
			mockFetch(() => tokenResponse({
				error: 'invalid_grant',
				error_description: 'Refresh token revoked',
			}, 401));

			await assert.rejects(
				() => refreshTokens('https://example.com', 'refresh-1'),
				(err: Error) =>
					err.message.includes('token refresh') &&
					err.message.includes('Refresh token revoked')
			);
		});
	});
});
