/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { when } from 'ts-mockito';
import * as vscode from 'vscode';
import {
	clearPpmDiscoveryCache,
	discoverPpmApi,
	fetchPpmVulnerabilities,
	getPpmVulnerabilities,
	normalizeOsvVulnerabilities,
	OsvVulnerability,
	ppmSupportsVulnerabilities,
	resolvePythonIndexUrl,
} from '../../client/positron/packages/ppmVulnerabilities';
import { mockedVSCodeNamespaces } from '../vscode-mock';

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
 * Unset the index-URL environment variables around each test in the calling
 * suite, so a developer's own PIP_INDEX_URL can't decide the outcome.
 */
function withCleanIndexEnv(): void {
	const ENV_KEYS = ['PIP_INDEX_URL', 'UV_DEFAULT_INDEX', 'UV_INDEX_URL'] as const;
	let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

	setup(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	});

	teardown(() => {
		for (const key of ENV_KEYS) {
			const value = savedEnv[key];
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});
}

/**
 * Fixtures shaped like real PPM responses for pycrypto 2.6.1: a PYSEC record
 * with no severity and a GHSA twin carrying CVSS v3 + v4 for the same CVE.
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

suite('ppmVulnerabilities - normalizeOsvVulnerabilities', () => {
	test('merges aliased PYSEC/GHSA records into one CVE advisory with the best score', () => {
		const advisories = normalizeOsvVulnerabilities([PYSEC_RECORD, GHSA_RECORD]);

		expect(advisories).to.have.lengthOf(1);
		const advisory = advisories[0];
		expect(advisory.id).to.equal('CVE-2018-6594');
		expect(advisory.osvId).to.equal('GHSA-6528-wvf6-f6qg');
		// v4 preferred over v3 when both are present.
		expect(advisory.score).to.equal(8.7);
		expect(advisory.scoreVersion).to.equal('v4');
		expect(advisory.summary).to.equal('Pycrypto generates weak key parameters');
		// Earliest publication across the group.
		expect(advisory.published).to.equal('2018-02-03T15:29:00Z');
		expect(advisory.url).to.equal('https://nvd.nist.gov/vuln/detail/CVE-2018-6594');
	});

	test('sorts scored advisories before unscored ones, highest first', () => {
		const unscored: OsvVulnerability = { id: 'PYSEC-2021-59' };
		const low: OsvVulnerability = {
			id: 'GHSA-low',
			aliases: ['CVE-2020-0001'],
			severity: [{ type: 'CVSS_V3', calculated_score: { base_score: 4.4 } }],
		};

		const advisories = normalizeOsvVulnerabilities([unscored, low, PYSEC_RECORD, GHSA_RECORD]);

		expect(advisories.map((a) => a.id)).to.deep.equal(['CVE-2018-6594', 'CVE-2020-0001', 'PYSEC-2021-59']);
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

		expect(advisories[0].fixedIn).to.equal('1.26.5, 2.0.2');
	});
});

suite('ppmVulnerabilities - ppmSupportsVulnerabilities', () => {
	test('accepts versions at or after 2023.12 and rejects older or malformed ones', () => {
		expect(ppmSupportsVulnerabilities('2026.06.0')).to.be.true;
		expect(ppmSupportsVulnerabilities('2023.12.0')).to.be.true;
		expect(ppmSupportsVulnerabilities('2023.11.0')).to.be.false;
		expect(ppmSupportsVulnerabilities(undefined)).to.be.false;
		expect(ppmSupportsVulnerabilities('nightly')).to.be.false;
	});
});

suite('ppmVulnerabilities - resolvePythonIndexUrl', () => {
	withCleanIndexEnv();

	test('prefers the environment over pip config', async () => {
		process.env.PIP_INDEX_URL = 'https://ppm.example.com/pypi/latest/simple';

		const url = await resolvePythonIndexUrl(() => Promise.resolve('https://other.example.com/simple'));

		expect(url).to.equal('https://ppm.example.com/pypi/latest/simple');
	});

	test('falls back to pip config when no environment variable is set', async () => {
		const url = await resolvePythonIndexUrl(() => Promise.resolve('https://ppm.example.com/pypi/latest/simple'));

		expect(url).to.equal('https://ppm.example.com/pypi/latest/simple');
	});

	test('treats a failing pip config lookup as no configured index', async () => {
		const url = await resolvePythonIndexUrl(() => Promise.reject(new Error('pip config get exited 1')));

		expect(url).to.be.undefined;
	});

	test('returns undefined when nothing is configured', async () => {
		expect(await resolvePythonIndexUrl()).to.be.undefined;
	});
});

suite('ppmVulnerabilities - discoverPpmApi', () => {
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

	test('walks a pip index URL down to the API base and extracts the repo name', async () => {
		const fetchImpl = fakeFetch({
			'https://ppm.example.com/__api__/status': makeJsonResponse({ version: '2026.06.0' }),
		});

		const ppm = await discoverPpmApi('https://ppm.example.com/pypi/latest/simple', fetchImpl);

		expect(ppm).to.deep.equal({ apiBase: 'https://ppm.example.com', repoName: 'pypi' });
	});

	test('returns undefined for pypi.org', async () => {
		const fetchImpl = fakeFetch({});

		const ppm = await discoverPpmApi('https://pypi.org/simple/', fetchImpl);

		expect(ppm).to.be.undefined;
	});

	test('rejects a PPM older than 2023.12 (no vulnerability data)', async () => {
		const fetchImpl = fakeFetch({
			'https://old.example.com/__api__/status': makeJsonResponse({ version: '2022.07.2-11' }),
		});

		const ppm = await discoverPpmApi('https://old.example.com/pypi/latest/simple', fetchImpl);

		expect(ppm).to.be.undefined;
	});
});

suite('ppmVulnerabilities - fetchPpmVulnerabilities', () => {
	const PPM = { apiBase: 'https://ppm.example.com', repoName: 'pypi' };

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

		await fetchPpmVulnerabilities(
			PPM,
			[{ name: 'urllib3', version: '1.26.0' }, { name: 'localbuild' }],
			undefined,
			fetchImpl,
		);

		expect(calls).to.have.lengthOf(1);
		expect(calls[0].url).to.equal('https://ppm.example.com/__api__/filter/packages');
		const body = JSON.parse(calls[0].init?.body as string);
		expect(body.names).to.deep.equal(['urllib3==1.26.0']);
		expect(body.repo).to.equal('pypi');
	});

	test('distinguishes vulnerable, clean, and unknown packages', async () => {
		const fetchImpl = fetchReturning(
			ndjson(
				{ name: 'pycrypto', version: '2.6.1', vulns: [PYSEC_RECORD, GHSA_RECORD] },
				{ name: 'requests', version: '2.32.5' },
			),
		);

		const result = await fetchPpmVulnerabilities(
			PPM,
			[
				{ name: 'pycrypto', version: '2.6.1' },
				{ name: 'requests', version: '2.32.5' },
				{ name: 'vcs-install', version: '0.0.0.dev0' },
			],
			undefined,
			fetchImpl,
		);

		// Vulnerable: advisories present (deduplicated across aliases).
		// Clean: present in the repo, empty array. Unknown: absent entirely.
		expect(result.get('pycrypto')).to.have.lengthOf(1);
		expect(result.get('requests')).to.deep.equal([]);
		expect(result.has('vcs-install')).to.be.false;
	});

	test('makes no request when no spec has a version', async () => {
		const fetchImpl = ((): Promise<Response> => {
			throw new Error('should not be called');
		}) as unknown as FetchFn;

		const result = await fetchPpmVulnerabilities(PPM, [{ name: 'localbuild' }], undefined, fetchImpl);

		expect(result.size).to.equal(0);
	});
});

suite('ppmVulnerabilities - getPpmVulnerabilities', () => {
	const PYCRYPTO = [{ name: 'pycrypto', version: '2.6.1' }];
	const PUBLIC_FILTER_URL = 'https://packagemanager.posit.co/__api__/filter/packages';

	let calls: FetchCall[];

	withCleanIndexEnv();

	setup(() => {
		clearPpmDiscoveryCache();
		calls = [];
		setFeatureEnabled(true);
	});

	/** Stub the `packages.vulnerabilities.enabled` setting. */
	function setFeatureEnabled(enabled: boolean): void {
		when(mockedVSCodeNamespaces.workspace!.getConfiguration('packages')).thenReturn(({
			get: () => enabled,
		} as unknown) as vscode.WorkspaceConfiguration);
	}

	/** Record every request; answer status probes and filter queries by URL. */
	function fakeFetch(routes: Record<string, Response>): FetchFn {
		return ((url: string, init?: RequestInit) => {
			calls.push({ url, init });
			const response = routes[url];
			return response
				? Promise.resolve(response)
				: Promise.resolve(makeJsonResponse('not found', { ok: false, status: 404 }));
		}) as FetchFn;
	}

	test('queries the public instance when the environment has no PPM index', async () => {
		const fetchImpl = fakeFetch({
			[PUBLIC_FILTER_URL]: makeJsonResponse(
				ndjson({ name: 'pycrypto', version: '2.6.1', vulns: [PYSEC_RECORD, GHSA_RECORD] }),
			),
		});

		const result = await getPpmVulnerabilities(PYCRYPTO, undefined, undefined, fetchImpl);

		// Straight to the public instance: no index to resolve, so no probe.
		expect(calls.map((c) => c.url)).to.deep.equal([PUBLIC_FILTER_URL]);
		expect(JSON.parse(calls[0].init?.body as string).repo).to.equal('pypi');
		expect(result?.get('pycrypto')).to.have.lengthOf(1);
	});

	test('prefers the PPM the configured index points at', async () => {
		process.env.PIP_INDEX_URL = 'https://ppm.example.com/pypi/latest/simple';
		const fetchImpl = fakeFetch({
			'https://ppm.example.com/__api__/status': makeJsonResponse({ version: '2026.06.0' }),
			'https://ppm.example.com/__api__/filter/packages': makeJsonResponse(
				ndjson({ name: 'pycrypto', version: '2.6.1', vulns: [PYSEC_RECORD] }),
			),
		});

		const result = await getPpmVulnerabilities(PYCRYPTO, undefined, undefined, fetchImpl);

		// Probes the index path down to the API base, then queries that PPM --
		// the public instance is never contacted.
		expect(calls[calls.length - 1].url).to.equal('https://ppm.example.com/__api__/filter/packages');
		expect(calls.some((c) => c.url.startsWith('https://packagemanager.posit.co'))).to.be.false;
		expect(result?.get('pycrypto')).to.have.lengthOf(1);
	});

	test('falls back to the public instance when the configured index is not a PPM', async () => {
		process.env.PIP_INDEX_URL = 'https://pypi.org/simple';
		const fetchImpl = fakeFetch({
			[PUBLIC_FILTER_URL]: makeJsonResponse(ndjson({ name: 'pycrypto', version: '2.6.1' })),
		});

		const result = await getPpmVulnerabilities(PYCRYPTO, undefined, undefined, fetchImpl);

		// Probes pypi.org, finds no PPM, then asks the public instance anyway.
		expect(calls.map((c) => c.url)).to.deep.equal(['https://pypi.org/__api__/status', PUBLIC_FILTER_URL]);
		expect(result?.get('pycrypto')).to.deep.equal([]);
	});

	test('makes no request when the feature is disabled', async () => {
		setFeatureEnabled(false);
		const fetchImpl = fakeFetch({});

		const result = await getPpmVulnerabilities(PYCRYPTO, undefined, undefined, fetchImpl);

		expect(result).to.be.undefined;
		expect(calls).to.be.empty;
	});

	test('resolves undefined when the lookup fails', async () => {
		const fetchImpl = (() => Promise.reject(new Error('network down'))) as FetchFn;

		expect(await getPpmVulnerabilities(PYCRYPTO, undefined, undefined, fetchImpl)).to.be.undefined;
	});
});
