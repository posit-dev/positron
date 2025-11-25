/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AsyncIterableSource, DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ChatMessageRole, languageModelChatProviderExtensionPoint, LanguageModelsService, IChatMessage, IChatResponsePart } from '../../common/languageModels.js';
import { IExtensionService, nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { ExtensionsRegistry } from '../../../../services/extensions/common/extensionsRegistry.js';
import { DEFAULT_MODEL_PICKER_CATEGORY } from '../../common/modelPicker/modelPickerWidget.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { TestChatEntitlementService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { Event } from '../../../../../base/common/event.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';

suite('LanguageModels', function () {

	let languageModels: LanguageModelsService;

	const store = new DisposableStore();
	const activationEvents = new Set<string>();

	setup(function () {

		languageModels = new LanguageModelsService(
			// --- Start Positron ---
			new TestConfigurationService({
				'positron.assistant': {
					filterModels: []
				}
			}),
			// --- End Positron ---
			new class extends mock<IExtensionService>() {
				override activateByEvent(name: string) {
					activationEvents.add(name);
					return Promise.resolve();
				}
			},
			new NullLogService(),
			new TestStorageService(),
			new MockContextKeyService(),
			new TestChatEntitlementService()
		);

		const ext = ExtensionsRegistry.getExtensionPoints().find(e => e.name === languageModelChatProviderExtensionPoint.name)!;

		ext.acceptUsers([{
			description: { ...nullExtensionDescription },
			value: { vendor: 'test-vendor' },
			collector: null!
		}, {
			description: { ...nullExtensionDescription },
			value: { vendor: 'actual-vendor' },
			collector: null!
		}]);

		// --- Start Positron ---
		// Add dummy extension id
		// --- End Positron ---
		store.add(languageModels.registerLanguageModelProvider('test-vendor', new ExtensionIdentifier('test-ext'), {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				const modelMetadata = [
					{
						extension: nullExtensionDescription.identifier,
						name: 'Pretty Name',
						vendor: 'test-vendor',
						family: 'test-family',
						version: 'test-version',
						modelPickerCategory: undefined,
						id: 'test-id-1',
						maxInputTokens: 100,
						maxOutputTokens: 100,
					},
					{
						extension: nullExtensionDescription.identifier,
						name: 'Pretty Name',
						vendor: 'test-vendor',
						family: 'test2-family',
						version: 'test2-version',
						modelPickerCategory: undefined,
						id: 'test-id-12',
						maxInputTokens: 100,
						maxOutputTokens: 100,
					}
				];
				const modelMetadataAndIdentifier = modelMetadata.map(m => ({
					metadata: m,
					identifier: m.id,
				}));
				return modelMetadataAndIdentifier;
			},
			sendChatRequest: async () => {
				throw new Error();
			},
			provideTokenCount: async () => {
				throw new Error();
			}
		}));
	});

	teardown(function () {
		languageModels.dispose();
		activationEvents.clear();
		store.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('empty selector returns all', async function () {

		const result1 = await languageModels.selectLanguageModels({});
		assert.deepStrictEqual(result1.length, 2);
		assert.deepStrictEqual(result1[0], 'test-id-1');
		assert.deepStrictEqual(result1[1], 'test-id-12');
	});

	test('selector with id works properly', async function () {
		const result1 = await languageModels.selectLanguageModels({ id: 'test-id-1' });
		assert.deepStrictEqual(result1.length, 1);
		assert.deepStrictEqual(result1[0], 'test-id-1');
	});

	test('no warning that a matching model was not found #213716', async function () {
		const result1 = await languageModels.selectLanguageModels({ vendor: 'test-vendor' });
		assert.deepStrictEqual(result1.length, 2);

		const result2 = await languageModels.selectLanguageModels({ vendor: 'test-vendor', family: 'FAKE' });
		assert.deepStrictEqual(result2.length, 0);
	});

	// --- Start Positron ---
	test('model filtering is applied to copilot vendor', async function () {
		// Register the extension point for copilot first
		const ext = ExtensionsRegistry.getExtensionPoints().find(e => e.name === languageModelChatProviderExtensionPoint.name)!;
		ext.acceptUsers([{
			description: { ...nullExtensionDescription },
			value: { vendor: 'copilot' },
			collector: null!
		}]);

		// Register copilot provider with multiple models
		store.add(languageModels.registerLanguageModelProvider('copilot', new ExtensionIdentifier('copilot-ext'), {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				const modelMetadata = [
					{
						extension: nullExtensionDescription.identifier,
						name: 'GPT-4',
						vendor: 'copilot',
						family: 'gpt-4',
						version: '1.0',
						modelPickerCategory: undefined,
						id: 'gpt-4',
						maxInputTokens: 100,
						maxOutputTokens: 100,
					},
					{
						extension: nullExtensionDescription.identifier,
						name: 'GPT-3.5',
						vendor: 'copilot',
						family: 'gpt-3.5',
						version: '1.0',
						modelPickerCategory: undefined,
						id: 'gpt-3.5-turbo',
						maxInputTokens: 100,
						maxOutputTokens: 100,
					}
				];
				return modelMetadata.map(m => ({
					metadata: m,
					identifier: m.id,
				}));
			},
			sendChatRequest: async () => {
				throw new Error();
			},
			provideTokenCount: async () => {
				throw new Error();
			}
		}));

		// First, verify without filtering - should return both models
		const unfilteredResult = await languageModels.selectLanguageModels({ vendor: 'copilot' });
		assert.strictEqual(unfilteredResult.length, 2);

		// Now, set up filtering config to only allow gpt-4
		const configService = (languageModels as any)._configurationService;
		const originalGetValue = configService.getValue.bind(configService);
		configService.getValue = function (key: string) {
			if (key === 'positron.assistant.filterModels') {
				return ['gpt-4']; // Only allow gpt-4 models
			}
			return originalGetValue(key);
		};

		try {
			// Get all copilot models - should be filtered to only gpt-4
			const result = await languageModels.selectLanguageModels({ vendor: 'copilot' });
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], 'gpt-4');
		} finally {
			// Restore original configuration
			configService.getValue = originalGetValue;
		}
	});

	// This filtering is applied in the Positron Assistant extension for non-copilot providers
	test('model filtering is NOT applied to non-copilot vendors', async function () {
		// Register the extension point for a non-copilot vendor
		const ext = ExtensionsRegistry.getExtensionPoints().find(e => e.name === languageModelChatProviderExtensionPoint.name)!;
		ext.acceptUsers([{
			description: { ...nullExtensionDescription },
			value: { vendor: 'other-vendor' },
			collector: null!
		}]);

		// Register other-vendor provider with multiple models
		store.add(languageModels.registerLanguageModelProvider('other-vendor', new ExtensionIdentifier('other-ext'), {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				const modelMetadata = [
					{
						extension: nullExtensionDescription.identifier,
						name: 'Model 1',
						vendor: 'other-vendor',
						family: 'model-1',
						version: '1.0',
						modelPickerCategory: undefined,
						id: 'gpt-4',
						maxInputTokens: 100,
						maxOutputTokens: 100,
					},
					{
						extension: nullExtensionDescription.identifier,
						name: 'Model 2',
						vendor: 'other-vendor',
						family: 'model-2',
						version: '1.0',
						modelPickerCategory: undefined,
						id: 'gpt-5',
						maxInputTokens: 100,
						maxOutputTokens: 100,
					}
				];
				return modelMetadata.map(m => ({
					metadata: m,
					identifier: m.id,
				}));
			},
			sendChatRequest: async () => {
				throw new Error();
			},
			provideTokenCount: async () => {
				throw new Error();
			}
		}));

		// Mock the configuration to return filter settings that would filter out models
		const configService = (languageModels as any)._configurationService;
		const originalGetValue = configService.getValue.bind(configService);

		configService.getValue = function (key: string) {
			if (key === 'positron.assistant.filterModels') {
				return ['gpt-4']; // This should match, but since vendor is not copilot, filtering should not apply
			}
			return originalGetValue(key);
		};

		try {
			// Get all other-vendor models - should NOT be filtered even with filter config present
			const result = await languageModels.selectLanguageModels({ vendor: 'other-vendor' });

			// Should return both models since filtering is only applied to copilot
			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result.sort(), ['gpt-4', 'gpt-5']);
		} finally {
			// Restore original configuration
			configService.getValue = originalGetValue;
		}
	});
	// --- End Positron ---

	test('sendChatRequest returns a response-stream', async function () {

		// --- Start Positron ---
		// Add extension identifier to parameters
		// --- End Positron ---
		store.add(languageModels.registerLanguageModelProvider('actual-vendor', new ExtensionIdentifier('actual-ext'), {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				const modelMetadata = [
					{
						extension: nullExtensionDescription.identifier,
						name: 'Pretty Name',
						vendor: 'actual-vendor',
						family: 'actual-family',
						version: 'actual-version',
						id: 'actual-lm',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
					}
				];
				const modelMetadataAndIdentifier = modelMetadata.map(m => ({
					metadata: m,
					identifier: m.id,
				}));
				return modelMetadataAndIdentifier;
			},
			sendChatRequest: async (modelId: string, messages: IChatMessage[], _from: ExtensionIdentifier, _options: { [name: string]: any }, token: CancellationToken) => {
				// const message = messages.at(-1);

				const defer = new DeferredPromise();
				const stream = new AsyncIterableSource<IChatResponsePart>();

				(async () => {
					while (!token.isCancellationRequested) {
						stream.emitOne({ type: 'text', value: Date.now().toString() });
						await timeout(10);
					}
					defer.complete(undefined);
				})();

				return {
					stream: stream.asyncIterable,
					result: defer.p
				};
			},
			provideTokenCount: async () => {
				throw new Error();
			}
		}));

		// Register the extension point for the actual vendor
		const ext = ExtensionsRegistry.getExtensionPoints().find(e => e.name === languageModelChatProviderExtensionPoint.name)!;
		ext.acceptUsers([{
			description: { ...nullExtensionDescription },
			value: { vendor: 'actual-vendor' },
			collector: null!
		}]);

		const models = await languageModels.selectLanguageModels({ id: 'actual-lm' });
		assert.ok(models.length === 1);

		const first = models[0];

		const cts = new CancellationTokenSource();

		const request = await languageModels.sendChatRequest(first, nullExtensionDescription.identifier, [{ role: ChatMessageRole.User, content: [{ type: 'text', value: 'hello' }] }], {}, cts.token);

		assert.ok(request);

		cts.dispose(true);

		await request.result;
	});

	test('when clause defaults to true when omitted', async function () {
		const vendors = languageModels.getVendors();
		// Both test-vendor and actual-vendor have no when clause, so they should be visible
		assert.ok(vendors.length >= 2);
		assert.ok(vendors.some(v => v.vendor === 'test-vendor'));
		assert.ok(vendors.some(v => v.vendor === 'actual-vendor'));
	});
});

