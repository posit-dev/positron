/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { IDocsBundleRequest, parseManifest, parseDigestFile, resolveBundleRequest } from '../../common/positronDocsBundle.js';

const BASE = 'https://cdn.posit.co/positron/releases/docs';

/** Same shape as the helper in positronDocsCache.vitest.ts, deliberately. */
function request(overrides: Partial<IDocsBundleRequest> = {}): IDocsBundleRequest {
	return {
		quality: 'releases',
		positronVersion: '2026.05.0',
		positronBuildNumber: 179,
		profile: 'positron',
		baseUrl: BASE,
		...overrides,
	};
}

describe('resolveBundleRequest', () => {
	// The three quality values are verified against build/utils.ts, not assumed.
	// A future channel rename must fail here rather than silently change behaviour.
	it.each<[string | undefined, boolean]>([
		['releases', true],
		['dailies', false],
		[undefined, false],
	])('quality %s => wantsExact %s', (quality, wantsExact) => {
		expect(resolveBundleRequest(request({ quality })).wantsExact).toBe(wantsExact);
	});

	it('builds exact and latest URLs plus checksum files for the positron profile', () => {
		const { exact, latest } = resolveBundleRequest(request());
		expect({ exact, latest }).toMatchInlineSnapshot(`
			{
			  "exact": {
			    "form": "exact",
			    "sha256Url": "https://cdn.posit.co/positron/releases/docs/positron-llms-2026.05.0-179.zip.sha256sum",
			    "version": "2026.05.0-179",
			    "zipUrl": "https://cdn.posit.co/positron/releases/docs/positron-llms-2026.05.0-179.zip",
			  },
			  "latest": {
			    "form": "latest",
			    "sha256Url": "https://cdn.posit.co/positron/releases/docs/positron-llms-latest.zip.sha256sum",
			    "version": "latest",
			    "zipUrl": "https://cdn.posit.co/positron/releases/docs/positron-llms-latest.zip",
			  },
			}
		`);
	});

	it('uses the workbench basename for the workbench profile', () => {
		expect(resolveBundleRequest(request({ profile: 'workbench' })).exact.zipUrl)
			.toBe(`${BASE}/positron-workbench-llms-2026.05.0-179.zip`);
	});

	it('omits the -0 suffix for dev builds', () => {
		expect(resolveBundleRequest(request({ positronBuildNumber: 0 })).exact.version).toBe('2026.05.0');
	});

	it('tolerates a trailing slash on the base URL', () => {
		expect(resolveBundleRequest(request({ baseUrl: `${BASE}/` })).latest.zipUrl)
			.toBe(`${BASE}/positron-llms-latest.zip`);
	});
});

describe('parseManifest', () => {
	const valid = JSON.stringify({
		schema: 1, profile: 'positron', version: '2026.05.0-179',
		generated: '2026-07-24T18:02:11Z', docsBaseUrl: 'https://positron.posit.co/', fileCount: 90,
	});

	it('accepts a well-formed schema 1 manifest', () => {
		expect(parseManifest(valid)).toMatchInlineSnapshot(`
			{
			  "docsBaseUrl": "https://positron.posit.co/",
			  "fileCount": 90,
			  "generated": "2026-07-24T18:02:11Z",
			  "profile": "positron",
			  "schema": 1,
			  "version": "2026.05.0-179",
			}
		`);
	});

	it.each([
		['schema 2', JSON.stringify({ ...JSON.parse(valid), schema: 2 })],
		['malformed JSON', '{ not json'],
		['missing version', JSON.stringify({ schema: 1, profile: 'positron', fileCount: 90, docsBaseUrl: 'x', generated: 'y' })],
		['non-numeric fileCount', JSON.stringify({ ...JSON.parse(valid), fileCount: 'ninety' })],
		// The version becomes a directory name under the cache root, so anything
		// that could steer a rename out of it has to be rejected at parse time.
		['a version that escapes the cache root', JSON.stringify({ ...JSON.parse(valid), version: '../../evil' })],
		['a version that is a parent reference', JSON.stringify({ ...JSON.parse(valid), version: '..' })],
		['an absolute version', JSON.stringify({ ...JSON.parse(valid), version: '/etc/passwd' })],
		['a version with a Windows separator', JSON.stringify({ ...JSON.parse(valid), version: '..\\evil' })],
	])('rejects %s', (_label, raw) => {
		expect(parseManifest(raw)).toBeUndefined();
	});
});

describe('parseDigestFile', () => {
	const digest = 'a'.repeat(64);

	it.each([
		['shasum format', `${digest}  positron-llms-latest.zip\n`],
		['bare hex', `${digest}\n`],
		['uppercase hex', `${digest.toUpperCase()}  x.zip`],
	])('accepts %s', (_label, raw) => {
		expect(parseDigestFile(raw)).toBe(digest);
	});

	it.each([
		['empty', ''],
		['too short', 'abc123  x.zip'],
		['non-hex', `${'z'.repeat(64)}  x.zip`],
		['an HTML error page', '<!DOCTYPE html><html><body>404</body></html>'],
	])('rejects %s', (_label, raw) => {
		expect(parseDigestFile(raw)).toBeUndefined();
	});
});
