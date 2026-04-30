/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { fetchP3MPackageMetadata } from '../p3mSearch';

type FetchFn = typeof globalThis.fetch;
type FetchCall = { url: string; init: RequestInit };

function makeResponse(body: string, init: { ok?: boolean; status?: number } = {}): Response {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		text: () => Promise.resolve(body),
	} as Response;
}

function ndjson(...lines: unknown[]): string {
	return lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
}

suite('fetchP3MPackageMetadata', () => {
	let originalFetch: FetchFn;
	let calls: FetchCall[];

	function installFetch(impl: (url: string, init: RequestInit) => Promise<Response>): void {
		globalThis.fetch = ((url: string, init: RequestInit) => {
			calls.push({ url, init });
			return impl(url, init);
		}) as FetchFn;
	}

	setup(() => {
		originalFetch = globalThis.fetch;
		calls = [];
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
	});

	test('returns an empty map and skips the API call when no names are provided', async () => {
		installFetch(() => Promise.reject(new Error('should not be called')));

		const result = await fetchP3MPackageMetadata([]);

		assert.strictEqual(result.size, 0);
		assert.strictEqual(calls.length, 0);
	});

	test('parses NDJSON and maps P3M fields onto LanguageRuntimePackage', async () => {
		const body = ndjson(
			{
				name: 'ggplot2',
				version: '3.5.1',
				summary: 'Create Elegant Data Visualisations',
				license: 'MIT',
				package_date: '2024-04-23',
				package_size: 123,
				downloads: 42,
			},
			{
				name: 'dplyr',
				version: '1.1.4',
				summary: null,
				license: null,
				licenses: ['MIT', 'GPL-2'],
				package_date: null,
				package_size: null,
				downloads: null,
			},
		);
		installFetch(() => Promise.resolve(makeResponse(body)));

		const result = await fetchP3MPackageMetadata(['ggplot2', 'dplyr']);

		assert.strictEqual(result.size, 2);
		assert.deepStrictEqual(result.get('ggplot2'), {
			license: 'MIT',
			latestVersion: '3.5.1',
			publishedDate: '2024-04-23',
		});
		// Falls back to licenses.join(', ') when license is null
		assert.deepStrictEqual(result.get('dplyr'), {
			license: 'MIT, GPL-2',
			latestVersion: '1.1.4',
			publishedDate: undefined,
		});
	});

	test('lowercases package names in the result map', async () => {
		const body = ndjson({
			name: 'Matrix',
			version: '1.7-0',
			summary: null,
			license: 'GPL',
			package_date: null,
			package_size: null,
			downloads: null,
		});
		installFetch(() => Promise.resolve(makeResponse(body)));

		const result = await fetchP3MPackageMetadata(['Matrix']);

		assert.strictEqual(result.size, 1);
		assert.ok(result.has('matrix'));
	});

	test('POSTs to the P3M filter endpoint with repo "cran"', async () => {
		installFetch(() => Promise.resolve(makeResponse('')));

		await fetchP3MPackageMetadata(['ggplot2']);

		assert.strictEqual(calls.length, 1);
		const { url, init } = calls[0];
		assert.strictEqual(url, 'https://p3m.dev/__api__/filter/packages');
		assert.strictEqual(init.method, 'POST');
		const body = JSON.parse(init.body as string);
		assert.deepStrictEqual(body.names, ['ggplot2']);
		assert.strictEqual(body.repo, 'cran');
	});

	test('skips malformed NDJSON lines but keeps the valid ones', async () => {
		const body = ndjson(
			'not-json',
			{
				name: 'ggplot2',
				version: '3.5.1',
				summary: null,
				license: 'MIT',
				package_date: null,
				package_size: null,
				downloads: null,
			},
			'{ broken',
		);
		installFetch(() => Promise.resolve(makeResponse(body)));

		const result = await fetchP3MPackageMetadata(['ggplot2']);

		assert.strictEqual(result.size, 1);
		assert.strictEqual(result.get('ggplot2')?.latestVersion, '3.5.1');
	});

	test('skips entries without a name', async () => {
		const body = ndjson(
			{ version: '1.0.0', summary: null, license: null, package_date: null, package_size: null, downloads: null },
			{
				name: 'ggplot2',
				version: '3.5.1',
				summary: null,
				license: 'MIT',
				package_date: null,
				package_size: null,
				downloads: null,
			},
		);
		installFetch(() => Promise.resolve(makeResponse(body)));

		const result = await fetchP3MPackageMetadata(['ggplot2']);

		assert.strictEqual(result.size, 1);
		assert.ok(result.has('ggplot2'));
	});

	test('swallows non-OK HTTP responses and returns an empty map', async () => {
		installFetch(() => Promise.resolve(makeResponse('', { ok: false, status: 503 })));

		const result = await fetchP3MPackageMetadata(['ggplot2']);

		assert.strictEqual(result.size, 0);
	});

	test('swallows fetch rejections and returns an empty map', async () => {
		installFetch(() => Promise.reject(new Error('network down')));

		const result = await fetchP3MPackageMetadata(['ggplot2']);

		assert.strictEqual(result.size, 0);
	});

	test('throws CancellationError when the token is cancelled mid-flight', async () => {
		const cts = new vscode.CancellationTokenSource();
		installFetch((_url, init) => {
			return new Promise((_, reject) => {
				(init.signal as AbortSignal).addEventListener('abort', () => {
					const err = new Error('aborted');
					err.name = 'AbortError';
					reject(err);
				});
			});
		});

		const pending = fetchP3MPackageMetadata(['ggplot2'], cts.token);
		cts.cancel();

		await assert.rejects(pending, (e: unknown) => e instanceof vscode.CancellationError);
	});

	test('disposes the cancellation subscription after a successful fetch', async () => {
		const cts = new vscode.CancellationTokenSource();
		let capturedSignal: AbortSignal | undefined;
		installFetch((_url, init) => {
			capturedSignal = init.signal as AbortSignal;
			return Promise.resolve(makeResponse(''));
		});

		await fetchP3MPackageMetadata(['ggplot2'], cts.token);

		// Cancelling after the fetch has resolved should NOT abort the signal --
		// if the subscription wasn't disposed, the listener would still fire abort().
		assert.strictEqual(capturedSignal?.aborted, false);
		cts.cancel();
		assert.strictEqual(capturedSignal?.aborted, false);
	});
});
