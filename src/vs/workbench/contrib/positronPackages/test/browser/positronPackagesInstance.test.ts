/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimePackageManager, ILanguageRuntimeSession, IPackageSpec } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

suite('Positron - PositronPackagesInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let packagesInstance: PositronPackagesInstance;
	let mockSession: Partial<ILanguageRuntimeSession>;
	let mockPackageManager: Partial<ILanguageRuntimePackageManager>;
	let onDidChangeRuntimeStateEmitter: Emitter<RuntimeState>;
	let onDidChangeSyncSupportEmitter: Emitter<boolean>;

	const testPackages: ILanguageRuntimePackage[] = [
		{ id: 'numpy', name: 'numpy', displayName: 'NumPy', version: '1.24.0' },
		{ id: 'pandas', name: 'pandas', displayName: 'pandas', version: '2.0.0' },
	];

	setup(() => {
		onDidChangeRuntimeStateEmitter = disposables.add(new Emitter<RuntimeState>());
		onDidChangeSyncSupportEmitter = disposables.add(new Emitter<boolean>());

		mockPackageManager = {
			getPackages: async () => testPackages,
			installPackages: async () => { },
			uninstallPackages: async () => { },
			updatePackages: async () => { },
			updateAllPackages: async () => { },
			searchPackages: async () => [],
			searchPackageVersions: async () => [],
			supportsSyncFromRequirements: async () => true,
			syncFromRequirements: async () => { },
		};

		mockSession = {
			sessionId: 'test-session',
			getPackageManager: () => mockPackageManager as ILanguageRuntimePackageManager,
			getRuntimeState: () => RuntimeState.Ready,
			onDidChangeRuntimeState: onDidChangeRuntimeStateEmitter.event,
			onDidChangeSyncSupport: onDidChangeSyncSupportEmitter.event,
		};

		packagesInstance = disposables.add(
			new PositronPackagesInstance(mockSession as ILanguageRuntimeSession, new NullLogService())
		);
	});

	suite('refreshPackages', () => {
		test('fetches packages from package manager', async () => {
			const packages = await packagesInstance.refreshPackages();

			assert.deepStrictEqual(packages, testPackages);
			assert.deepStrictEqual(packagesInstance.packages, testPackages);
		});

		test('fires refresh state events', async () => {
			const states: boolean[] = [];
			disposables.add(packagesInstance.onDidChangeRefreshState(state => states.push(state)));

			await packagesInstance.refreshPackages();

			assert.deepStrictEqual(states, [true, false]);
		});

		test('fires onDidRefreshPackagesInstance event', async () => {
			// Set up promise before triggering refresh
			const refreshedPackagesPromise = Event.toPromise(packagesInstance.onDidRefreshPackagesInstance);

			// Trigger refresh (don't await - let it run while we wait for the event)
			packagesInstance.refreshPackages();

			// Now await the event
			const result = await refreshedPackagesPromise;
			assert.deepStrictEqual(result, testPackages);
		});

		test('throws error when package manager is not available', async () => {
			mockSession.getPackageManager = undefined;
			packagesInstance = disposables.add(
				new PositronPackagesInstance(mockSession as ILanguageRuntimeSession, new NullLogService())
			);

			await assert.rejects(
				() => packagesInstance.refreshPackages(),
				/Package management not implemented/
			);
		});
	});

	suite('installPackages', () => {
		test('calls package manager installPackages', async () => {
			let installedPackages: IPackageSpec[] = [];
			mockPackageManager.installPackages = async (packages) => {
				installedPackages = packages;
			};

			const packagesToInstall: IPackageSpec[] = [{ name: 'requests', version: '2.28.0' }];
			await packagesInstance.installPackages(packagesToInstall);

			assert.deepStrictEqual(installedPackages, packagesToInstall);
		});

		test('refreshes packages after install', async () => {
			let refreshCalled = false;
			mockPackageManager.getPackages = async () => {
				refreshCalled = true;
				return testPackages;
			};

			await packagesInstance.installPackages([{ name: 'requests' }]);

			assert.strictEqual(refreshCalled, true);
		});

		test('fires install state events', async () => {
			const states: boolean[] = [];
			disposables.add(packagesInstance.onDidChangeInstallState(state => states.push(state)));

			await packagesInstance.installPackages([{ name: 'requests' }]);

			assert.deepStrictEqual(states, [true, false]);
		});
	});

	suite('uninstallPackages', () => {
		test('calls package manager uninstallPackages', async () => {
			let uninstalledPackages: string[] = [];
			mockPackageManager.uninstallPackages = async (packages) => {
				uninstalledPackages = packages;
			};

			await packagesInstance.uninstallPackages(['numpy', 'pandas']);

			assert.deepStrictEqual(uninstalledPackages, ['numpy', 'pandas']);
		});

		test('fires uninstall state events', async () => {
			const states: boolean[] = [];
			disposables.add(packagesInstance.onDidChangeUninstallState(state => states.push(state)));

			await packagesInstance.uninstallPackages(['numpy']);

			assert.deepStrictEqual(states, [true, false]);
		});
	});

	suite('updatePackages', () => {
		test('calls package manager updatePackages', async () => {
			let updatedPackages: IPackageSpec[] = [];
			mockPackageManager.updatePackages = async (packages) => {
				updatedPackages = packages;
			};

			const packagesToUpdate: IPackageSpec[] = [{ name: 'numpy', version: '1.25.0' }];
			await packagesInstance.updatePackages(packagesToUpdate);

			assert.deepStrictEqual(updatedPackages, packagesToUpdate);
		});

		test('fires update state events', async () => {
			const states: boolean[] = [];
			disposables.add(packagesInstance.onDidChangeUpdateState(state => states.push(state)));

			await packagesInstance.updatePackages([{ name: 'numpy' }]);

			assert.deepStrictEqual(states, [true, false]);
		});
	});

	suite('updateAllPackages', () => {
		test('calls package manager updateAllPackages', async () => {
			let updateAllCalled = false;
			mockPackageManager.updateAllPackages = async () => {
				updateAllCalled = true;
			};

			await packagesInstance.updateAllPackages();

			assert.strictEqual(updateAllCalled, true);
		});

		test('fires update all state events', async () => {
			const states: boolean[] = [];
			disposables.add(packagesInstance.onDidChangeUpdateAllState(state => states.push(state)));

			await packagesInstance.updateAllPackages();

			assert.deepStrictEqual(states, [true, false]);
		});
	});

	suite('syncFromRequirements', () => {
		test('calls package manager syncFromRequirements', async () => {
			let syncCalled = false;
			mockPackageManager.syncFromRequirements = async () => {
				syncCalled = true;
			};

			await packagesInstance.syncFromRequirements();

			assert.strictEqual(syncCalled, true);
		});

		test('refreshes packages after sync', async () => {
			let refreshCalled = false;
			mockPackageManager.getPackages = async () => {
				refreshCalled = true;
				return testPackages;
			};

			await packagesInstance.syncFromRequirements();

			assert.strictEqual(refreshCalled, true);
		});

		test('fires sync state events', async () => {
			const states: boolean[] = [];
			disposables.add(packagesInstance.onDidChangeSyncState(state => states.push(state)));

			await packagesInstance.syncFromRequirements();

			assert.deepStrictEqual(states, [true, false]);
		});

		test('does not refresh if cancelled', async () => {
			const cts = new CancellationTokenSource();
			let refreshCalled = false;

			mockPackageManager.syncFromRequirements = async (token) => {
				cts.cancel();
			};
			mockPackageManager.getPackages = async () => {
				refreshCalled = true;
				return testPackages;
			};

			await packagesInstance.syncFromRequirements(cts.token);

			assert.strictEqual(refreshCalled, false);
		});
	});

	suite('supportsSyncFromRequirements', () => {
		test('returns true when package manager supports it', async () => {
			mockPackageManager.supportsSyncFromRequirements = async () => true;

			const result = await packagesInstance.supportsSyncFromRequirements();

			assert.strictEqual(result, true);
		});

		test('returns false when package manager does not support it', async () => {
			mockPackageManager.supportsSyncFromRequirements = async () => false;

			const result = await packagesInstance.supportsSyncFromRequirements();

			assert.strictEqual(result, false);
		});

		test('returns false when package manager is not available', async () => {
			mockSession.getPackageManager = undefined;
			packagesInstance = disposables.add(
				new PositronPackagesInstance(mockSession as ILanguageRuntimeSession, new NullLogService())
			);

			const result = await packagesInstance.supportsSyncFromRequirements();

			assert.strictEqual(result, false);
		});
	});

	suite('searchPackages', () => {
		test('returns search results from package manager', async () => {
			const searchResults: ILanguageRuntimePackage[] = [
				{ id: 'requests', name: 'requests', displayName: 'Requests', version: '2.28.0' },
			];
			mockPackageManager.searchPackages = async () => searchResults;

			const result = await packagesInstance.searchPackages('requests');

			assert.deepStrictEqual(result, searchResults);
		});

		test('returns empty array when cancelled', async () => {
			const cancelledToken = { isCancellationRequested: true } as CancellationToken;
			mockPackageManager.searchPackages = async () => [
				{ id: 'requests', name: 'requests', displayName: 'Requests', version: '2.28.0' }
			];

			const result = await packagesInstance.searchPackages('requests', cancelledToken);

			assert.deepStrictEqual(result, []);
		});
	});

	suite('searchPackageVersions', () => {
		test('returns version results from package manager', async () => {
			const versions = ['2.28.0', '2.27.0', '2.26.0'];
			mockPackageManager.searchPackageVersions = async () => versions;

			const result = await packagesInstance.searchPackageVersions('requests');

			assert.deepStrictEqual(result, versions);
		});

		test('returns empty array when cancelled', async () => {
			const cancelledToken = { isCancellationRequested: true } as CancellationToken;
			mockPackageManager.searchPackageVersions = async () => ['2.28.0'];

			const result = await packagesInstance.searchPackageVersions('requests', cancelledToken);

			assert.deepStrictEqual(result, []);
		});
	});

	suite('attachRuntime', () => {
		test('refreshes packages when runtime becomes ready', async () => {
			let refreshCalled = false;
			mockPackageManager.getPackages = async () => {
				refreshCalled = true;
				return testPackages;
			};

			// Start with a non-ready state
			mockSession.getRuntimeState = () => RuntimeState.Starting;
			packagesInstance.attachRuntime();

			// Initially should not have refreshed
			assert.strictEqual(refreshCalled, false);

			// Simulate runtime becoming ready
			onDidChangeRuntimeStateEmitter.fire(RuntimeState.Ready);

			// Wait for async refresh
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(refreshCalled, true);
		});

		test('refreshes packages immediately if runtime is already ready', async () => {
			let refreshCalled = false;
			mockPackageManager.getPackages = async () => {
				refreshCalled = true;
				return testPackages;
			};

			mockSession.getRuntimeState = () => RuntimeState.Ready;
			packagesInstance.attachRuntime();

			// Wait for async refresh
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(refreshCalled, true);
		});
	});
});
