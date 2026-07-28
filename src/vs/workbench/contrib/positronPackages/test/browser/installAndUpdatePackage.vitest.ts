/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationError } from '../../../../../base/common/errors.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProgress, IProgressService, IProgressStep, Progress } from '../../../../../platform/progress/common/progress.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';

// The real quick-pick flow needs a live QuickInputService plus a 300ms debounce,
// and this change does not touch it. Mocking it keeps these tests on what did
// change: the dispatch decision, and how an outcome becomes a result.
const { installPackageMock, updatePackageMock } = vi.hoisted(() => ({
	installPackageMock: vi.fn(),
	updatePackageMock: vi.fn(),
}));
vi.mock('../../browser/positronPackagesQuickPick.js', () => ({
	installPackage: installPackageMock,
	updatePackage: updatePackageMock,
	uninstallPackage: vi.fn(),
}));

const { InstallPackageAction, UpdatePackageAction } = await import('../../browser/positronPackages.contribution.js');

describe('packages install and update commands', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let installPackages: ReturnType<typeof vi.fn<IPositronPackagesService['installPackages']>>;
	let updatePackages: ReturnType<typeof vi.fn<IPositronPackagesService['updatePackages']>>;
	let searchPackageVersions: ReturnType<typeof vi.fn<IPositronPackagesService['searchPackageVersions']>>;
	let error: ReturnType<typeof vi.fn<INotificationService['error']>>;
	let prompt: ReturnType<typeof vi.fn<INotificationService['prompt']>>;

	/**
	 * Wires the services `run()` reads. The session is passed explicitly so that
	 * "no active session" cannot be confused with "not specified".
	 */
	function stubServices(activeSession: ILanguageRuntimeSession | undefined): void {
		ctx.instantiationService.stub(IPositronPackagesService, stubInterface<IPositronPackagesService>({
			activeSession,
			installPackages,
			updatePackages,
			searchPackageVersions,
			searchPackages: vi.fn().mockResolvedValue([]),
			refreshPackages: vi.fn().mockResolvedValue([]),
		}));
		ctx.instantiationService.stub(INotificationService, stubInterface<INotificationService>({ error, prompt }));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			restartSession: vi.fn(),
		}));
		ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({
			executeCommand: vi.fn(),
		}));
		stubProgress();
	}

	/**
	 * Runs the task immediately. `cancel` fires the cancel handler first, which is
	 * what the user clicking Cancel on the progress notification does.
	 */
	function stubProgress(cancel = false): void {
		ctx.instantiationService.stub(IProgressService, stubInterface<IProgressService>({
			withProgress: <R>(
				_options: unknown,
				task: (progress: IProgress<IProgressStep>) => Promise<R>,
				onDidCancel?: (choice?: number) => void
			): Promise<R> => {
				if (cancel) {
					onDidCancel?.();
				}
				return task(Progress.None);
			},
		}));
	}

	beforeEach(() => {
		installPackages = vi.fn<IPositronPackagesService['installPackages']>().mockResolvedValue(undefined);
		updatePackages = vi.fn<IPositronPackagesService['updatePackages']>().mockResolvedValue(undefined);
		searchPackageVersions = vi.fn<IPositronPackagesService['searchPackageVersions']>().mockResolvedValue(['1.8', '1.9', '2.0.0rc1']);
		error = vi.fn<INotificationService['error']>();
		prompt = vi.fn<INotificationService['prompt']>();
		installPackageMock.mockReset().mockResolvedValue(undefined);
		updatePackageMock.mockReset().mockResolvedValue(undefined);
		stubServices(stubInterface<ILanguageRuntimeSession>({ sessionId: 'session-1' }));
	});

	async function runInstall(...args: unknown[]) {
		const action = new InstallPackageAction();
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor, ...args));
	}

	async function runUpdate(...args: unknown[]) {
		const action = new UpdatePackageAction();
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor, ...args));
	}

	describe('InstallPackageAction', () => {
		it('installs an exact version without opening a picker or looking up versions', async () => {
			const result = await runInstall('dplyr', '1.1.4');

			expect(result).toEqual({ installed: true, name: 'dplyr', version: '1.1.4' });
			expect(installPackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.1.4' }], expect.anything());
			expect(searchPackageVersions).not.toHaveBeenCalled();
			expect(installPackageMock).not.toHaveBeenCalled();
		});

		it('resolves \'latest\' to the newest stable version', async () => {
			const result = await runInstall('dplyr', 'latest');

			expect(result).toEqual({ installed: true, name: 'dplyr', version: '1.9' });
			expect(installPackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.9' }], expect.anything());
		});

		it('accepts \'latest\' in any case, and trims both arguments', async () => {
			const result = await runInstall('  dplyr  ', '  Latest  ');

			expect(result).toEqual({ installed: true, name: 'dplyr', version: '1.9' });
			expect(installPackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.9' }], expect.anything());
		});

		it('reports a failed install instead of reporting success', async () => {
			installPackages.mockRejectedValue(new Error('[31mno such package[0m'));

			const result = await runInstall('nope', '1.0.0');

			expect(result).toEqual({ installed: false, name: 'nope', version: '1.0.0', message: 'no such package' });
			expect(error).toHaveBeenCalledWith('no such package');
			expect(prompt).not.toHaveBeenCalled();
		});

		it('reports a missing session as a failure', async () => {
			installPackages.mockRejectedValue(new Error('No active session found.'));

			const result = await runInstall('dplyr', '1.1.4');

			expect(result).toEqual({ installed: false, name: 'dplyr', version: '1.1.4', message: 'No active session found.' });
		});

		it('reports when no versions are available for \'latest\'', async () => {
			searchPackageVersions.mockResolvedValue([]);

			const result = await runInstall('nope', 'latest');

			expect(result).toEqual({
				installed: false,
				name: 'nope',
				message: `No available versions of 'nope' were found. Check the package name and the repositories configured for this session.`,
			});
			expect(installPackages).not.toHaveBeenCalled();
			expect(error).toHaveBeenCalled();
		});

		it('reports a failed version lookup for \'latest\'', async () => {
			searchPackageVersions.mockRejectedValue(new Error('network down'));

			const result = await runInstall('dplyr', 'latest');

			expect(result).toEqual({ installed: false, name: 'dplyr', message: 'network down' });
			expect(installPackages).not.toHaveBeenCalled();
			expect(error).toHaveBeenCalledWith('network down');
		});

		it('reports a canceled version lookup without an error notification', async () => {
			searchPackageVersions.mockRejectedValue(new CancellationError());

			const result = await runInstall('dplyr', 'latest');

			expect(result).toEqual({
				installed: false,
				name: 'dplyr',
				message: `Finding the latest version of 'dplyr' was canceled.`,
			});
			expect(error).not.toHaveBeenCalled();
		});

		it('reports a canceled install without an error notification', async () => {
			stubProgress(true);
			installPackages.mockRejectedValue(new CancellationError());

			const result = await runInstall('dplyr', '1.1.4');

			expect(result).toEqual({
				installed: false,
				name: 'dplyr',
				version: '1.1.4',
				message: `The install of 'dplyr' was canceled.`,
			});
			expect(error).not.toHaveBeenCalled();
		});

		it('suggests a session restart after a successful install', async () => {
			await runInstall('dplyr', '1.1.4');

			expect(prompt).toHaveBeenCalled();
		});

		it('does not suggest a restart when there is no active session', async () => {
			stubServices(undefined);

			const result = await runInstall('dplyr', '1.1.4');

			expect(result).toEqual({ installed: true, name: 'dplyr', version: '1.1.4' });
			expect(prompt).not.toHaveBeenCalled();
		});

		it('opens the search quick-pick when a name is given with no version', async () => {
			const result = await runInstall('dplyr');

			expect(installPackageMock).toHaveBeenCalledOnce();
			expect(installPackages).not.toHaveBeenCalled();
			expect(result).toEqual({ installed: false, message: 'No package was selected.' });
		});

		it('opens the search quick-pick when a menu context object is passed as arg0', async () => {
			await runInstall({ id: 'menu-context' });

			expect(installPackageMock).toHaveBeenCalledOnce();
			expect(installPackages).not.toHaveBeenCalled();
		});

		// Every one of these falls through to the quick-pick rather than
		// installing something unintended. A caller with no user in front of it
		// gets the no-selection result once the picker is dismissed.
		it('never installs anything when the arguments are malformed', async () => {
			const results = [];
			for (const args of [
				[''],                          // empty name
				['dplyr', ''],                 // empty version
				['   ', '1.1.4'],              // whitespace-only name
				[undefined, '1.1.4'],          // version with no name
				['dplyr', 1.14],               // non-string version
				[42, '1.1.4'],                 // non-string name
				[null, null],                  // nulls
				[],                            // no arguments at all (the palette)
			]) {
				results.push(await runInstall(...args));
			}

			expect(installPackages).not.toHaveBeenCalled();
			expect(results.every(r => r.installed === false)).toBe(true);
		});

		it('ignores extra arguments beyond name and version', async () => {
			const result = await runInstall('dplyr', '1.1.4', 'unexpected', { more: true });

			expect(result).toEqual({ installed: true, name: 'dplyr', version: '1.1.4' });
			expect(installPackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.1.4' }], expect.anything());
		});

		it('returns the outcome of an install chosen in the quick-pick', async () => {
			// The helper's fourth argument is the performInstall callback.
			installPackageMock.mockImplementation(async (_accessor, _search, _versions, performInstall) =>
				performInstall('tibble', '3.2.1'));

			const result = await runInstall();

			expect(result).toEqual({ installed: true, name: 'tibble', version: '3.2.1' });
			expect(installPackages).toHaveBeenCalledWith([{ name: 'tibble', version: '3.2.1' }], expect.anything());
		});

		it('reports a failed install chosen in the quick-pick', async () => {
			installPackages.mockRejectedValue(new Error('boom'));
			installPackageMock.mockImplementation(async (_accessor, _search, _versions, performInstall) =>
				performInstall('tibble', '3.2.1'));

			const result = await runInstall();

			expect(result).toEqual({ installed: false, name: 'tibble', version: '3.2.1', message: 'boom' });
		});
	});

	describe('UpdatePackageAction', () => {
		it('updates to an exact version without opening a picker or looking up versions', async () => {
			const result = await runUpdate('dplyr', '1.1.4');

			expect(result).toEqual({ updated: true, name: 'dplyr', version: '1.1.4' });
			expect(updatePackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.1.4' }], expect.anything());
			expect(searchPackageVersions).not.toHaveBeenCalled();
			expect(updatePackageMock).not.toHaveBeenCalled();
		});

		it('resolves \'latest\' to a concrete version, never undefined', async () => {
			// pip and uv-outside-a-project reject a missing version on update, so
			// the version reaching the service must always be concrete.
			const result = await runUpdate('dplyr', 'latest');

			expect(result).toEqual({ updated: true, name: 'dplyr', version: '1.9' });
			expect(updatePackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.9' }], expect.anything());
		});

		it('accepts \'latest\' in any case, and trims both arguments', async () => {
			const result = await runUpdate('  dplyr  ', '  LATEST  ');

			expect(result).toEqual({ updated: true, name: 'dplyr', version: '1.9' });
			expect(updatePackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.9' }], expect.anything());
		});

		it('reports a failed update instead of reporting success', async () => {
			updatePackages.mockRejectedValue(new Error('[31mA version is required to update \'dplyr\'.[0m'));

			const result = await runUpdate('dplyr', '1.1.4');

			expect(result).toEqual({
				updated: false,
				name: 'dplyr',
				version: '1.1.4',
				message: `A version is required to update 'dplyr'.`,
			});
			expect(error).toHaveBeenCalledWith(`A version is required to update 'dplyr'.`);
			expect(prompt).not.toHaveBeenCalled();
		});

		it('reports when no versions are available for \'latest\'', async () => {
			searchPackageVersions.mockResolvedValue([]);

			const result = await runUpdate('nope', 'latest');

			expect(result).toEqual({
				updated: false,
				name: 'nope',
				message: `No available versions of 'nope' were found. Check the package name and the repositories configured for this session.`,
			});
			expect(updatePackages).not.toHaveBeenCalled();
		});

		it('reports a failed version lookup for \'latest\'', async () => {
			searchPackageVersions.mockRejectedValue(new Error('network down'));

			const result = await runUpdate('dplyr', 'latest');

			expect(result).toEqual({ updated: false, name: 'dplyr', message: 'network down' });
			expect(updatePackages).not.toHaveBeenCalled();
		});

		it('reports a canceled update without an error notification', async () => {
			stubProgress(true);
			updatePackages.mockRejectedValue(new CancellationError());

			const result = await runUpdate('dplyr', '1.1.4');

			expect(result).toEqual({
				updated: false,
				name: 'dplyr',
				version: '1.1.4',
				message: `The update of 'dplyr' was canceled.`,
			});
			expect(error).not.toHaveBeenCalled();
		});

		it('routes a name-only invocation to the version picker with the package pre-selected', async () => {
			const result = await runUpdate('dplyr');

			expect(updatePackageMock).toHaveBeenCalledOnce();
			// The helper's fifth argument is the pre-selected package.
			expect(updatePackageMock.mock.calls[0][4]).toBe('dplyr');
			expect(updatePackages).not.toHaveBeenCalled();
			expect(result).toEqual({ updated: false, name: 'dplyr', message: 'No version was selected.' });
		});

		it('routes a menu context object to the package picker', async () => {
			const result = await runUpdate({ id: 'menu-context' });

			expect(updatePackageMock.mock.calls[0][4]).toBeUndefined();
			expect(result).toEqual({ updated: false, message: 'No package was selected.' });
		});

		it('never updates anything when the arguments are malformed', async () => {
			const results = [];
			for (const args of [
				[''],
				['dplyr', ''],
				['   ', '1.1.4'],
				[undefined, '1.1.4'],
				['dplyr', 1.14],
				[42, '1.1.4'],
				[null, null],
				[],
			]) {
				results.push(await runUpdate(...args));
			}

			expect(updatePackages).not.toHaveBeenCalled();
			expect(results.every(r => r.updated === false)).toBe(true);
		});

		it('returns the outcome of an update chosen in the quick-pick', async () => {
			updatePackageMock.mockImplementation(async (_accessor, _search, _versions, performUpdate) =>
				performUpdate('dplyr', '1.1.10'));

			const result = await runUpdate('dplyr');

			expect(result).toEqual({ updated: true, name: 'dplyr', version: '1.1.10' });
			expect(updatePackages).toHaveBeenCalledWith([{ name: 'dplyr', version: '1.1.10' }], expect.anything());
		});
	});
});
