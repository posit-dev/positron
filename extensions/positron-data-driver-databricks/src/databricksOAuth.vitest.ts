/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as http from 'http';
import {
	createAuthorizationRequest,
	DatabricksOAuthSession,
	discoverEndpoints,
	exchangeAuthorizationCode,
	HttpRequest,
	listenForCallback,
	OAUTH_REDIRECT_URI,
	parseCallbackUrl,
	refreshAccessToken,
} from './databricksOAuth';

const TOKEN_ENDPOINT = 'https://example.cloud.databricks.com/oidc/v1/token';

/** A fake HTTP client that records each request and answers with the given responses, in order. */
function fakeHttp(...responses: Array<{ status: number; body: unknown }>) {
	const calls: Array<{ url: string; method: string; body?: string }> = [];
	const request: HttpRequest = async (url, init) => {
		calls.push({ url, method: init.method, body: init.body });
		const response = responses.shift() ?? { status: 500, body: '' };
		return { status: response.status, body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body) };
	};
	return { request, calls };
}

describe('discoverEndpoints', () => {
	it('reads the endpoints from the workspace metadata document', async () => {
		const { request, calls } = fakeHttp({
			status: 200,
			body: { authorization_endpoint: 'https://w/oidc/v1/authorize', token_endpoint: 'https://w/oidc/v1/token' },
		});

		const endpoints = await discoverEndpoints('w.cloud.databricks.com', request);

		expect({ endpoints, urls: calls.map(c => c.url) }).toEqual({
			endpoints: { authorizationEndpoint: 'https://w/oidc/v1/authorize', tokenEndpoint: 'https://w/oidc/v1/token' },
			urls: ['https://w.cloud.databricks.com/oidc/.well-known/oauth-authorization-server'],
		});
	});

	it('rejects a failed, unreadable, or incomplete document', async () => {
		await expect(discoverEndpoints('w', fakeHttp({ status: 404, body: '' }).request)).rejects.toThrow(/HTTP 404/);
		await expect(discoverEndpoints('w', fakeHttp({ status: 200, body: '<html>' }).request)).rejects.toThrow(/unreadable/);
		await expect(discoverEndpoints('w', fakeHttp({ status: 200, body: { token_endpoint: 'x' } }).request)).rejects.toThrow(/no authorization or token endpoint/);
	});
});

describe('createAuthorizationRequest', () => {
	it('builds a PKCE request against the registered client and redirect', () => {
		const randomBytes = (size: number) => Buffer.alloc(size, size === 32 ? 0xab : 0x01);

		const request = createAuthorizationRequest('https://w/oidc/v1/authorize', OAUTH_REDIRECT_URI, randomBytes);
		const url = new URL(request.url);

		expect({ origin: url.origin + url.pathname, params: Object.fromEntries(url.searchParams), state: request.state, verifier: request.verifier }).toEqual({
			origin: 'https://w/oidc/v1/authorize',
			params: {
				response_type: 'code',
				client_id: 'databricks-sql-connector',
				redirect_uri: 'http://localhost:8030',
				scope: 'sql offline_access',
				state: 'AQEBAQEBAQEBAQEBAQEBAQ',
				code_challenge: 'DpR3z0YFvjwi8HL7szpZiHe1HsCgl9lkvwZpTeD8SX4',
				code_challenge_method: 'S256',
			},
			state: 'AQEBAQEBAQEBAQEBAQEBAQ',
			verifier: 'q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s',
		});
	});
});

describe('parseCallbackUrl', () => {
	const STATE = 'expected-state';

	it('accepts the redirect as the browser shows it, with or without a scheme', () => {
		expect([
			parseCallbackUrl('http://localhost:8030/?code=abc&state=expected-state', STATE),
			parseCallbackUrl('  localhost:8030/?state=expected-state&code=abc  ', STATE),
		]).toEqual([{ code: 'abc' }, { code: 'abc' }]);
	});

	it('distinguishes a non-callback, another attempt, a server error, and a missing code', () => {
		expect([
			parseCallbackUrl('not a url at all', STATE),
			parseCallbackUrl('http://localhost:8030/favicon.ico', STATE),
			parseCallbackUrl('http://localhost:8030/?code=abc&state=other', STATE),
			parseCallbackUrl('http://localhost:8030/?error=access_denied&error_description=User%20declined&state=expected-state', STATE),
			parseCallbackUrl('http://localhost:8030/?state=expected-state', STATE),
		]).toEqual([
			undefined,
			undefined,
			{ error: 'state_mismatch' },
			{ error: 'access_denied', description: 'User declined' },
			{ error: 'missing_code' },
		]);
	});
});

