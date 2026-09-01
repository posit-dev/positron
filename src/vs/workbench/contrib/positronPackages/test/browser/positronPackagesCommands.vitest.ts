/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeSessionState, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IPackageVulnerability } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { PACKAGES_GET_ALL_PACKAGES_COMMAND_ID, PACKAGES_GET_PACKAGES_COMMAND_ID, getAllPackages, getPackages } from '../../browser/positronPackagesCommands.js';
import { IPackagesSnapshot, IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

/** An installed package as a session's package list reports it. */
function pkg(name: string, version: string): ILanguageRuntimePackage {
	return { id: `${name}-${version}`, name, displayName: name, version };
}

/** A session that can answer a package query, unless a test says otherwise. */
function createSession(runtimeState: RuntimeState = RuntimeState.Idle): ILanguageRuntimeSession {
	return stubInterface<ILanguageRuntimeSession>({
		sessionId: 'session-1',
		dynState: stubInterface<ILanguageRuntimeSessionState>({ sessionName: 'Python 3.12.4' }),
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
			languageId: 'python',
			languageName: 'Python',
			languageVersion: '3.12.4',
			runtimeName: 'Python 3.12.4 (.venv)',
		}),
		getRuntimeState: () => runtimeState,
	});
}

/**
 * A packages instance whose snapshot is `snapshot`, or that fails the read when
 * given an error. `details` supplies what getPackageDetail returns per package
 * (keyed by lowercased name), for the getPackages detail merge.
 */
function createInstance(
	snapshot: SnapshotStub | Error,
	session: ILanguageRuntimeSession = createSession(),
	details: Record<string, Partial<ILanguageRuntimePackage>> = {},
): IPositronPackagesInstance {
	return stubInterface<IPositronPackagesInstance>({
		session,
		getPackagesSnapshot: vi.fn(async () => {
			if (snapshot instanceof Error) {
				throw snapshot;
			}
			// Advisory fields default to what a snapshot that wasn't asked to
			// refresh reports, so only the tests about advisories mention them.
			return { vulnerabilityStatus: 'cached' as const, ...snapshot };
		}),
		getPackageDetail: vi.fn(async (name: string) => details[name.toLowerCase()]),
	});
}

/**
 * A snapshot with its advisory status left out, since most tests are about the
 * packages rather than where the advisories came from.
 */
type SnapshotStub = Omit<IPackagesSnapshot, 'vulnerabilityStatus'> & Partial<Pick<IPackagesSnapshot, 'vulnerabilityStatus'>>;

/** The Package Manager instance a test's advisories came from. */
const VULNERABILITY_SOURCE = { host: 'ppm.example.com', fetchedAt: Date.parse('2026-08-19T10:00:00.000Z') };

/** An advisory as the vulnerability lookup normalizes it. */
function advisory(id: string, score?: number): IPackageVulnerability {
	return {
		id,
		osvId: `PYSEC-${id}`,
		score,
		scoreVersion: score === undefined ? undefined : 'v3',
		summary: `${id} summary`,
		fixedIn: '2.3.0',
		published: '2026-05-01T00:00:00Z',
		url: `https://nvd.nist.gov/vuln/detail/${id}`,
	};
}