suite('LanguageModels - When Clause', function () {

	class TestContextKeyService extends MockContextKeyService {
		override contextMatchesRules(rules: ContextKeyExpression): boolean {
			if (!rules) {
				return true;
			}
			// Simple evaluation based on stored keys
			const keys = rules.keys();
			for (const key of keys) {
				const contextKey = this.getContextKeyValue(key);
				// If the key exists and is truthy, the rule matches
				if (contextKey) {
					return true;
				}
			}
			return false;
		}
	}

	let languageModelsWithWhen: LanguageModelsService;
	let contextKeyService: TestContextKeyService;

	setup(function () {
		contextKeyService = new TestContextKeyService();
		contextKeyService.createKey('testKey', true);

		languageModelsWithWhen = new LanguageModelsService(
			new TestConfigurationService(),
			new class extends mock<IExtensionService>() {
				override activateByEvent(name: string) {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			new TestStorageService(),
			contextKeyService,
			new TestChatEntitlementService()
		);

		const ext = ExtensionsRegistry.getExtensionPoints().find(e => e.name === languageModelChatProviderExtensionPoint.name)!;

		ext.acceptUsers([{
			description: { ...nullExtensionDescription },
			value: { vendor: 'visible-vendor', displayName: 'Visible Vendor' },
			collector: null!
		}, {
			description: { ...nullExtensionDescription },
			value: { vendor: 'conditional-vendor', displayName: 'Conditional Vendor', when: 'testKey' },
			collector: null!
		}, {
			description: { ...nullExtensionDescription },
			value: { vendor: 'hidden-vendor', displayName: 'Hidden Vendor', when: 'falseKey' },
			collector: null!
		}]);
	});

	teardown(function () {
		languageModelsWithWhen.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('when clause filters vendors correctly', async function () {
		const vendors = languageModelsWithWhen.getVendors();
		assert.strictEqual(vendors.length, 2);
		assert.ok(vendors.some(v => v.vendor === 'visible-vendor'));
		assert.ok(vendors.some(v => v.vendor === 'conditional-vendor'));
		assert.ok(!vendors.some(v => v.vendor === 'hidden-vendor'));
	});

	test('when clause evaluates to true when context key is true', async function () {
		const vendors = languageModelsWithWhen.getVendors();
		assert.ok(vendors.some(v => v.vendor === 'conditional-vendor'), 'conditional-vendor should be visible when testKey is true');
	});

	test('when clause evaluates to false when context key is false', async function () {
		const vendors = languageModelsWithWhen.getVendors();
		assert.ok(!vendors.some(v => v.vendor === 'hidden-vendor'), 'hidden-vendor should be hidden when falseKey is false');
	});
});
