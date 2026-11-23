/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AzureTokenError,
	AzureTokenTransport,
	DelegatedAzureTokenClient,
	isDelegatedAzureTokenAvailable,
	isSupportedWorkbenchVersion,
	parseDelegatedTokenResponse,
	parseRpcCookieExpiry,
} from './azure';

const RESOURCE = 'https://ossrdbms-aad.database.windows.net';
const NOW = Date.parse('2026-11-23T12:00:00Z');
const COOKIE_EXPIRY = 'Mon, 23 Nov 2026 13:00:00 GMT';

/** A transport that answers each request with the next queued response and records the requests. */
function fakeTransport(...responses: Array<{ status: number; body: unknown } | Error>) {
	const requests: Array<{ url: string; headers: Record<string, string>; body: string; method: string }> = [];
	const transport: AzureTokenTransport = async (url, init) => {
		requests.push({ url, headers: init.headers, body: init.body, method: init.method });
		const next = responses.shift();
		if (!next) {
			throw new Error('unexpected request');
		}
		if (next instanceof Error) {
			throw next;
		}
		return { status: next.status, text: async () => typeof next.body === 'string' ? next.body : JSON.stringify(next.body) };
	};
	return { transport, requests };
}

function tokenBody(accessToken: string, expiresIn = 3600) {
	return { status: 200, body: { token: { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn } } };
}

function createClient(options: {
	transport: AzureTokenTransport;
	env?: NodeJS.ProcessEnv;
	files?: Record<string, string>;
	now?: () => number;
}) {
	return new DelegatedAzureTokenClient({
		refreshBufferMs: 60_000,
		env: options.env ?? {
			RS_SERVER_ADDRESS: 'http://127.0.0.1:8787/',
			PWB_SESSION_RUNTIME_DIR: '/run/session',
			RS_SESSION_RPC_COOKIE: `env|${COOKIE_EXPIRY}|stale`,
		},
		readFile: async filePath => options.files?.[filePath],
		now: options.now ?? (() => NOW),
		transport: options.transport,
	});
}

describe('isDelegatedAzureTokenAvailable', () => {
	it('needs the server address and a cookie source', () => {
		expect([
			isDelegatedAzureTokenAvailable({ RS_SERVER_ADDRESS: 'http://x', PWB_SESSION_RUNTIME_DIR: '/run' }),
			isDelegatedAzureTokenAvailable({ RS_SERVER_ADDRESS: 'http://x', RS_SESSION_RPC_COOKIE: 'c' }),
			isDelegatedAzureTokenAvailable({ RS_SERVER_ADDRESS: 'http://x' }),
			isDelegatedAzureTokenAvailable({ PWB_SESSION_RUNTIME_DIR: '/run' }),
		]).toEqual([true, true, false, false]);
	});
});

describe('isSupportedWorkbenchVersion', () => {
	it.each([
		['2024.12.0+467.pro1', true],
		['2024.12.1-daily+5', true],
		['2025.01.0', true],
		['2024.09.1+394.pro7', false],
		['2023.12.0', false],
		['2024.12.0-dev+123', true],
		[undefined, true],
	])('%s -> %s', (version, expected) => {
		expect(isSupportedWorkbenchVersion(version)).toBe(expected);
	});
});

describe('parseRpcCookieExpiry', () => {
	it('reads the HTTP date in the second field', () => {
		expect(parseRpcCookieExpiry(`user|${COOKIE_EXPIRY}|signature`)).toBe(Date.parse(COOKIE_EXPIRY));
		expect(parseRpcCookieExpiry('no-expiry')).toBeUndefined();
	});
});

