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
import { ILanguageRuntimePackage, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
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
	snapshot: IPackagesSnapshot | Error,
	session: ILanguageRuntimeSession = createSession(),
): IPositronPackagesInstance {
	return stubInterface<IPositronPackagesInstance>({
		session,
		getPackagesSnapshot: vi.fn(async () => {
			if (snapshot instanceof Error) {
				throw snapshot;
			}
			return snapshot;
		}),
	});
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

	it('is registered as an agent-compatible command', async () => {
		const command = CommandsRegistry.getCommand(PACKAGES_GET_PACKAGES_COMMAND_ID);

		expect(command?.metadata?.agentCompatible).toBe(true);
	});
});
