/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimePackageManager, ILanguageRuntimeSession, IPackageSpec } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { PackageMetadataCache } from '../../browser/packageMetadataCache.js';
import { PackageVulnerabilityLookup } from '../../browser/packageVulnerabilityLookup.js';
import { PositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

function pkg(name: string, version: string, latestVersion?: string): ILanguageRuntimePackage {
	return {
		id: `${name}-${version}`, name, displayName: name, version,
		...(latestVersion ? { outdated: true, latestVersion } : {}),
	};
}

/**
 * Builds an instance whose backend reports `before` on the first
 * `getPackages()` and `after` on every subsequent call. Backend
 * `updatePackages` calls are recorded in `updateCalls`.
 */
function makeInstance(store: DisposableStore, before: ILanguageRuntimePackage[], after: ILanguageRuntimePackage[]) {
	const lists = [before, after];
	let call = 0;
	const updateCalls: IPackageSpec[][] = [];
	const packageManager = stubInterface<ILanguageRuntimePackageManager>({
		getPackages: async () => lists[Math.min(call++, lists.length - 1)],
		updatePackages: async (packages: IPackageSpec[]) => { updateCalls.push(packages); },
		getPackageMetadata: undefined,
		repositoryRequest: undefined,
	});
	const session = stubInterface<ILanguageRuntimeSession>({
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: 'test-runtime', languageId: 'r' }),
		getPackageManager: () => packageManager,
	});
	const storage = store.add(new InMemoryStorageService());
	const cache = new PackageMetadataCache(storage, new NullLogService(), new TestConfigurationService());
	const vulnerabilityLookup = stubInterface<PackageVulnerabilityLookup>({ getVulnerabilities: async () => undefined, enabled: true });
	const instance = store.add(new PositronPackagesInstance(session, new NullLogService(), cache, vulnerabilityLookup));
	return { instance, updateCalls };
}

describe('PositronPackagesInstance.updateOutdatedPackages', () => {

	ensureNoLeakedDisposables();

	const store = new DisposableStore();
	afterEach(() => store.clear());

	it('passes the cached latest version to the backend and skips up-to-date packages', async () => {
		const before = [pkg('dplyr', '1.1.3', '1.1.4'), pkg('ggplot2', '3.4.0')];
		const { instance, updateCalls } = makeInstance(store, before, before);
		await instance.refreshPackages();

		await instance.updateOutdatedPackages(['dplyr', 'ggplot2']);

		expect(updateCalls).toEqual([[{ name: 'dplyr', version: '1.1.4' }]]);
	});

	it('returns only the packages whose version changed', async () => {
		const before = [pkg('dplyr', '1.1.3', '1.1.4'), pkg('ggplot2', '3.4.0', '3.5.0')];
		const after = [pkg('dplyr', '1.1.4'), pkg('ggplot2', '3.4.0', '3.5.0')];
		const { instance } = makeInstance(store, before, after);
		await instance.refreshPackages();

		expect(await instance.updateOutdatedPackages(['dplyr', 'ggplot2'])).toEqual(['dplyr']);
	});

	it('returns an empty array and never calls the backend when nothing is updatable', async () => {
		const before = [pkg('dplyr', '1.1.3'), pkg('ggplot2', '3.4.0')];
		const { instance, updateCalls } = makeInstance(store, before, before);
		await instance.refreshPackages();

		expect(await instance.updateOutdatedPackages(['dplyr', 'ggplot2'])).toEqual([]);
		expect(updateCalls).toEqual([]);
	});

	it('returns an empty array when the backend ran but versions did not change', async () => {
		const before = [pkg('dplyr', '1.1.3', '1.1.4')];
		const { instance, updateCalls } = makeInstance(store, before, before);
		await instance.refreshPackages();

		expect(await instance.updateOutdatedPackages(['dplyr'])).toEqual([]);
		expect(updateCalls.length).toBe(1);
	});

	it('fires onDidChangePackages with only the changed names', async () => {
		const before = [pkg('dplyr', '1.1.3', '1.1.4'), pkg('ggplot2', '3.4.0', '3.5.0')];
		const after = [pkg('dplyr', '1.1.4'), pkg('ggplot2', '3.4.0', '3.5.0')];
		const { instance } = makeInstance(store, before, after);
		await instance.refreshPackages();
		const fired: string[][] = [];
		store.add(instance.onDidChangePackages(names => fired.push(names)));

		await instance.updateOutdatedPackages(['dplyr', 'ggplot2']);

		expect(fired).toEqual([['dplyr']]);
	});
});
