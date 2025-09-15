/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ChatAgentService, IChatAgentData, IChatAgentImplementation } from '../../common/chatAgents.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
// --- Start Positron ---
import { ILanguageModelChatProvider, ILanguageModelsChangeEvent, ILanguageModelsService, IUserFriendlyLanguageModel } from '../../common/languageModels.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
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
	onDidChangeProviders: Event<ILanguageModelsChangeEvent> = new Emitter<ILanguageModelsChangeEvent>().event;
	updateModelPickerPreference(modelIdentifier: string, showInModelPicker: boolean): void { }
	getVendors(): IUserFriendlyLanguageModel[] { return []; }
	registerLanguageModelProvider(vendor: string, extensionId: ExtensionIdentifier, provider: ILanguageModelChatProvider): IDisposable {
		return Disposable.None;
	}
	readonly _serviceBrand: undefined;

	onDidChangeLanguageModels = new Emitter<any>().event;
	onDidChangeCurrentProvider = new Emitter<any>().event;

	get currentProvider() { return undefined; }
	set currentProvider(provider: any) { }

	getLanguageModelIdsForCurrentProvider() { return []; }
	getLanguageModelProviders() { return []; }
	getLanguageModelIds() { return []; }
	lookupLanguageModel() { return undefined; }
	async selectLanguageModels() { return []; }
	registerLanguageModelChat() { return { dispose: () => { } }; }
	async sendChatRequest(): Promise<any> { throw new Error('Not implemented'); }
	async computeTokenLength() { return 0; }
	getExtensionIdentifierForProvider(vendor: string) { return undefined; }
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
		configurationService.setUserConfiguration('positron.assistant.enable', true);
		chatAgentService = store.add(new ChatAgentService(contextKeyService, configurationService, logService, languageModelsService));
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
});