describe('parseDelegatedTokenResponse', () => {
	function codeOf(status: number, body: unknown): string {
		try {
			parseDelegatedTokenResponse(status, typeof body === 'string' ? body : JSON.stringify(body), NOW);
			return 'ok';
		} catch (error) {
			return error instanceof AzureTokenError ? error.code : 'not an AzureTokenError';
		}
	}

	it('returns the token and its expiry', () => {
		expect(parseDelegatedTokenResponse(200, JSON.stringify(tokenBody('abc', 120).body), NOW))
			.toEqual({ accessToken: 'abc', expiresAt: NOW + 120_000 });
	});

	it('classifies each failure shape', () => {
		expect({
			consent: codeOf(200, { oauth2_error: { error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented' } }),
			expired: codeOf(200, { oauth2_error: { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired' } }),
			noRefreshToken: codeOf(200, { error: 'No refresh token available for user' }),
			errorObject: codeOf(200, { error: { message: 'Something', description: 'broke' } }),
			resultFalse: codeOf(200, { result: false, detail: 'denied' }),
			forbidden: codeOf(403, 'Forbidden'),
			serverError: codeOf(500, 'oops'),
			missingToken: codeOf(200, { token: {} }),
		}).toEqual({
			consent: 'consent-required',
			expired: 'reauthenticate',
			noRefreshToken: 'entra-not-configured',
			errorObject: 'unknown',
			resultFalse: 'unknown',
			forbidden: 'consent-required',
			serverError: 'unknown',
			missingToken: 'unknown',
		});
	});
});

describe('DelegatedAzureTokenClient', () => {
	it('posts the RPC request with the cookie from the runtime directory', async () => {
		const { transport, requests } = fakeTransport(tokenBody('abc'));
		const client = createClient({ transport, files: { '/run/session/rpc_cookie': `file|${COOKIE_EXPIRY}|fresh\n` } });

		await client.getToken(RESOURCE);

		expect(requests).toEqual([{
			url: 'http://127.0.0.1:8787/delegated_azure_token',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-RS-Session-Server-RPC-Cookie': `file|${COOKIE_EXPIRY}|fresh`,
			},
			body: JSON.stringify({ method: 'delegated_azure_token', params: [RESOURCE] }),
		}]);
	});

	it('falls back to the cookie in the environment', async () => {
		const { transport, requests } = fakeTransport(tokenBody('abc'));
		await createClient({ transport }).getToken(RESOURCE);
		expect(requests[0].headers['X-RS-Session-Server-RPC-Cookie']).toBe(`env|${COOKIE_EXPIRY}|stale`);
	});

	it('caches a token until the refresh buffer, then exchanges again', async () => {
		let now = NOW;
		const { transport, requests } = fakeTransport(tokenBody('first', 3600), tokenBody('second', 3600));
		const client = createClient({ transport, now: () => now });

		const first = await client.getToken(RESOURCE);
		now += 3600_000 - 120_000;
		const cached = await client.getToken(RESOURCE);
		now += 90_000;
		const refreshed = await client.getToken(RESOURCE);

		expect([first.accessToken, cached.accessToken, refreshed.accessToken, requests.length]).toEqual(['first', 'first', 'second', 2]);
	});

	it('shares one exchange between concurrent callers and does not cache failures', async () => {
		const { transport, requests } = fakeTransport({ status: 500, body: 'down' }, tokenBody('abc'));
		const client = createClient({ transport });

		const results = await Promise.allSettled([client.getToken(RESOURCE), client.getToken(RESOURCE)]);
		const retry = await client.getToken(RESOURCE);

		expect([results.map(result => result.status), retry.accessToken, requests.length]).toEqual([['rejected', 'rejected'], 'abc', 2]);
	});

	it('reads the cookie again and retries once when Workbench rejects it', async () => {
		const files: Record<string, string> = { '/run/session/rpc_cookie': `old|${COOKIE_EXPIRY}|x` };
		const { transport, requests } = fakeTransport({ status: 401, body: 'Unauthorized' }, tokenBody('abc'));
		// Workbench rotates the cookie file while the first request is in flight.
		const rotating: AzureTokenTransport = async (url, init) => {
			const response = await transport(url, init);
			files['/run/session/rpc_cookie'] = `new|${COOKIE_EXPIRY}|y`;
			return response;
		};

		await createClient({ transport: rotating, files }).getToken(RESOURCE);

		expect(requests.map(request => request.headers['X-RS-Session-Server-RPC-Cookie'])).toEqual([`old|${COOKIE_EXPIRY}|x`, `new|${COOKIE_EXPIRY}|y`]);
	});

	it('reports each environment problem with its own code', async () => {
		async function codeOf(client: DelegatedAzureTokenClient): Promise<string> {
			return client.getToken(RESOURCE).then(() => 'ok', (error: AzureTokenError) => error.code);
		}
		const { transport } = fakeTransport();
		expect({
			noServer: await codeOf(createClient({ transport, env: {} })),
			tooOld: await codeOf(createClient({ transport, env: { RS_SERVER_ADDRESS: 'http://x', RSTUDIO_VERSION: '2024.09.0+1.pro1', RS_SESSION_RPC_COOKIE: 'c' } })),
			noCookie: await codeOf(createClient({ transport, env: { RS_SERVER_ADDRESS: 'http://x', PWB_SESSION_RUNTIME_DIR: '/gone' } })),
			unreachable: await codeOf(createClient({ transport: fakeTransport(new TypeError('fetch failed')).transport })),
		}).toEqual({
			noServer: 'unavailable',
			tooOld: 'workbench-too-old',
			noCookie: 'no-rpc-cookie',
			unreachable: 'unreachable',
		});
	});
});
