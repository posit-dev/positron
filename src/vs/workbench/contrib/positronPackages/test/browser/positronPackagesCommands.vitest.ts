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
import { PACKAGES_GET_PACKAGES_COMMAND_ID, getPackages } from '../../browser/positronPackagesCommands.js';
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
 * given an error.
 */
function createInstance(
	snapshot: SnapshotStub | Error,
	session: ILanguageRuntimeSession = createSession(),
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

describe('getPackages', () => {
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

		const result = await getPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'disabled' });
		expect(getPackagesSnapshot).not.toHaveBeenCalled();
	});

	it('reports disabled when only the deprecated setting is off', async () => {
		stubServices(
			createInstance({ packages: [], metadataStatus: 'fresh' }),
			{ 'packages.enabled': true, 'positron.packages.enable': false },
		);

		const result = await getPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'disabled' });
	});

	// ai.enabled is deliberately not a gate: this payload is the user's own environment, not an AI
	// feature, and the other agentCompatible package commands don't gate on it either. A stray check
	// here would take the inspect action away from a user who turned AI off.
	it('reports packages even when ai.enabled is off', async () => {
		stubServices(createInstance({ packages: [pkg('numpy', '2.1.0')], metadataStatus: 'fresh' }), {
			'packages.enabled': true,
			'positron.packages.enable': true,
			'ai.enabled': false,
		});

		const result = await getPackages(ctx.instantiationService);

		expect(result).toMatchObject({ available: true, packages: [{ name: 'numpy' }] });
	});

	it('reports no-session when no interpreter session is active', async () => {
		stubServices(undefined);

		const result = await getPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'no-session' });
	});

	it('reports session-not-ready for a session that is still starting', async () => {
		const getPackagesSnapshot = vi.fn<IPositronPackagesInstance['getPackagesSnapshot']>();
		stubServices(stubInterface<IPositronPackagesInstance>({
			session: createSession(RuntimeState.Starting),
			getPackagesSnapshot,
		}));

		const result = await getPackages(ctx.instantiationService);

		// Asking a kernel that isn't listening yet would hang rather than answer.
		expect(result).toEqual({ available: false, reason: 'session-not-ready' });
		expect(getPackagesSnapshot).not.toHaveBeenCalled();
	});

	it('reports unsupported for a runtime that does not manage packages', async () => {
		stubServices(createInstance({ packages: [], metadataStatus: 'unsupported' }));

		const result = await getPackages(ctx.instantiationService);

		expect(result).toEqual({ available: false, reason: 'unsupported' });
	});

	it('reports failed with the error message when the read fails', async () => {
		stubServices(createInstance(new Error('Timed out reading the installed packages.')));

		const result = await getPackages(ctx.instantiationService);

		expect(result).toEqual({
			available: false,
			reason: 'failed',
			message: 'Timed out reading the installed packages.',
		});
	});

	it('returns the session, its packages, and how fresh their outdated state is', async () => {
		stubServices(createInstance({
			metadataStatus: 'cached',
			packages: [
				{ ...pkg('pandas', '2.2.1'), outdated: true, latestVersion: '2.3.0', attached: true, description: 'Data analysis', url: 'https://pandas.pydata.org' },
				// No summary: Python's package list sends '' rather than omitting it.
				{ ...pkg('numpy', '2.1.0'), outdated: false, description: '' },
			],
		}));

		const result = await getPackages(ctx.instantiationService);

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
			      "vulnerabilities": undefined,
			    },
			    {
			      "attached": undefined,
			      "description": undefined,
			      "latestVersion": undefined,
			      "name": "numpy",
			      "outdated": false,
			      "url": undefined,
			      "version": "2.1.0",
			      "vulnerabilities": undefined,
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
			  "vulnerabilitySource": undefined,
			  "vulnerabilityStatus": "cached",
			}
		`);
	});

	it('reports each package\'s advisories worst first, with the source that served them', async () => {
		stubServices(createInstance({
			metadataStatus: 'fresh',
			vulnerabilityStatus: 'fresh',
			vulnerabilitySource: VULNERABILITY_SOURCE,
			packages: [
				// Deliberately out of order, and mixing scored with unscored:
				// the payload leads with the advisory the pane leads with.
				{
					...pkg('pandas', '2.2.1'),
					vulnerabilities: [advisory('CVE-2026-2000', 5.4), advisory('RSEC-2026-1'), advisory('CVE-2026-1000', 9.8)],
				},
				// Asked about and reported clean: an empty array, not undefined.
				{ ...pkg('numpy', '2.1.0'), vulnerabilities: [] },
				// No advisory data at all, so nothing can be concluded.
				pkg('polars', '1.9.0'),
			],
		}));

		const result = await getPackages(ctx.instantiationService);

		expect(result).toMatchObject({
			available: true,
			vulnerabilityStatus: 'fresh',
			// Epoch ms in the snapshot, ISO 8601 in the payload.
			vulnerabilitySource: { host: VULNERABILITY_SOURCE.host, fetchedAt: '2026-08-19T10:00:00.000Z' },
			packages: [
				{
					name: 'pandas',
					vulnerabilities: [
						{ id: 'CVE-2026-1000', score: 9.8, severity: 'critical' },
						{ id: 'CVE-2026-2000', score: 5.4, severity: 'medium' },
						// Unscored sorts last but is still reported: known
						// vulnerable, severity unknown.
						{ id: 'RSEC-2026-1', score: undefined, severity: 'unscored' },
					],
				},
				{ name: 'numpy', vulnerabilities: [] },
				{ name: 'polars', vulnerabilities: undefined },
			],
		});
	});

	it('maps every advisory field the lookup carries', async () => {
		stubServices(createInstance({
			metadataStatus: 'fresh',
			vulnerabilityStatus: 'fresh',
			vulnerabilitySource: VULNERABILITY_SOURCE,
			packages: [{ ...pkg('pandas', '2.2.1'), vulnerabilities: [advisory('CVE-2026-1000', 7.5)] }],
		}));

		const result = await getPackages(ctx.instantiationService);

		expect(result).toMatchInlineSnapshot(`
			{
			  "available": true,
			  "metadataStatus": "fresh",
			  "packages": [
			    {
			      "attached": undefined,
			      "description": undefined,
			      "latestVersion": undefined,
			      "name": "pandas",
			      "outdated": undefined,
			      "url": undefined,
			      "version": "2.2.1",
			      "vulnerabilities": [
			        {
			          "fixedIn": "2.3.0",
			          "id": "CVE-2026-1000",
			          "osvId": "PYSEC-CVE-2026-1000",
			          "published": "2026-05-01T00:00:00Z",
			          "score": 7.5,
			          "scoreVersion": "v3",
			          "severity": "high",
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

	it('drops the advisories the cache still holds when lookups are turned off', async () => {
		// The snapshot reports 'disabled' from the setting but still merges
		// whatever the cache kept from before it was turned off. The payload
		// must not report data its own status says isn't there.
		stubServices(createInstance({
			metadataStatus: 'fresh',
			vulnerabilityStatus: 'disabled',
			packages: [{ ...pkg('pandas', '2.2.1'), vulnerabilities: [advisory('CVE-2026-1000', 9.8)] }],
		}));

		const result = await getPackages(ctx.instantiationService);

		expect(result).toMatchObject({
			available: true,
			vulnerabilityStatus: 'disabled',
			// Nothing to attribute, so no source is named either.
			vulnerabilitySource: undefined,
			packages: [{ name: 'pandas', vulnerabilities: undefined }],
		});
	});

	it('passes the advisory status through rather than deriving its own', async () => {
		// Only the snapshot knows whether a lookup ran, so the payload reports
		// what it was told -- including 'unavailable', which says a lookup
		// happened and found nothing, not that one is still owed.
		stubServices(createInstance({
			metadataStatus: 'fresh',
			vulnerabilityStatus: 'unavailable',
			packages: [pkg('pandas', '2.2.1')],
		}));

		const result = await getPackages(ctx.instantiationService);

		expect(result).toMatchObject({
			available: true,
			vulnerabilityStatus: 'unavailable',
			vulnerabilitySource: undefined,
		});
	});

	it('is registered as an agent-compatible command', async () => {
		const command = CommandsRegistry.getCommand(PACKAGES_GET_PACKAGES_COMMAND_ID);

		expect(command?.metadata?.agentCompatible).toBe(true);
	});
});
