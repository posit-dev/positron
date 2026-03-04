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
import { ChatMessageRole, IPositronChatProvider, languageModelChatProviderExtensionPoint, LanguageModelsService, IChatMessage, IChatResponsePart } from '../../common/languageModels.js';
import { IExtensionService, nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { ExtensionsRegistry } from '../../../../services/extensions/common/extensionsRegistry.js';
import { DEFAULT_MODEL_PICKER_CATEGORY } from '../../common/widget/input/modelPickerWidget.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { TestChatEntitlementService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { Event } from '../../../../../base/common/event.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
// --- Start Positron ---
import { TestPositronAssistantConfigurationService } from '../../../../test/common/positronWorkbenchTestServices.js';
// --- End Positron ---

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
			new TestPositronAssistantConfigurationService(),
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
			// --- Start Positron ---
			new TestPositronAssistantConfigurationService(),
			// --- End Positron ---
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

// --- Start Positron ---
suite('LanguageModels - getCurrentProvider', function () {

	const STORAGE_KEY = 'chat.currentLanguageProvider';

	const store = new DisposableStore();

	function createMockProvider(vendor: string) {
		return {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => [{
				metadata: {
					extension: nullExtensionDescription.identifier,
					name: `${vendor} Model`,
					vendor,
					family: `${vendor}-family`,
					version: '1.0',
					modelPickerCategory: undefined,
					id: `${vendor}-model-1`,
					maxInputTokens: 100,
					maxOutputTokens: 100,
				},
				identifier: `${vendor}-model-1`,
			}],
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); },
		};
	}

	function registerVendors(service: LanguageModelsService, vendors: string[]) {
		const ext = ExtensionsRegistry.getExtensionPoints().find(e => e.name === languageModelChatProviderExtensionPoint.name)!;
		ext.acceptUsers(vendors.map(vendor => ({
			description: { ...nullExtensionDescription },
			value: { vendor },
			collector: null!,
		})));

		for (const vendor of vendors) {
			store.add(service.registerLanguageModelProvider(vendor, new ExtensionIdentifier(`${vendor}-ext`), createMockProvider(vendor)));
		}
	}

	teardown(function () {
		store.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('restores current provider from storage on init with multiple providers registered', function () {
		const storedProvider: IPositronChatProvider = { id: 'vendor-b', displayName: 'Vendor B' };
		const storageService = store.add(new TestStorageService());
		storageService.store(STORAGE_KEY, storedProvider, StorageScope.APPLICATION, StorageTarget.USER);

		const service = new LanguageModelsService(
			new TestConfigurationService(),
			new TestPositronAssistantConfigurationService(),
			new class extends mock<IExtensionService>() {
				override activateByEvent() { return Promise.resolve(); }
			},
			new NullLogService(),
			storageService,
			new MockContextKeyService(),
			new TestChatEntitlementService()
		);

		registerVendors(service, ['vendor-a', 'vendor-b', 'vendor-c']);

		// The restored provider should remain vendor-b, not be overwritten by the first registered provider
		assert.deepStrictEqual(service.currentProvider, storedProvider);

		store.add(service);
	});

	test('does not restore provider from storage when provider is disabled', function () {
		const storedProvider: IPositronChatProvider = { id: 'disabled-vendor', displayName: 'Disabled Vendor' };
		const storageService = store.add(new TestStorageService());
		storageService.store(STORAGE_KEY, storedProvider, StorageScope.APPLICATION, StorageTarget.USER);

		const configService = new class extends TestPositronAssistantConfigurationService {
			override isProviderEnabled(): boolean {
				return false;
			}
		};

		const service = new LanguageModelsService(
			new TestConfigurationService(),
			configService,
			new class extends mock<IExtensionService>() {
				override activateByEvent() { return Promise.resolve(); }
			},
			new NullLogService(),
			storageService,
			new MockContextKeyService(),
			new TestChatEntitlementService()
		);

		registerVendors(service, ['vendor-a', 'disabled-vendor']);

		// Should not restore disabled provider, and should not auto-select since all are disabled
		assert.strictEqual(service.currentProvider, undefined);

		store.add(service);
	});

	test('currentProvider is undefined when no stored provider exists and no providers registered', function () {
		const service = new LanguageModelsService(
			new TestConfigurationService(),
			new TestPositronAssistantConfigurationService(),
			new class extends mock<IExtensionService>() {
				override activateByEvent() { return Promise.resolve(); }
			},
			new NullLogService(),
			store.add(new TestStorageService()),
			new MockContextKeyService(),
			new TestChatEntitlementService()
		);

		assert.strictEqual(service.currentProvider, undefined);

		store.add(service);
	});

	test('syncs provider with stored model when model vendor differs from stored provider', async function () {
		const storageService = store.add(new TestStorageService());

		// Store provider as vendor-a, but the selected model is from vendor-b
		const storedProvider: IPositronChatProvider = { id: 'vendor-a', displayName: 'Vendor A' };
		storageService.store(STORAGE_KEY, storedProvider, StorageScope.APPLICATION, StorageTarget.USER);
		storageService.store('chat.currentLanguageModel.panel', 'vendor-b-model-1', StorageScope.APPLICATION, StorageTarget.USER);

		const service = new LanguageModelsService(
			new TestConfigurationService(),
			new TestPositronAssistantConfigurationService(),
			new class extends mock<IExtensionService>() {
				override activateByEvent() { return Promise.resolve(); }
			},
			new NullLogService(),
			storageService,
			new MockContextKeyService(),
			new TestChatEntitlementService()
		);

		// Initially, the provider is restored from storage as vendor-a
		assert.deepStrictEqual(service.currentProvider, storedProvider);

		registerVendors(service, ['vendor-a', 'vendor-b']);

		// Wait for async model resolution to complete and trigger the sync
		await new Promise<void>(resolve => {
			const listener = store.add(service.onDidChangeCurrentProvider(() => {
				listener.dispose();
				resolve();
			}));
		});

		// After models resolve, the provider should be synced to vendor-b (matching the stored model)
		assert.strictEqual(service.currentProvider?.id, 'vendor-b');

		store.add(service);
	});

});
// --- End Positron ---
