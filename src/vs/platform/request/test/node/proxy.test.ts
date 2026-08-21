/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start PWB: honor http.noProxy and NO_PROXY in node requests ---
// Tests for the proxy bypass behavior added to getProxyAgent. The whole file
// is a PWB addition.

import assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { Agent, getProxyAgent } from '../../node/proxy.js';
import { IRawRequestFunction, nodeRequest } from '../../node/requestService.js';

suite('Proxy - noProxy bypass', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const proxyEnv = {
		HTTP_PROXY: 'http://proxy.corp.example:3128',
		HTTPS_PROXY: 'http://proxy.corp.example:3128'
	};

	test('proxies when no bypass list matches', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv });
		assert.ok(agent, 'expected a proxy agent when no bypass is configured');
	});

	test('bypasses via env NO_PROXY (uppercase)', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal' });
		assert.strictEqual(agent, null);
	});

	test('bypasses via env no_proxy (lowercase)', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, no_proxy: 'gallery.internal' });
		assert.strictEqual(agent, null);
	});

	test('bypasses via http.noProxy config', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv }, { noProxy: ['gallery.internal'] });
		assert.strictEqual(agent, null);
	});

	test('bypass list entries are case-insensitive', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv }, { noProxy: ['GALLERY.INTERNAL'] });
		assert.strictEqual(agent, null);
	});

	test('host:port entry matches only that port', async () => {
		const bypassed = await getProxyAgent('https://gallery.internal:8443/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal:8443' });
		assert.strictEqual(bypassed, null);

		const proxied = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal:8443' });
		assert.ok(proxied, 'expected a proxy agent when the port does not match');
	});

	test('host:port entry matches the implied default port', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal:443' });
		assert.strictEqual(agent, null);
	});

	test('leading-dot entry matches the domain and its subdomains', async () => {
		const subdomain = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: '.internal' });
		assert.strictEqual(subdomain, null);

		const exact = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: '.gallery.internal' });
		assert.strictEqual(exact, null);
	});

	test('entry without leading dot also matches subdomains', async () => {
		const agent = await getProxyAgent('https://sub.gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal' });
		assert.strictEqual(agent, null);
	});

	test('does not bypass a non-matching host', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'other.host,another.host:8080' });
		assert.ok(agent, 'expected a proxy agent for a host not in the bypass list');
	});

	test('does not treat a suffix without a label boundary as a match', async () => {
		const agent = await getProxyAgent('https://evilgallery.internal.example/manifest', { ...proxyEnv, NO_PROXY: 'internal' });
		assert.ok(agent, 'expected a proxy agent when the entry only matches a partial label');
	});

	test('bypass wins over http.proxy setting', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { NO_PROXY: 'gallery.internal' }, { proxyUrl: 'http://proxy.corp.example:3128' });
		assert.strictEqual(agent, null);
	});

	test('config entries take precedence: env NO_PROXY is ignored when http.noProxy is set', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal' }, { noProxy: ['other.host'] });
		assert.ok(agent, 'expected a proxy agent: config list replaces the env list');
	});

	test('a non-array http.noProxy value is ignored instead of crashing', async () => {
		const proxied = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv }, { noProxy: 'gallery.internal' as unknown as string[] });
		assert.ok(proxied, 'expected a proxy agent: a mistyped config value must not bypass');

		const bypassed = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal' }, { noProxy: 'other.host' as unknown as string[] });
		assert.strictEqual(bypassed, null, 'expected fallback to env NO_PROXY when the config value is mistyped');
	});

	test('non-string entries in http.noProxy are ignored', async () => {
		const agent = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv }, { noProxy: [123, null, 'gallery.internal'] as unknown as string[] });
		assert.strictEqual(agent, null, 'expected the valid entry to still match');
	});

	test('a sole * entry bypasses every host', async () => {
		const fromEnv = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: '*' });
		assert.strictEqual(fromEnv, null);

		const fromConfig = await getProxyAgent('https://gallery.internal/manifest', { ...proxyEnv }, { noProxy: ['*'] });
		assert.strictEqual(fromConfig, null);
	});

	test('proxies http URLs with HTTP_PROXY and bypasses them with NO_PROXY', async () => {
		const proxied = await getProxyAgent('http://gallery.internal/manifest', { ...proxyEnv });
		assert.ok(proxied, 'expected a proxy agent for http with HTTP_PROXY set');

		const bypassed = await getProxyAgent('http://gallery.internal/manifest', { ...proxyEnv, NO_PROXY: 'gallery.internal' });
		assert.strictEqual(bypassed, null);
	});

	test('re-evaluates proxy and proxy-authorization on redirect targets', async () => {
		const seenRequests: Array<{ url: string; agent: Agent; proxyAuthorization: string | undefined }> = [];
		const proxiedAgent = {} as Agent;
		const resolvedProxyUrls: string[] = [];
		const mockRawRequest = (_opts: { protocol?: string; hostname?: string; path?: string; headers?: { 'Proxy-Authorization'?: string }; agent: Agent }, callback: Function) => {
			const url = `${_opts.protocol}//${_opts.hostname}${_opts.path}`;
			seenRequests.push({
				url,
				agent: _opts.agent,
				proxyAuthorization: _opts.headers?.['Proxy-Authorization']
			});
			const attempt = seenRequests.length;
			const mockReq: any = {
				on: (_event: string, _handler: Function) => { },
				end: () => {
					if (attempt === 1) {
						setTimeout(() => callback({
							statusCode: 302,
							headers: { location: 'https://cdn.example.com/file.tgz' },
							on: () => { },
							pipe: () => ({ on: () => { } }),
							resume: () => { }
						}), 0);
						return;
					}
					setTimeout(() => callback({
						statusCode: 200,
						headers: {},
						on: () => { },
						pipe: () => ({ on: () => { } })
					}), 0);
				},
				abort: () => { },
				setTimeout: () => { }
			};
			return mockReq;
		};

		await nodeRequest({
			url: 'https://marketplace.example.com/manifest',
			type: 'GET',
			agent: null,
			proxyAuthorization: 'Basic test-token',
			resolveProxyAgent: async url => {
				resolvedProxyUrls.push(url);
				return url.includes('cdn.example.com') ? proxiedAgent : null;
			},
			getRawRequest: () => mockRawRequest as IRawRequestFunction,
			callSite: 'proxy.test.redirectProxyReevaluation'
		}, CancellationToken.None);

		assert.deepStrictEqual(resolvedProxyUrls, ['https://cdn.example.com/file.tgz']);
		assert.deepStrictEqual(seenRequests.map(request => ({ url: request.url, proxyAuthorization: request.proxyAuthorization })), [
			{
				url: 'https://marketplace.example.com/manifest',
				proxyAuthorization: undefined
			},
			{
				url: 'https://cdn.example.com/file.tgz',
				proxyAuthorization: 'Basic test-token'
			}
		]);
		assert.strictEqual(seenRequests[0].agent, null);
		assert.strictEqual(seenRequests[1].agent, proxiedAgent);
	});
});
// --- End PWB ---
