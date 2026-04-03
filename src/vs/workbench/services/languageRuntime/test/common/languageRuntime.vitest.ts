/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../../base/common/async.js';
import { ensureNoLeakedDisposables } from '../../../../../base/test/common/vitestSetup.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogger } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { LanguageRuntimeService } from '../../common/languageRuntime.js';
import { ILanguageRuntimeMetadata, LanguageStartupBehavior } from '../../common/languageRuntimeService.js';

describe('Positron - LanguageRuntimeService', () => {
	const disposables = ensureNoLeakedDisposables();
	let instantiationService: TestInstantiationService;

	beforeEach(async () => {
		instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(ILogService, new NullLogger());
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
	});

	it('register and unregister a runtime', async () => {
		const languageRuntimeService = disposables.add(instantiationService.createInstance(LanguageRuntimeService));

		// No runtimes registered initially.
		expect(languageRuntimeService.registeredRuntimes.length).toBe(0);

		// Mock runtime metadata.
		const metadata = <ILanguageRuntimeMetadata>{
			runtimeId: 'testRuntimeId',
			languageId: 'testLanguageId',
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
		expect(timedOut).toBe(false);

		// Check that the runtime was registered.
		expect(languageRuntimeService.registeredRuntimes).toEqual([metadata]);

		// Unregister the runtime.
		languageRuntimeService.unregisterRuntime(metadata.runtimeId);

		// Check that the runtime was unregistered.
		expect(languageRuntimeService.registeredRuntimes.length).toBe(0);

		// No-op since we already unregistered the runtime.
		runtimeDisposable.dispose();
	});

	it('ensure a runtime that is disabled in configuration cannot be registered', async () => {
		// Mock configuration service that returns 'Disabled' for a specific language ID
		const disabledLanguageId = 'disabledLanguage';

		// Create a TestConfigurationService and configure it
		const configService = new TestConfigurationService();

		// Set up the configuration to return 'Disabled'
		configService.setUserConfiguration('interpreters', {
			startupBehavior: LanguageStartupBehavior.Disabled
		});

		// Register it with the instantiation service
		instantiationService.stub(IConfigurationService, configService);

		const languageRuntimeService = disposables.add(instantiationService.createInstance(LanguageRuntimeService));

		// Create mock metadata for a runtime with the disabled language
		const metadata = <ILanguageRuntimeMetadata>{
			runtimeId: 'disabledRuntimeId',
			languageId: disabledLanguageId
		};

		// Attempt to register the runtime - this should throw an error
		expect(() => {
			languageRuntimeService.registerRuntime(metadata);
		}).toThrow();

		// Verify that no runtimes were registered
		expect(languageRuntimeService.registeredRuntimes.length).toBe(0);
	});
});
