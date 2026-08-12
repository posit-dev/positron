/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	clearPpmDiscoveryCache,
	discoverPpmApi,
	fetchPpmVulnerabilities,
	normalizeOsvVulnerabilities,
	OsvVulnerability,
	ppmSupportsVulnerabilities,
} from '../ppmVulnerabilities';

type FetchFn = typeof globalThis.fetch;
type FetchCall = { url: string; init?: RequestInit };

function makeJsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		text: () => Promise.resolve(text),
		json: () => Promise.resolve(JSON.parse(text)),
	} as Response;
}

function ndjson(...lines: unknown[]): string {
	return lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
}

/**
 * Fixtures shaped like real PPM responses: pycrypto 2.6.1 (PyPI) has a PYSEC
 * record with no severity and a GHSA twin carrying CVSS v3 + v4 for the same
 * CVE; commonmark 1.7 (CRAN) has RSEC records with no scores and no CVEs.
 */
const PYSEC_RECORD: OsvVulnerability = {
	id: 'PYSEC-2018-97',
	aliases: ['CVE-2018-6594', 'GHSA-6528-wvf6-f6qg'],
	published: '2018-02-03T15:29:00Z',
};

const GHSA_RECORD: OsvVulnerability = {
	id: 'GHSA-6528-wvf6-f6qg',
	summary: 'Pycrypto generates weak key parameters',
	aliases: ['CVE-2018-6594', 'PYSEC-2018-97'],
	published: '2018-07-12T20:29:26Z',
	severity: [
		{ type: 'CVSS_V3', score: 'CVSS:3.0/...', calculated_score: { base_score: 7.5 } },
		{ type: 'CVSS_V4', score: 'CVSS:4.0/...', calculated_score: { base_score: 8.7 } },
	],
};

const RSEC_RECORD: OsvVulnerability = {
	id: 'RSEC-2023-7',
	summary: 'Denial of Service (DoS) and Arbitrary Code Execution (ACE) vulnerabilities',
	published: '2023-10-06T05:00:00.6Z',
	ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0.2' }, { fixed: '1.8' }] }],
};

suite('normalizeOsvVulnerabilities', () => {
	test('merges aliased PYSEC/GHSA records into one CVE advisory with the best score', () => {
		const advisories = normalizeOsvVulnerabilities([PYSEC_RECORD, GHSA_RECORD]);

		assert.strictEqual(advisories.length, 1);
		const advisory = advisories[0];
		assert.strictEqual(advisory.id, 'CVE-2018-6594');
		assert.strictEqual(advisory.osvId, 'GHSA-6528-wvf6-f6qg');
		// v4 preferred over v3 when both are present.
		assert.strictEqual(advisory.score, 8.7);
		assert.strictEqual(advisory.scoreVersion, 'v4');
		assert.strictEqual(advisory.summary, 'Pycrypto generates weak key parameters');
		// Earliest publication across the group.
		assert.strictEqual(advisory.published, '2018-02-03T15:29:00Z');
		assert.strictEqual(advisory.url, 'https://nvd.nist.gov/vuln/detail/CVE-2018-6594');
	});

	test('keeps an unscored, CVE-less RSEC record as an unscored advisory with an osv.dev link', () => {
		const advisories = normalizeOsvVulnerabilities([RSEC_RECORD]);

		assert.strictEqual(advisories.length, 1);
		const advisory = advisories[0];
		assert.strictEqual(advisory.id, 'RSEC-2023-7');
		assert.strictEqual(advisory.score, undefined);
		assert.strictEqual(advisory.scoreVersion, undefined);
		assert.strictEqual(advisory.fixedIn, '1.8');
		assert.strictEqual(advisory.url, 'https://osv.dev/vulnerability/RSEC-2023-7');
	});

	test('sorts scored advisories before unscored ones, highest first', () => {
		const low: OsvVulnerability = {
			id: 'GHSA-low', aliases: ['CVE-2020-0001'],
			severity: [{ type: 'CVSS_V3', calculated_score: { base_score: 4.4 } }],
		};
		const advisories = normalizeOsvVulnerabilities([RSEC_RECORD, low, PYSEC_RECORD, GHSA_RECORD]);

		assert.deepStrictEqual(advisories.map((a) => a.id), ['CVE-2018-6594', 'CVE-2020-0001', 'RSEC-2023-7']);
	});

	test('merges two groups bridged by a later record', () => {
		// A and B share no aliases; C aliases both, arriving last.
		const a: OsvVulnerability = { id: 'PYSEC-1' };
		const b: OsvVulnerability = { id: 'GHSA-1' };
		const c: OsvVulnerability = { id: 'CVE-2021-0001', aliases: ['PYSEC-1', 'GHSA-1'] };

		const advisories = normalizeOsvVulnerabilities([a, b, c]);

		assert.strictEqual(advisories.length, 1);
		assert.strictEqual(advisories[0].id, 'CVE-2021-0001');
	});

	test('joins distinct fixed versions across release branches', () => {
		const multiBranch: OsvVulnerability = {
			id: 'GHSA-multi',
			ranges: [
				{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '1.26.5' }] },
				{ type: 'ECOSYSTEM', events: [{ introduced: '2.0.0' }, { fixed: '2.0.2' }] },
			],
		};
		const advisories = normalizeOsvVulnerabilities([multiBranch]);

		assert.strictEqual(advisories[0].fixedIn, '1.26.5, 2.0.2');
	});
});

