/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ChatAgentService, IChatAgentData, IChatAgentImplementation } from '../../../common/participants/chatAgents.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
// --- Start Positron ---
import { ILanguageModelChatProvider, ILanguageModelsChangeEvent, ILanguageModelsService, ILanguageModelProviderDescriptor, ILanguageModelsGroup, IModelsControlManifest } from '../../../common/languageModels.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { TestPositronAssistantConfigurationService } from '../../../../../test/common/positronWorkbenchTestServices.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { ChatContextKeys } from '../../../common/actions/chatContextKeys.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind } from '../../../common/constants.js';
import { ConfigurationTarget } from '../../../../../../platform/configuration/common/configuration.js';
// --- End Positron ---

const testAgentId = 'testAgent';
const testAgentData: IChatAgentData = {
	id: testAgentId,
	name: 'Test Agent',
	extensionDisplayName: '',
	extensionId: new ExtensionIdentifier(''),
	extensionVersion: undefined,
	extensionPublisherId: '',
	locations: [],
	modes: [],
	metadata: {},
	slashCommands: [],
	disambiguation: [],
};

class TestingContextKeyService extends MockContextKeyService {
	private _contextMatchesRulesReturnsTrue = false;
	public contextMatchesRulesReturnsTrue() {
		this._contextMatchesRulesReturnsTrue = true;
	}

	public override contextMatchesRules(rules: ContextKeyExpression): boolean {
		return this._contextMatchesRulesReturnsTrue;
	}
}

// --- Start Positron ---
class TestLanguageModelsService implements ILanguageModelsService {
	readonly _serviceBrand: undefined;
	onDidChangeProviders: Event<ILanguageModelsChangeEvent> = new Emitter<ILanguageModelsChangeEvent>().event;
	onDidChangeLanguageModels = new Emitter<any>().event;
	onDidChangeLanguageModelVendors = new Emitter<readonly string[]>().event;
	onDidChangeCurrentProvider = new Emitter<string | undefined>().event;
	onDidChangeModelsControlManifest = new Emitter<IModelsControlManifest>().event;
	restrictedChatParticipants = observableValue<{ [name: string]: string[] }>('restrictedChatParticipants', {});
	get currentProvider() { return undefined; }
	set currentProvider(_provider: any) { }
	getLanguageModelProviders() { return []; }
	getExtensionIdentifierForProvider(_vendor: string) { return undefined; }
	getStoredProviderVendor() { return undefined; }
	invalidateProvider(_vendorId: string): void { }
	updateModelPickerPreference(_modelIdentifier: string, _showInModelPicker: boolean): void { }
	getVendors(): ILanguageModelProviderDescriptor[] { return []; }
	getLanguageModelIds() { return []; }
	lookupLanguageModel() { return undefined; }
	lookupLanguageModelByQualifiedName() { return undefined; }
	getLanguageModelGroups(_vendor: string): ILanguageModelsGroup[] { return []; }
	async selectLanguageModels() { return []; }
	registerLanguageModelProvider(_vendor: string, _provider: ILanguageModelChatProvider): IDisposable {
		return Disposable.None;
	}
	deltaLanguageModelChatProviderDescriptors(): void { }
	async sendChatRequest(): Promise<any> { throw new Error('Not implemented'); }
	async computeTokenLength() { return 0; }
	async addLanguageModelsProviderGroup(): Promise<void> { }
	async removeLanguageModelsProviderGroup(): Promise<void> { }
	async configureLanguageModelsProviderGroup(): Promise<void> { }
	async migrateLanguageModelsProviderGroup(): Promise<void> { }
	getRecentlyUsedModelIds(): string[] { return []; }
	addToRecentlyUsedList(_modelIdentifier: string): void { }
	clearRecentlyUsedList(): void { }
	getModelsControlManifest(): IModelsControlManifest { return { free: {}, paid: {} }; }
	getModelConfiguration(_modelId: string) { return undefined; }
	async setModelConfiguration(): Promise<void> { }
	getModelConfigurationActions(_modelId: string) { return []; }
	async configureModel(): Promise<void> { }
}
// --- End Positron ---