describe('token requests', () => {
	it('exchanges the code with the verifier and redirect the request used', async () => {
		const { request, calls } = fakeHttp({ status: 200, body: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } });

		const tokens = await exchangeAuthorizationCode(TOKEN_ENDPOINT, { code: 'c', verifier: 'v', redirectUri: OAUTH_REDIRECT_URI }, request, () => 1000);

		expect({ tokens, calls }).toEqual({
			tokens: { accessToken: 'at', refreshToken: 'rt', expiresAt: 3_601_000 },
			calls: [{
				url: TOKEN_ENDPOINT,
				method: 'POST',
				body: 'client_id=databricks-sql-connector&grant_type=authorization_code&code=c&code_verifier=v&redirect_uri=http%3A%2F%2Flocalhost%3A8030',
			}],
		});
	});

	it('refreshes with the refresh token and tolerates a response without expiry or a new refresh token', async () => {
		const { request, calls } = fakeHttp({ status: 200, body: { access_token: 'at2' } });

		const tokens = await refreshAccessToken(TOKEN_ENDPOINT, 'rt', request);

		expect({ tokens, body: calls[0].body }).toEqual({
			tokens: { accessToken: 'at2', refreshToken: undefined, expiresAt: undefined },
			body: 'client_id=databricks-sql-connector&grant_type=refresh_token&refresh_token=rt',
		});
	});

	it('surfaces the server error description, or the status when there is none', async () => {
		await expect(refreshAccessToken(TOKEN_ENDPOINT, 'rt', fakeHttp({ status: 400, body: { error: 'invalid_grant', error_description: 'Refresh token expired' } }).request))
			.rejects.toThrow('Databricks token request failed: Refresh token expired');
		await expect(refreshAccessToken(TOKEN_ENDPOINT, 'rt', fakeHttp({ status: 502, body: 'Bad Gateway' }).request))
			.rejects.toThrow('Databricks token request failed: HTTP 502');
	});
});

describe('DatabricksOAuthSession', () => {
	it('returns the access token until it nears expiry, then refreshes once for concurrent callers', async () => {
		const { request, calls } = fakeHttp({ status: 200, body: { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 } });
		let now = 0;
		const session = new DatabricksOAuthSession(TOKEN_ENDPOINT, { accessToken: 'at1', refreshToken: 'rt1', expiresAt: 3_600_000 }, request, () => now);

		const fresh = await session.getAccessToken();
		now = 3_600_000 - 9 * 60 * 1000;
		const refreshed = await Promise.all([session.getAccessToken(), session.getAccessToken()]);
		const afterwards = await session.getAccessToken();

		expect({ fresh, refreshed, afterwards, refreshes: calls.length }).toEqual({
			fresh: 'at1',
			refreshed: ['at2', 'at2'],
			afterwards: 'at2',
			refreshes: 1,
		});
	});

	it('keeps the old refresh token when the server does not rotate it', async () => {
		const { request, calls } = fakeHttp(
			{ status: 200, body: { access_token: 'at2', expires_in: 1 } },
			{ status: 200, body: { access_token: 'at3', expires_in: 3600 } },
		);
		const session = new DatabricksOAuthSession(TOKEN_ENDPOINT, { accessToken: 'at1', refreshToken: 'rt1', expiresAt: 0 }, request, () => 0);

		await session.getAccessToken();
		await session.getAccessToken();

		expect(calls.map(c => c.body)).toEqual([
			'client_id=databricks-sql-connector&grant_type=refresh_token&refresh_token=rt1',
			'client_id=databricks-sql-connector&grant_type=refresh_token&refresh_token=rt1',
		]);
	});

	it('fails an expired session that has no refresh token', async () => {
		const session = new DatabricksOAuthSession(TOKEN_ENDPOINT, { accessToken: 'at1', expiresAt: 0 }, fakeHttp().request, () => 0);

		await expect(session.getAccessToken()).rejects.toThrow(/no refresh token/);
	});
});

describe('listenForCallback', () => {
	// Port 0 lets the OS pick a free port; the production port is fixed by Databricks' registration.
	async function listenOnFreePort(state: string) {
		const listener = await listenForCallback(0, state, '<p>done</p>');
		return listener;
	}

	function get(url: string): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			http.get(url, response => {
				let body = '';
				response.on('data', chunk => { body += chunk; });
				response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
			}).on('error', reject);
		});
	}

	it('ignores requests that are not its callback and settles on the one that is', async () => {
		const listener = await listenOnFreePort('s1');
		try {
			// The listener does not expose its port, so find it through a probe request's server.
			const server = await probeServer(listener);
			const probe = await get(`${server}/favicon.ico`);
			const other = await get(`${server}/?code=x&state=other`);
			const callback = await get(`${server}/?code=abc&state=s1`);

			expect({ probe: probe.status, other: other.status, callback, result: await listener.result }).toEqual({
				probe: 404,
				other: 404,
				callback: { status: 200, body: '<p>done</p>' },
				result: { code: 'abc' },
			});
		} finally {
			listener.close();
		}
	});

	// Reaches the listener's bound port through Node's handle table, since the public interface
	// deliberately hides the server.
	async function probeServer(listener: { close(): void }): Promise<string> {
		const handles = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
		const server = handles.find((h): h is http.Server => h instanceof http.Server && h.listening);
		if (!server) {
			listener.close();
			throw new Error('no listening server found');
		}
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('unexpected server address');
		}
		return `http://localhost:${address.port}`;
	}
});
