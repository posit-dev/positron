/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { raceTimeout } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ILogService, NullLogger } from '../../../../../platform/log/common/log.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { LanguageRuntimeService } from '../../common/languageRuntime.js';
import { createInterpreterVariant, INTERPRETER_DEFINITIONS_KEY } from '../../common/interpreterDefinitions.js';
import { getRuntimeDisplayPath, ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior, LanguageStartupBehavior } from '../../common/languageRuntimeService.js';

const TEST_USER_HOME = URI.file('/home/testuser');
const pathServiceStub = stubInterface<IPathService>({
	// Handle both overloads: preferLocal:true returns URI synchronously;
	// preferLocal:false (or absent) returns Promise<URI>.
	userHome: vi.fn().mockImplementation((options?: { preferLocal?: boolean }) => {
		if (options?.preferLocal === true) {
			return TEST_USER_HOME;
		}
		return Promise.resolve(TEST_USER_HOME);
	}),
});

/**
 * Shared metadata fields for test stubs. Both tests use the same base shape;
 * only runtimeId and languageId differ.
 */
function makeTestMetadata(overrides: Partial<ILanguageRuntimeMetadata>): ILanguageRuntimeMetadata {
	return stubInterface<ILanguageRuntimeMetadata>({
		runtimeId: 'testRuntimeId',
		languageId: 'testLanguageId',
		runtimePath: '',
		runtimeDisplayPath: undefined,
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

describe('getRuntimeDisplayPath', () => {
	it('returns runtimeDisplayPath when set', () => {
		expect(getRuntimeDisplayPath({ runtimePath: '/abs/path/R', runtimeDisplayPath: '~/bin/R' })).toBe('~/bin/R');
	});

	it('falls back to runtimePath when runtimeDisplayPath is undefined', () => {
		expect(getRuntimeDisplayPath({ runtimePath: '/abs/path/R', runtimeDisplayPath: undefined })).toBe('/abs/path/R');
	});
});

describe('Positron - LanguageRuntimeService', () => {
	describe('default configuration', () => {
		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(ILogService, new NullLogger())
			.stub(IConfigurationService, new TestConfigurationService())
			.stub(IPathService, pathServiceStub)
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

			// Check that the runtime was registered (with workbench-computed display path).
			expect(languageRuntimeService.registeredRuntimes).toMatchObject([
				{ runtimeId: metadata.runtimeId, runtimePath: metadata.runtimePath },
			]);

			// Unregister the runtime.
			languageRuntimeService.unregisterRuntime(metadata.runtimeId);

			// Check that the runtime was unregistered.
			expect(languageRuntimeService.registeredRuntimes.length).toBe(0);

			// No-op since we already unregistered the runtime.
			runtimeDisposable.dispose();
		});

		it('enriches runtimeDisplayPath via tildify on registration', async () => {
			const languageRuntimeService = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));

			// The constructor starts a userHome() promise; let the microtask run
			// before calling registerRuntime so _cachedUserHome is populated.
			await Promise.resolve();

			// A path under the test user home should be tildified.
			const underHome = makeTestMetadata({ runtimeId: 'tilde-1', runtimePath: '/home/testuser/bin/R' });
			languageRuntimeService.registerRuntime(underHome);
			expect(languageRuntimeService.registeredRuntimes[0].runtimeDisplayPath).toBe('~/bin/R');

			// A system path should be left unchanged.
			const system = makeTestMetadata({ runtimeId: 'tilde-2', runtimePath: '/usr/bin/R' });
			languageRuntimeService.registerRuntime(system);
			expect(languageRuntimeService.registeredRuntimes[1].runtimeDisplayPath).toBe('/usr/bin/R');
		});
	});

	describe('interpreter definitions', () => {
		const configurationService = new TestConfigurationService();
		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(ILogService, new NullLogger())
			.stub(IConfigurationService, configurationService)
			.stub(IPathService, pathServiceStub)
			.build();

		const r = makeTestMetadata({ runtimeId: 'r-base', languageId: 'r', runtimePath: '/opt/R/4.4.3/bin/R', runtimeName: 'R 4.4.3', cacheable: true });
		const definition = { language: 'r', path: '/opt/R/4.4.3/bin/R', label: 'R 4.4.3 (XX libs)', env: { R_LIBS_SITE: '/xx' } };

		beforeEach(async () => {
			await configurationService.setUserConfiguration(INTERPRETER_DEFINITIONS_KEY, [definition]);
		});

		it('registers a variant next to the base runtime, and unregisters it with the base', () => {
			const service = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));

			service.registerRuntime(r);

			expect(service.registeredRuntimes.map(m => [m.runtimeName, m.interpreterDefinition, m.cacheable])).toEqual([
				['R 4.4.3', undefined, true],
				['R 4.4.3 (XX libs)', 'R 4.4.3 (XX libs)', false],
			]);

			service.unregisterRuntime('r-base');
			expect(service.registeredRuntimes).toEqual([]);
		});

		it('does not derive a variant from a variant', () => {
			const service = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));

			service.registerRuntime(createInterpreterVariant(r, definition));

			expect(service.registeredRuntimes.length).toBe(1);
		});

		it('re-derives variants when the setting changes', async () => {
			const service = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));
			service.registerRuntime(r);

			await configurationService.setUserConfiguration(INTERPRETER_DEFINITIONS_KEY, [{ ...definition, label: 'Renamed' }]);
			configurationService.onDidChangeConfigurationEmitter.fire(
				stubInterface<IConfigurationChangeEvent>({
					affectsConfiguration: (key: string) => key === INTERPRETER_DEFINITIONS_KEY,
				})
			);

			expect(service.registeredRuntimes.map(m => m.runtimeName)).toEqual(['R 4.4.3', 'Renamed']);
		});

		it('removes a variant registered before its base when its definition is deleted', async () => {
			const service = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));
			// Restore and validation register a stored variant directly, before its base.
			service.registerRuntime(createInterpreterVariant(r, definition));

			await configurationService.setUserConfiguration(INTERPRETER_DEFINITIONS_KEY, []);
			configurationService.onDidChangeConfigurationEmitter.fire(
				stubInterface<IConfigurationChangeEvent>({
					affectsConfiguration: (key: string) => key === INTERPRETER_DEFINITIONS_KEY,
				})
			);

			expect(service.registeredRuntimes).toEqual([]);
		});

		it('keeps an unchanged variant registered when the setting changes', async () => {
			const service = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));
			service.registerRuntime(r);
			const unregistered: string[] = [];
			ctx.disposables.add(service.onDidUnregisterRuntime(id => unregistered.push(id)));

			await configurationService.setUserConfiguration(INTERPRETER_DEFINITIONS_KEY, [definition, { ...definition, label: 'Second' }]);
			configurationService.onDidChangeConfigurationEmitter.fire(
				stubInterface<IConfigurationChangeEvent>({
					affectsConfiguration: (key: string) => key === INTERPRETER_DEFINITIONS_KEY,
				})
			);

			expect([unregistered, service.registeredRuntimes.map(m => m.runtimeName)]).toEqual([[], ['R 4.4.3', 'R 4.4.3 (XX libs)', 'Second']]);
		});
	});

	describe('onDidUnregisterRuntime', () => {
		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(ILogService, new NullLogger())
			.stub(IConfigurationService, new TestConfigurationService())
			.stub(IPathService, pathServiceStub)
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
			.stub(IPathService, pathServiceStub)
			.build();

		it('cannot register a runtime when the language is disabled in configuration', () => {
			const languageRuntimeService = ctx.disposables.add(ctx.instantiationService.createInstance(LanguageRuntimeService));

			// Create mock metadata for a runtime with the disabled language.
			const metadata = makeTestMetadata({
				runtimeId: 'disabledRuntimeId',
				languageId: 'disabledLanguage',
			});

			// Attempt to register the runtime - this should throw an error.
			expect(() => languageRuntimeService.registerRuntime(metadata)).toThrow();

			// Verify that no runtimes were registered.
			expect(languageRuntimeService.registeredRuntimes.length).toBe(0);
		});
	});
});