describe('getAllPackages', () => {
	const ctx = createTestContainer().build();

	/**
	 * Wires the services the command reads. `instance` is what the packages
	 * service reports as the active one.
	 */
	function stubServices(
		instance: IPositronPackagesInstance | undefined,
		configuration: Record<string, boolean> = { 'packages.enabled': true, 'positron.packages.enable': true },
	): void {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService(configuration));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IPositronPackagesService, stubInterface<IPositronPackagesService>({
			activePackagesInstance: instance,
		}));
	}

	it('reports disabled when the Packages pane is turned off, without reading the session', async () => {
		const getPackagesSnapshot = vi.fn<IPositronPackagesInstance['getPackagesSnapshot']>();
		stubServices(
			stubInterface<IPositronPackagesInstance>({ getPackagesSnapshot }),
			{ 'packages.enabled': false, 'positron.packages.enable': true },
		);

		const result = await getAllPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'disabled' });
		expect(getPackagesSnapshot).not.toHaveBeenCalled();
	});

	it('reports disabled when only the deprecated setting is off', async () => {
		stubServices(
			createInstance({ packages: [], metadataStatus: 'fresh' }),
			{ 'packages.enabled': true, 'positron.packages.enable': false },
		);

		const result = await getAllPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'disabled' });
	});

	// ai.enabled is deliberately not a gate: this payload is the user's own environment, not an AI
	// feature, and the other agentCompatible package commands don't gate on it either.
	it('reports packages even when ai.enabled is off', async () => {
		stubServices(createInstance({ packages: [pkg('numpy', '2.1.0')], metadataStatus: 'fresh' }), {
			'packages.enabled': true,
			'positron.packages.enable': true,
			'ai.enabled': false,
		});

		const result = await getAllPackages(ctx.instantiationService);

		expect(result).toMatchObject({ available: true, packages: [{ name: 'numpy' }] });
	});

	it('reports no-session when no interpreter session is active', async () => {
		stubServices(undefined);

		const result = await getAllPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'no-session' });
	});

	it('reports session-not-ready for a session that is still starting', async () => {
		const getPackagesSnapshot = vi.fn<IPositronPackagesInstance['getPackagesSnapshot']>();
		stubServices(stubInterface<IPositronPackagesInstance>({
			session: createSession(RuntimeState.Starting),
			getPackagesSnapshot,
		}));

		const result = await getAllPackages(ctx.instantiationService);

		// Asking a kernel that isn't listening yet would hang rather than answer.
		expect(result).toEqual({ available: false, reason: 'session-not-ready' });
		expect(getPackagesSnapshot).not.toHaveBeenCalled();
	});

	it('reports unsupported for a runtime that does not manage packages', async () => {
		stubServices(createInstance({ packages: [], metadataStatus: 'unsupported' }));

		const result = await getAllPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'unsupported' });
	});

	it('reports failed with the error message when the read fails', async () => {
		stubServices(createInstance(new Error('Timed out reading the installed packages.')));

		const result = await getAllPackages(ctx.instantiationService);

		expect(result).toEqual({
			available: false,
			reason: 'failed',
			message: 'Timed out reading the installed packages.',
		});
	});

	it('reads the snapshot without the advisory lookup', async () => {
		const instance = createInstance({ packages: [pkg('numpy', '2.1.0')], metadataStatus: 'fresh' });
		stubServices(instance);

		await getAllPackages(ctx.instantiationService);

		// The compact list carries no advisories, so it opts out of the fetch.
		expect(instance.getPackagesSnapshot).toHaveBeenCalledWith(undefined, { includeVulnerabilities: false });
	});

	it('returns the session, its packages, and how fresh their outdated state is -- but no advisories', async () => {
		stubServices(createInstance({
			metadataStatus: 'cached',
			// A snapshot may still carry advisories; the compact list drops them.
			vulnerabilityStatus: 'fresh',
			vulnerabilitySource: VULNERABILITY_SOURCE,
			packages: [
				{ ...pkg('pandas', '2.2.1'), outdated: true, latestVersion: '2.3.0', attached: true, description: 'Data analysis', url: 'https://pandas.pydata.org', vulnerabilities: [advisory('CVE-2026-1000', 9.8)] },
				// No summary: Python's package list sends '' rather than omitting it.
				{ ...pkg('numpy', '2.1.0'), outdated: false, description: '' },
			],
		}));

		const result = await getAllPackages(ctx.instantiationService);

		expect(result).toMatchInlineSnapshot(`
			{
			  "available": true,
			  "metadataStatus": "cached",
			  "packages": [
			    {
			      "attached": true,
			      "description": "Data analysis",
			      "latestVersion": "2.3.0",
			      "name": "pandas",
			      "outdated": true,
			      "url": "https://pandas.pydata.org",
			      "version": "2.2.1",
			    },
			    {
			      "attached": undefined,
			      "description": undefined,
			      "latestVersion": undefined,
			      "name": "numpy",
			      "outdated": false,
			      "url": undefined,
			      "version": "2.1.0",
			    },
			  ],
			  "session": {
			    "languageId": "python",
			    "languageName": "Python",
			    "languageVersion": "3.12.4",
			    "runtimeName": "Python 3.12.4 (.venv)",
			    "sessionId": "session-1",
			    "sessionName": "Python 3.12.4",
			  },
			}
		`);
	});

	it('caps a long description and marks it truncated', async () => {
		const longDescription = 'x'.repeat(300);
		stubServices(createInstance({
			metadataStatus: 'fresh',
			packages: [{ ...pkg('pandas', '2.2.1'), description: longDescription }],
		}));

		const result = await getAllPackages(ctx.instantiationService);

		const description = (result as { packages: { description: string }[] }).packages[0].description;
		expect(description).toBe(`${'x'.repeat(256)}...`);
	});

	it('is registered as an agent-compatible command', async () => {
		const command = CommandsRegistry.getCommand(PACKAGES_GET_ALL_PACKAGES_COMMAND_ID);

		expect(command?.metadata?.agentCompatible).toBe(true);
	});
});