suite('ChatAgents', function () {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let chatAgentService: ChatAgentService;
	let contextKeyService: TestingContextKeyService;
	// --- Start Positron ---
	let configurationService: TestConfigurationService;
	// --- End Positron ---
	setup(() => {
		contextKeyService = new TestingContextKeyService();
		// --- Start Positron ---
		// Add configuration service to chat
		configurationService = new TestConfigurationService();
		const logService = new NullLogService();
		const languageModelsService = new TestLanguageModelsService();
		const positronAssistantConfigurationService = new TestPositronAssistantConfigurationService();
		configurationService.setUserConfiguration('positron.assistant.enable', true);
		chatAgentService = store.add(new ChatAgentService(contextKeyService, configurationService, logService, languageModelsService, positronAssistantConfigurationService));
		// --- End Positron ---
	});

	test('registerAgent', async () => {
		assert.strictEqual(chatAgentService.getAgents().length, 0);


		const agentRegistration = chatAgentService.registerAgent(testAgentId, testAgentData);

		assert.strictEqual(chatAgentService.getAgents().length, 1);
		assert.strictEqual(chatAgentService.getAgents()[0].id, testAgentId);

		assert.throws(() => chatAgentService.registerAgent(testAgentId, testAgentData));

		agentRegistration.dispose();
		assert.strictEqual(chatAgentService.getAgents().length, 0);
	});

	test('agent when clause', async () => {
		assert.strictEqual(chatAgentService.getAgents().length, 0);

		store.add(chatAgentService.registerAgent(testAgentId, {
			...testAgentData,
			when: 'myKey'
		}));
		assert.strictEqual(chatAgentService.getAgents().length, 0);

		contextKeyService.contextMatchesRulesReturnsTrue();
		assert.strictEqual(chatAgentService.getAgents().length, 1);
	});

	suite('registerAgentImplementation', function () {
		const agentImpl: IChatAgentImplementation = {
			invoke: async () => { return {}; },
			provideFollowups: async () => { return []; },
		};

		test('should register an agent implementation', () => {
			store.add(chatAgentService.registerAgent(testAgentId, testAgentData));
			store.add(chatAgentService.registerAgentImplementation(testAgentId, agentImpl));

			const agents = chatAgentService.getActivatedAgents();
			assert.strictEqual(agents.length, 1);
			assert.strictEqual(agents[0].id, testAgentId);
		});

		test('can dispose an agent implementation', () => {
			store.add(chatAgentService.registerAgent(testAgentId, testAgentData));
			const implRegistration = chatAgentService.registerAgentImplementation(testAgentId, agentImpl);
			implRegistration.dispose();

			const agents = chatAgentService.getActivatedAgents();
			assert.strictEqual(agents.length, 0);
		});

		test('should throw error if agent does not exist', () => {
			assert.throws(() => chatAgentService.registerAgentImplementation('nonexistentAgent', agentImpl));
		});

		test('should throw error if agent already has an implementation', () => {
			store.add(chatAgentService.registerAgent(testAgentId, testAgentData));
			store.add(chatAgentService.registerAgentImplementation(testAgentId, agentImpl));

			assert.throws(() => chatAgentService.registerAgentImplementation(testAgentId, agentImpl));
		});
	});

	// --- Start Positron ---
	// `chat.disableAIFeatures` hides the chat UI by clearing the
	// `chatIsEnabled` / `chatPanelParticipantRegistered` context keys and by
	// refusing to resolve a default agent (which gates surfaces like inline chat),
	// while leaving the chat extension's `vscode.lm` model provider registered.
	suite('AI disabled gating', function () {
		const defaultAgentId = 'defaultAgent';
		const defaultAgentData: IChatAgentData = { ...testAgentData, id: defaultAgentId, isDefault: true };
		const inlineAgentId = 'inlineAgent';
		const inlineAgentData: IChatAgentData = {
			...testAgentData,
			id: inlineAgentId,
			isDefault: true,
			locations: [ChatAgentLocation.EditorInline],
			modes: [ChatModeKind.Ask],
		};
		const agentImpl: IChatAgentImplementation = {
			invoke: async () => { return {}; },
			provideFollowups: async () => { return []; },
		};

		const contextKeys = () => ({
			enabled: ChatContextKeys.enabled.getValue(contextKeyService),
			panelParticipantRegistered: ChatContextKeys.panelParticipantRegistered.getValue(contextKeyService),
			aiFeaturesEnabled: ChatContextKeys.aiFeaturesEnabled.getValue(contextKeyService),
		});

		const fireConfigChange = (changedKey: string) => {
			configurationService.onDidChangeConfigurationEmitter.fire({
				affectsConfiguration: (key: string) => key === changedKey,
				affectedKeys: new Set([changedKey]),
				change: { keys: [], overrides: [] },
				source: ConfigurationTarget.USER,
			});
		};
		const fireAIDisabledChange = () => fireConfigChange(ChatConfiguration.AIDisabled);

		test('chat context keys are set when AI features are enabled', () => {
			store.add(chatAgentService.registerAgent(defaultAgentId, defaultAgentData));
			store.add(chatAgentService.registerAgentImplementation(defaultAgentId, agentImpl));

			assert.deepStrictEqual(contextKeys(), { enabled: true, panelParticipantRegistered: true, aiFeaturesEnabled: true });
		});

		test('chat context keys are cleared when AI features are disabled', () => {
			configurationService.setUserConfiguration(ChatConfiguration.AIDisabled, true);
			store.add(chatAgentService.registerAgent(defaultAgentId, defaultAgentData));
			store.add(chatAgentService.registerAgentImplementation(defaultAgentId, agentImpl));

			assert.deepStrictEqual(contextKeys(), { enabled: false, panelParticipantRegistered: false, aiFeaturesEnabled: false });
		});

		test('config listener recomputes chat context keys when the setting flips', () => {
			store.add(chatAgentService.registerAgent(defaultAgentId, defaultAgentData));
			store.add(chatAgentService.registerAgentImplementation(defaultAgentId, agentImpl));

			configurationService.setUserConfiguration(ChatConfiguration.AIDisabled, true);
			fireAIDisabledChange();
			assert.deepStrictEqual(contextKeys(), { enabled: false, panelParticipantRegistered: false, aiFeaturesEnabled: false }, 'keys hide when AI is disabled at runtime');

			configurationService.setUserConfiguration(ChatConfiguration.AIDisabled, false);
			fireAIDisabledChange();
			assert.deepStrictEqual(contextKeys(), { enabled: true, panelParticipantRegistered: true, aiFeaturesEnabled: true }, 'keys return when AI is re-enabled at runtime');
		});

		test('API test agent registers the panel participant regardless of positron.assistant.enable', () => {
			configurationService.setUserConfiguration('positron.assistant.enable', false);
			store.add(chatAgentService.registerAgent(defaultAgentId, {
				...defaultAgentData,
				extensionId: new ExtensionIdentifier('vscode.vscode-api-tests'),
			}));

			assert.strictEqual(ChatContextKeys.panelParticipantRegistered.getValue(contextKeyService), true);
		});

		test('getDefaultAgent resolves a default agent only while AI features are enabled', () => {
			store.add(chatAgentService.registerAgent(inlineAgentId, inlineAgentData));
			store.add(chatAgentService.registerAgentImplementation(inlineAgentId, agentImpl));

			// With AI enabled the inline chat enabler can resolve its editor agent.
			assert.strictEqual(chatAgentService.getDefaultAgent(ChatAgentLocation.EditorInline)?.id, inlineAgentId);

			// Disabling AI features must withhold the agent so inline chat (and any
			// other surface keyed off agent availability) is gated off.
			configurationService.setUserConfiguration(ChatConfiguration.AIDisabled, true);
			assert.strictEqual(chatAgentService.getDefaultAgent(ChatAgentLocation.EditorInline), undefined);
		});

		test('flipping chat.disableAIFeatures fires onDidChangeAgents so lazy consumers re-evaluate', () => {
			store.add(chatAgentService.registerAgent(inlineAgentId, inlineAgentData));
			store.add(chatAgentService.registerAgentImplementation(inlineAgentId, agentImpl));

			let agentsChangedCount = 0;
			store.add(chatAgentService.onDidChangeAgents(() => agentsChangedCount++));

			configurationService.setUserConfiguration(ChatConfiguration.AIDisabled, true);
			fireAIDisabledChange();

			assert.strictEqual(agentsChangedCount, 1, 'onDidChangeAgents fires when the setting is toggled at runtime');
		});

		// `ai.enabled` is Positron's master AI switch. It overrides
		// `chat.disableAIFeatures` in one direction only: `ai.enabled = false` forces
		// the chat UI off regardless of `chat.disableAIFeatures`, while `ai.enabled =
		// true` (or unset) leaves `chat.disableAIFeatures` to govern Copilot on its own.
		test('ai.enabled off hides the chat UI even when chat.disableAIFeatures is off', () => {
			configurationService.setUserConfiguration(ChatConfiguration.AIDisabled, false);
			configurationService.setUserConfiguration('ai.enabled', false);
			store.add(chatAgentService.registerAgent(inlineAgentId, inlineAgentData));
			store.add(chatAgentService.registerAgentImplementation(inlineAgentId, agentImpl));

			assert.deepStrictEqual(contextKeys(), { enabled: false, panelParticipantRegistered: false, aiFeaturesEnabled: false });
			assert.strictEqual(chatAgentService.getDefaultAgent(ChatAgentLocation.EditorInline), undefined);
		});

		test('ai.enabled on does not force the chat UI on while chat.disableAIFeatures is on', () => {
			configurationService.setUserConfiguration('ai.enabled', true);
			configurationService.setUserConfiguration(ChatConfiguration.AIDisabled, true);
			store.add(chatAgentService.registerAgent(defaultAgentId, defaultAgentData));
			store.add(chatAgentService.registerAgentImplementation(defaultAgentId, agentImpl));

			assert.deepStrictEqual(contextKeys(), { enabled: false, panelParticipantRegistered: false, aiFeaturesEnabled: false });
		});

		test('config listener recomputes chat context keys when ai.enabled flips', () => {
			store.add(chatAgentService.registerAgent(defaultAgentId, defaultAgentData));
			store.add(chatAgentService.registerAgentImplementation(defaultAgentId, agentImpl));

			configurationService.setUserConfiguration('ai.enabled', false);
			fireConfigChange('ai.enabled');
			assert.deepStrictEqual(contextKeys(), { enabled: false, panelParticipantRegistered: false, aiFeaturesEnabled: false }, 'keys hide when the master switch is off at runtime');

			configurationService.setUserConfiguration('ai.enabled', true);
			fireConfigChange('ai.enabled');
			assert.deepStrictEqual(contextKeys(), { enabled: true, panelParticipantRegistered: true, aiFeaturesEnabled: true }, 'keys return when the master switch is back on at runtime');
		});
	});
	// --- End Positron ---
});
