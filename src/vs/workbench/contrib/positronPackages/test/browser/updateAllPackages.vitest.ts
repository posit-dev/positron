/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimePackageManager, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { PackageMetadataCache } from '../../browser/packageMetadataCache.js';
import { PositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

function pkg(name: string, version: string): ILanguageRuntimePackage {
	return { id: `${name}-${version}`, name, displayName: name, version };
}

/**
 * Builds an instance whose backend reports `before` on the first
 * `getPackages()` (used to seed the pre-update state) and `after` on every
 * subsequent call (the post-update refresh). `updateAllPackages` on the
 * backend is a no-op since the diff is driven entirely by the version lists.
 */
function makeInstance(store: DisposableStore, before: ILanguageRuntimePackage[], after: ILanguageRuntimePackage[]): PositronPackagesInstance {
	const lists = [before, after];
	let call = 0;
	const packageManager = stubInterface<ILanguageRuntimePackageManager>({
		getPackages: async () => lists[Math.min(call++, lists.length - 1)],
		updateAllPackages: async () => { },
		// Skip the optional Stage 2 metadata fetch; the diff only needs versions.
		getPackageMetadata: undefined,
	});
	const session = stubInterface<ILanguageRuntimeSession>({
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: 'test-runtime' }),
		getPackageManager: () => packageManager,
	});
	const storage = store.add(new InMemoryStorageService());
	const cache = new PackageMetadataCache(storage, new NullLogService(), new TestConfigurationService());
	return store.add(new PositronPackagesInstance(session, new NullLogService(), cache));
}

describe('PositronPackagesInstance.updateAllPackages', () => {

	ensureNoLeakedDisposables();

	const store = new DisposableStore();
	afterEach(() => store.clear());

	it('returns only packages whose version changed, sorted alphabetically', async () => {
		const before = [pkg('dplyr', '1.1.3'), pkg('ggplot2', '3.4.0'), pkg('tidyr', '1.3.0')];
		const after = [pkg('dplyr', '1.1.4'), pkg('ggplot2', '3.4.0'), pkg('tidyr', '1.3.1')];
		const instance = makeInstance(store, before, after);
		await instance.refreshPackages();

		expect(await instance.updateAllPackages()).toEqual(['dplyr', 'tidyr']);
	});

	it('returns an empty array when no version changed', async () => {
		const packages = [pkg('dplyr', '1.1.3'), pkg('ggplot2', '3.4.0')];
		const instance = makeInstance(store, packages, packages);
		await instance.refreshPackages();

		expect(await instance.updateAllPackages()).toEqual([]);
	});
});