describe('getPackages', () => {
	const ctx = createTestContainer().build();

	function stubServices(
		instance: IPositronPackagesInstance | undefined,
		configuration: Record<string, boolean> = { 'packages.enabled': true, 'positron.packages.enable': true },
	): void {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService(configuration));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IPositronPackagesService, stubInterface<IPositronPackagesService>({
			activePackagesInstance: instance,
		}));
	}

	it('reports no-names when called without any package names', async () => {
		const getPackagesSnapshot = vi.fn<IPositronPackagesInstance['getPackagesSnapshot']>();
		stubServices(stubInterface<IPositronPackagesInstance>({ getPackagesSnapshot }));

		const result = await getPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'no-names' });
		// A bad call, not a state of the session, so the session is never read.
		expect(getPackagesSnapshot).not.toHaveBeenCalled();
	});

	it('reports the environment reasons a read can fail with', async () => {
		stubServices(undefined);

		const result = await getPackages(ctx.instantiationService, 'pandas');

		expect(result).toEqual({ available: false, reason: 'no-session' });
	});

	it('reads the snapshot with the advisory lookup', async () => {
		const instance = createInstance({ packages: [pkg('numpy', '2.1.0')], metadataStatus: 'fresh' });
		stubServices(instance);

		await getPackages(ctx.instantiationService, 'numpy');

		expect(instance.getPackagesSnapshot).toHaveBeenCalledWith(undefined, { includeVulnerabilities: true });
	});

	it('returns full detail for the named packages and lists the rest as not found', async () => {
		stubServices(createInstance(
			{
				metadataStatus: 'fresh',
				vulnerabilityStatus: 'fresh',
				vulnerabilitySource: VULNERABILITY_SOURCE,
				packages: [
					{ ...pkg('pandas', '2.2.1'), outdated: true, latestVersion: '2.3.0', description: 'Data analysis', url: 'https://pandas.pydata.org', vulnerabilities: [advisory('CVE-2026-1000', 9.8)] },
					pkg('numpy', '2.1.0'),
				],
			},
			createSession(),
			// getPackageDetail merges these over the list entry.
			{ pandas: { license: 'BSD-3-Clause', author: 'The pandas team', sourceRepository: 'PyPI', publishedDate: '2026-02-01', title: 'Powerful data structures' } },
		));

		// Case-insensitive, and a name that is not installed lands in notFound.
		const result = await getPackages(ctx.instantiationService, ['Pandas', 'scikit-learn']);

		expect(result).toMatchInlineSnapshot(`
			{
			  "available": true,
			  "metadataStatus": "fresh",
			  "notFound": [
			    "scikit-learn",
			  ],
			  "packages": [
			    {
			      "attached": undefined,
			      "author": "The pandas team",
			      "description": "Data analysis",
			      "latestVersion": "2.3.0",
			      "license": "BSD-3-Clause",
			      "name": "pandas",
			      "outdated": true,
			      "publishedDate": "2026-02-01",
			      "sourceRepository": "PyPI",
			      "title": "Powerful data structures",
			      "url": "https://pandas.pydata.org",
			      "version": "2.2.1",
			      "vulnerabilities": [
			        {
			          "fixedIn": "2.3.0",
			          "id": "CVE-2026-1000",
			          "osvId": "PYSEC-CVE-2026-1000",
			          "published": "2026-05-01T00:00:00Z",
			          "score": 9.8,
			          "scoreVersion": "v3",
			          "severity": "critical",
			          "summary": "CVE-2026-1000 summary",
			          "url": "https://nvd.nist.gov/vuln/detail/CVE-2026-1000",
			        },
			      ],
			    },
			  ],
			  "session": {
			    "languageId": "python",
			    "languageName": "Python",
			    "languageVersion": "3.12.4",
			    "runtimeName": "Python 3.12.4 (.venv)",
			    "sessionId": "session-1",
			    "sessionName": "Python 3.12.4",
			  },
			  "vulnerabilitySource": {
			    "fetchedAt": "2026-08-19T10:00:00.000Z",
			    "host": "ppm.example.com",
			  },
			  "vulnerabilityStatus": "fresh",
			}
		`);
	});

	it('reports a named package\'s advisories worst first', async () => {
		stubServices(createInstance({
			metadataStatus: 'fresh',
			vulnerabilityStatus: 'fresh',
			vulnerabilitySource: VULNERABILITY_SOURCE,
			packages: [{
				...pkg('pandas', '2.2.1'),
				// Deliberately out of order, mixing scored with unscored.
				vulnerabilities: [advisory('CVE-2026-2000', 5.4), advisory('RSEC-2026-1'), advisory('CVE-2026-1000', 9.8)],
			}],
		}));

		const result = await getPackages(ctx.instantiationService, 'pandas');

		expect(result).toMatchObject({
			available: true,
			packages: [{
				name: 'pandas',
				vulnerabilities: [
					{ id: 'CVE-2026-1000', score: 9.8, severity: 'critical' },
					{ id: 'CVE-2026-2000', score: 5.4, severity: 'medium' },
					// Unscored sorts last but is still reported.
					{ id: 'RSEC-2026-1', score: undefined, severity: 'unscored' },
				],
			}],
		});
	});

	it('drops the advisories the cache still holds when lookups are turned off', async () => {
		stubServices(createInstance({
			metadataStatus: 'fresh',
			vulnerabilityStatus: 'disabled',
			packages: [{ ...pkg('pandas', '2.2.1'), vulnerabilities: [advisory('CVE-2026-1000', 9.8)] }],
		}));

		const result = await getPackages(ctx.instantiationService, 'pandas');

		expect(result).toMatchObject({
			available: true,
			vulnerabilityStatus: 'disabled',
			vulnerabilitySource: undefined,
			packages: [{ name: 'pandas', vulnerabilities: undefined }],
		});
	});

	it('is registered as an agent-compatible command that takes names', async () => {
		const command = CommandsRegistry.getCommand(PACKAGES_GET_PACKAGES_COMMAND_ID);

		expect(command?.metadata?.agentCompatible).toBe(true);
		expect(command?.metadata?.args?.[0].name).toBe('names');
	});
});
