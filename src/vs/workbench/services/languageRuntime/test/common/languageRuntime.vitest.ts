/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { raceTimeout } from '../../../../../base/common/async.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ILogService, NullLogger } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { LanguageRuntimeService } from '../../common/languageRuntime.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior, LanguageStartupBehavior } from '../../common/languageRuntimeService.js';

/**
 * Shared metadata fields for test stubs. Both tests use the same base shape;
 * only runtimeId and languageId differ.
 */
function makeTestMetadata(overrides: Partial<ILanguageRuntimeMetadata>): ILanguageRuntimeMetadata {
	return stubInterface<ILanguageRuntimeMetadata>({
		runtimeId: 'testRuntimeId',
		languageId: 'testLanguageId',
		runtimePath: '',
		languageName: 'testLanguage',
		languageVersion: '1.0.0',
		base64EncodedIconSvg: undefined,
		runtimeName: 'testRuntime',
		runtimeShortName: 'test',
		runtimeVersion: '1.0.0',
		runtimeSource: 'test',
		startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
		sessionLocation: LanguageRuntimeSessionLocation.Workspace,
		extensionId: new ExtensionIdentifier('test'),
		extraRuntimeData: {},
		...overrides,
	});
}

describe('Positron - LanguageRuntimeService', () => {
	describe('default configuration', () => {
		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(ILogService, new NullLogger())
			.stub(IConfigurationService, new TestConfigurationService())
			.build();

		it('register and unregister a runtime', async () => {
			const languageRuntimeService = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));

			// No runtimes registered initially.
			expect(languageRuntimeService.registeredRuntimes.length).toBe(0);

			// Mock runtime metadata.
			const metadata = makeTestMetadata({
				runtimeId: 'testRuntimeId',
				languageId: 'testLanguageId',
			});

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
			expect(timedOut, 'Awaiting onDidRegisterRuntime event timed out').toBe(false);

			// Check that the runtime was registered.
			expect(languageRuntimeService.registeredRuntimes).toEqual([metadata]);

			// Unregister the runtime.
			languageRuntimeService.unregisterRuntime(metadata.runtimeId);

			// Check that the runtime was unregistered.
			expect(languageRuntimeService.registeredRuntimes.length).toBe(0);

			// No-op since we already unregistered the runtime.
			runtimeDisposable.dispose();
		});
	});

	describe('onDidUnregisterRuntime', () => {
		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(ILogService, new NullLogger())
			.stub(IConfigurationService, new TestConfigurationService())
			.build();

		it('fires with the runtimeId and removes the runtime when unregistered', () => {
			const languageRuntimeService = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));
			languageRuntimeService.registerRuntime(makeTestMetadata({ runtimeId: 'py-1' }));

			const unregistered: string[] = [];
			ctx.disposables.add(languageRuntimeService.onDidUnregisterRuntime(id => unregistered.push(id)));

			languageRuntimeService.unregisterRuntime('py-1');

			expect(unregistered).toEqual(['py-1']);
			expect(languageRuntimeService.registeredRuntimes.length).toBe(0);
		});

		it('does not fire when unregistering an id that was never registered', () => {
			const languageRuntimeService = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));

			const unregistered: string[] = [];
			ctx.disposables.add(languageRuntimeService.onDidUnregisterRuntime(id => unregistered.push(id)));

			languageRuntimeService.unregisterRuntime('never-registered');

			expect(unregistered).toEqual([]);
		});

		it('fires when the registration disposable is disposed', () => {
			const languageRuntimeService = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));
			const registration = languageRuntimeService.registerRuntime(makeTestMetadata({ runtimeId: 'py-1' }));

			const unregistered: string[] = [];
			ctx.disposables.add(languageRuntimeService.onDidUnregisterRuntime(id => unregistered.push(id)));

			// Disposing the registration removes the runtime through the same path
			// as unregisterRuntime, so the event fires exactly like an explicit call.
			registration.dispose();

			expect(unregistered).toEqual(['py-1']);
			expect(languageRuntimeService.registeredRuntimes.length).toBe(0);
		});
	});

	describe('disabled language', () => {
		const configService = new TestConfigurationService();
		configService.setUserConfiguration('interpreters', {
			startupBehavior: LanguageStartupBehavior.Disabled,
		});

		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(ILogService, new NullLogger())
			.stub(IConfigurationService, configService)
			.build();

		it('cannot register a runtime when the language is disabled in configuration', async () => {
			const languageRuntimeService = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));

			// Create mock metadata for a runtime with the disabled language.
			const metadata = makeTestMetadata({
				runtimeId: 'disabledRuntimeId',
				languageId: 'disabledLanguage',
			});

			// Attempt to register the runtime - this should throw an error.
			expect(() => {
				languageRuntimeService.registerRuntime(metadata);
			}).toThrow();

			// Verify that no runtimes were registered.
			expect(languageRuntimeService.registeredRuntimes.length).toBe(0);
		});
	});
});