suite('ppmSupportsVulnerabilities', () => {
	test('accepts versions at or after 2023.12 and rejects older or malformed ones', () => {
		assert.strictEqual(ppmSupportsVulnerabilities('2026.06.0'), true);
		assert.strictEqual(ppmSupportsVulnerabilities('2023.12.0'), true);
		assert.strictEqual(ppmSupportsVulnerabilities('2025.04.2-8'), true);
		assert.strictEqual(ppmSupportsVulnerabilities('2023.11.0'), false);
		assert.strictEqual(ppmSupportsVulnerabilities('2022.07.2-11'), false);
		assert.strictEqual(ppmSupportsVulnerabilities(undefined), false);
		assert.strictEqual(ppmSupportsVulnerabilities('nightly'), false);
	});
});

suite('discoverPpmApi', () => {
	let calls: FetchCall[];

	setup(() => {
		clearPpmDiscoveryCache();
		calls = [];
	});

	function fakeFetch(routes: Record<string, Response>): FetchFn {
		return ((url: string, init?: RequestInit) => {
			calls.push({ url, init });
			const response = routes[url];
			return response
				? Promise.resolve(response)
				: Promise.resolve(makeJsonResponse('not found', { ok: false, status: 404 }));
		}) as FetchFn;
	}

	test('walks the repo URL path down to the API base and extracts the repo name', async () => {
		const fetchImpl = fakeFetch({
			'https://ppm.example.com/__api__/status': makeJsonResponse({ version: '2026.06.0' }),
		});

		const ppm = await discoverPpmApi('https://ppm.example.com/cran/latest', fetchImpl);

		assert.deepStrictEqual(ppm, { apiBase: 'https://ppm.example.com', repoName: 'cran' });
		// Longest prefix probed first: /cran/latest's parent, then the origin.
		assert.deepStrictEqual(calls.map((c) => c.url), [
			'https://ppm.example.com/cran/__api__/status',
			'https://ppm.example.com/__api__/status',
		]);
	});

	test('finds a PPM hosted behind a path prefix', async () => {
		const fetchImpl = fakeFetch({
			'https://host.example.com/rspm/__api__/status': makeJsonResponse({ version: '2024.04.0' }),
		});

		const ppm = await discoverPpmApi('https://host.example.com/rspm/cran/latest', fetchImpl);

		assert.deepStrictEqual(ppm, { apiBase: 'https://host.example.com/rspm', repoName: 'cran' });
	});

	test('rejects a PPM older than 2023.12 (no vulnerability data)', async () => {
		const fetchImpl = fakeFetch({
			'https://old.example.com/__api__/status': makeJsonResponse({ version: '2022.07.2-11' }),
		});

		const ppm = await discoverPpmApi('https://old.example.com/cran/latest', fetchImpl);

		assert.strictEqual(ppm, undefined);
	});

	test('returns undefined for a non-PPM repository', async () => {
		const fetchImpl = fakeFetch({});

		const ppm = await discoverPpmApi('https://cran.rstudio.com/', fetchImpl);

		assert.strictEqual(ppm, undefined);
	});

	test('caches discovery per URL', async () => {
		const fetchImpl = fakeFetch({
			'https://ppm.example.com/__api__/status': makeJsonResponse({ version: '2026.06.0' }),
		});

		await discoverPpmApi('https://ppm.example.com/cran/latest', fetchImpl);
		const probes = calls.length;
		await discoverPpmApi('https://ppm.example.com/cran/latest', fetchImpl);

		assert.strictEqual(calls.length, probes);
	});
});

