/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { raceTimeout } from 'vs/base/common/async';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogger } from 'vs/platform/log/common/log';
import { LanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

suite('LanguageRuntimeService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;

	setup(async () => {
		instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(ILogService, new NullLogger());
	});

	test('register and unregister a runtime', async () => {
		const languageRuntimeService = disposables.add(instantiationService.createInstance(LanguageRuntimeService));

		// No runtimes registered initially.
		assert.strictEqual(languageRuntimeService.registeredRuntimes.length, 0);

		// Mock runtime metadata.
		const metadata = <ILanguageRuntimeMetadata>{
			runtimeId: 'testRuntimeId',
		};

		// Promise that resolves when the onDidRegisterRuntime event is fired with the expected runtimeId.
		const didRegisterRuntime = new Promise<void>((resolve) => {
			const disposable = languageRuntimeService.onDidRegisterRuntime((e) => {
				if (e.runtimeId === metadata.runtimeId) {
					disposable.dispose();
					resolve();
				}
			});
		});

		// Register the runtime.
		const runtimeDisposable = languageRuntimeService.registerRuntime(metadata);

		// Check that the onDidRegisterRuntime event was fired.
		let timedOut = false;
		await raceTimeout(didRegisterRuntime, 10, () => timedOut = true);
		assert(!timedOut, 'Awaiting onDidRegisterRuntime event timed out');

		// Check that the runtime was registered.
		assert.deepStrictEqual(languageRuntimeService.registeredRuntimes, [metadata]);

		// Unregister the runtime.
		languageRuntimeService.unregisterRuntime(metadata.runtimeId);

		// Check that the runtime was unregistered.
		assert.strictEqual(languageRuntimeService.registeredRuntimes.length, 0);

		// No-op since we already unregistered the runtime.
		runtimeDisposable.dispose();
	});
});