suite('fetchPpmVulnerabilities', () => {
	const PPM = { apiBase: 'https://ppm.example.com', repoName: 'cran' };

	let calls: FetchCall[];

	setup(() => {
		calls = [];
	});

	function fetchReturning(body: string): FetchFn {
		return ((url: string, init?: RequestInit) => {
			calls.push({ url, init });
			return Promise.resolve(makeJsonResponse(body));
		}) as FetchFn;
	}

	test('sends version-pinned names to the configured repo and skips unversioned specs', async () => {
		const fetchImpl = fetchReturning(ndjson());

		await fetchPpmVulnerabilities(PPM, [
			{ name: 'commonmark', version: '1.7' },
			{ name: 'devbuild' },
		], undefined, fetchImpl);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].url, 'https://ppm.example.com/__api__/filter/packages');
		const body = JSON.parse(calls[0].init?.body as string);
		assert.deepStrictEqual(body.names, ['commonmark==1.7']);
		assert.strictEqual(body.repo, 'cran');
	});

	test('distinguishes vulnerable, clean, and unknown packages', async () => {
		const fetchImpl = fetchReturning(ndjson(
			{ name: 'commonmark', version: '1.7', vulns: [RSEC_RECORD] },
			{ name: 'dplyr', version: '1.1.4' },
		));

		const result = await fetchPpmVulnerabilities(PPM, [
			{ name: 'commonmark', version: '1.7' },
			{ name: 'dplyr', version: '1.1.4' },
			{ name: 'ghpkg', version: '0.0.9000' },
		], undefined, fetchImpl);

		// Vulnerable: advisories present. Clean: present in the repo, empty
		// array. Unknown (not in the repo at that version): absent entirely.
		assert.strictEqual(result.get('commonmark')?.length, 1);
		assert.deepStrictEqual(result.get('dplyr'), []);
		assert.strictEqual(result.has('ghpkg'), false);
	});

	test('deduplicates the per-binary-build duplicate rows omit_package_details causes', async () => {
		const fetchImpl = fetchReturning(ndjson(
			{ name: 'mgcv', version: '1.9-1', vulns: [RSEC_RECORD] },
			{ name: 'mgcv', version: '1.9-1', vulns: [RSEC_RECORD] },
			{ name: 'mgcv', version: '1.9-1', vulns: [RSEC_RECORD] },
		));

		const result = await fetchPpmVulnerabilities(PPM, [{ name: 'mgcv', version: '1.9-1' }], undefined, fetchImpl);

		assert.strictEqual(result.size, 1);
		assert.strictEqual(result.get('mgcv')?.length, 1);
	});

	test('makes no request when no spec has a version', async () => {
		const fetchImpl = ((): Promise<Response> => {
			throw new Error('should not be called');
		}) as unknown as FetchFn;

		const result = await fetchPpmVulnerabilities(PPM, [{ name: 'devbuild' }], undefined, fetchImpl);

		assert.strictEqual(result.size, 0);
	});

	test('chunks large package lists into multiple requests', async () => {
		const fetchImpl = fetchReturning(ndjson());
		const packages = Array.from({ length: 150 }, (_, i) => ({ name: `pkg${i}`, version: '1.0.0' }));

		await fetchPpmVulnerabilities(PPM, packages, undefined, fetchImpl);

		assert.strictEqual(calls.length, 2);
		const first = JSON.parse(calls[0].init?.body as string);
		const second = JSON.parse(calls[1].init?.body as string);
		assert.strictEqual(first.names.length, 100);
		assert.strictEqual(second.names.length, 50);
	});

	test('propagates a non-OK response as an error', async () => {
		const fetchImpl = (() => Promise.resolve(makeJsonResponse('down', { ok: false, status: 503 }))) as FetchFn;

		await assert.rejects(
			fetchPpmVulnerabilities(PPM, [{ name: 'dplyr', version: '1.1.4' }], undefined, fetchImpl),
			/503/,
		);
	});
});
