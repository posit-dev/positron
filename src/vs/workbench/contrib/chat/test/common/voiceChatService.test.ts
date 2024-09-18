/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { ProviderResult } from 'vs/editor/common/languages';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { ChatAgentLocation, IChatAgent, IChatAgentCommand, IChatAgentCompletionItem, IChatAgentData, IChatAgentHistoryEntry, IChatAgentImplementation, IChatAgentMetadata, IChatAgentRequest, IChatAgentResult, IChatAgentService } from 'vs/workbench/contrib/chat/common/chatAgents';
import { IChatModel } from 'vs/workbench/contrib/chat/common/chatModel';
import { IChatProgress, IChatFollowup } from 'vs/workbench/contrib/chat/common/chatService';
import { IVoiceChatSessionOptions, IVoiceChatTextEvent, VoiceChatService } from 'vs/workbench/contrib/chat/common/voiceChatService';
import { ISpeechProvider, ISpeechService, ISpeechToTextEvent, ISpeechToTextSession, ITextToSpeechSession, KeywordRecognitionStatus, SpeechToTextStatus } from 'vs/workbench/contrib/speech/common/speechService';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';

suite('VoiceChat', () => {

	class TestChatAgentCommand implements IChatAgentCommand {
		constructor(readonly name: string, readonly description: string) { }
	}

	class TestChatAgent implements IChatAgent {

		extensionId: ExtensionIdentifier = nullExtensionDescription.identifier;
		extensionPublisher = '';
		extensionDisplayName = '';
		extensionPublisherId = '';
		locations: ChatAgentLocation[] = [ChatAgentLocation.Panel];
		public readonly name: string;
		constructor(readonly id: string, readonly slashCommands: IChatAgentCommand[]) {
			this.name = id;
		}
		invoke(request: IChatAgentRequest, progress: (part: IChatProgress) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> { throw new Error('Method not implemented.'); }
		provideWelcomeMessage?(location: ChatAgentLocation, token: CancellationToken): ProviderResult<(string | IMarkdownString)[] | undefined> { throw new Error('Method not implemented.'); }
		metadata = {};
	}

	const agents: IChatAgent[] = [
		new TestChatAgent('workspace', [
			new TestChatAgentCommand('fix', 'fix'),
			new TestChatAgentCommand('explain', 'explain')
		]),
		new TestChatAgent('vscode', [
			new TestChatAgentCommand('search', 'search')
		]),
	];

	class TestChatAgentService implements IChatAgentService {
		_serviceBrand: undefined;
		readonly onDidChangeAgents = Event.None;
		registerAgentImplementation(id: string, agent: IChatAgentImplementation): IDisposable { throw new Error(); }
		registerDynamicAgent(data: IChatAgentData, agentImpl: IChatAgentImplementation): IDisposable { throw new Error('Method not implemented.'); }
		invokeAgent(id: string, request: IChatAgentRequest, progress: (part: IChatProgress) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> { throw new Error(); }
		getFollowups(id: string, request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]> { throw new Error(); }
		getActivatedAgents(): IChatAgent[] { return agents; }
		getAgents(): IChatAgent[] { return agents; }
		getDefaultAgent(): IChatAgent | undefined { throw new Error(); }
		getContributedDefaultAgent(): IChatAgentData | undefined { throw new Error(); }
		getSecondaryAgent(): IChatAgent | undefined { throw new Error(); }
		registerAgent(id: string, data: IChatAgentData): IDisposable { throw new Error('Method not implemented.'); }
		getAgent(id: string): IChatAgentData | undefined { throw new Error('Method not implemented.'); }
		getAgentsByName(name: string): IChatAgentData[] { throw new Error('Method not implemented.'); }
		updateAgent(id: string, updateMetadata: IChatAgentMetadata): void { throw new Error('Method not implemented.'); }
		getAgentByFullyQualifiedId(id: string): IChatAgentData | undefined { throw new Error('Method not implemented.'); }
		registerAgentCompletionProvider(id: string, provider: (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>): IDisposable { throw new Error('Method not implemented.'); }
		getAgentCompletionItems(id: string, query: string, token: CancellationToken): Promise<IChatAgentCompletionItem[]> { throw new Error('Method not implemented.'); }
		agentHasDupeName(id: string): boolean { throw new Error('Method not implemented.'); }
	}

	class TestSpeechService implements ISpeechService {
		_serviceBrand: undefined;

		onDidChangeHasSpeechProvider = Event.None;

		readonly hasSpeechProvider = true;
		readonly hasActiveSpeechToTextSession = false;
		readonly hasActiveTextToSpeechSession = false;
		readonly hasActiveKeywordRecognition = false;

		registerSpeechProvider(identifier: string, provider: ISpeechProvider): IDisposable { throw new Error('Method not implemented.'); }
		onDidStartSpeechToTextSession = Event.None;
		onDidEndSpeechToTextSession = Event.None;

		async createSpeechToTextSession(token: CancellationToken): Promise<ISpeechToTextSession> {
			return {
				onDidChange: emitter.event
			};
		}

		onDidStartTextToSpeechSession = Event.None;
		onDidEndTextToSpeechSession = Event.None;

		async createTextToSpeechSession(token: CancellationToken): Promise<ITextToSpeechSession> {
			return {
				onDidChange: Event.None,
				synthesize: async () => { }
			};
		}

		onDidStartKeywordRecognition = Event.None;
		onDidEndKeywordRecognition = Event.None;
		recognizeKeyword(token: CancellationToken): Promise<KeywordRecognitionStatus> { throw new Error('Method not implemented.'); }
	}

	const disposables = new DisposableStore();
	let emitter: Emitter<ISpeechToTextEvent>;

	let service: VoiceChatService;
	let event: IVoiceChatTextEvent | undefined;

	async function createSession(options: IVoiceChatSessionOptions) {
		const cts = new CancellationTokenSource();
		disposables.add(toDisposable(() => cts.dispose(true)));
		const session = await service.createVoiceChatSession(cts.token, options);
		disposables.add(session.onDidChange(e => {
			event = e;
		}));
	}

	setup(() => {
		emitter = disposables.add(new Emitter<ISpeechToTextEvent>());
		service = disposables.add(new VoiceChatService(new TestSpeechService(), new TestChatAgentService(), new MockContextKeyService()));
	});

	teardown(() => {
		disposables.clear();
	});

	test('Agent and slash command detection (useAgents: false)', async () => {
		await testAgentsAndSlashCommandsDetection({ usesAgents: false, model: {} as IChatModel });
	});

	test('Agent and slash command detection (useAgents: true)', async () => {
		await testAgentsAndSlashCommandsDetection({ usesAgents: true, model: {} as IChatModel });
	});

	async function testAgentsAndSlashCommandsDetection(options: IVoiceChatSessionOptions) {

		// Nothing to detect
		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Started });
		assert.strictEqual(event?.status, SpeechToTextStatus.Started);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'Hello' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, 'Hello');
		assert.strictEqual(event?.waitingForInput, undefined);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'Hello World' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, 'Hello World');
		assert.strictEqual(event?.waitingForInput, undefined);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'Hello World' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, 'Hello World');
		assert.strictEqual(event?.waitingForInput, undefined);

		// Agent
		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, 'At');

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At workspace' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace' : 'At workspace');
		assert.strictEqual(event?.waitingForInput, options.usesAgents);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'at workspace' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace' : 'at workspace');
		assert.strictEqual(event?.waitingForInput, options.usesAgents);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At workspace help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace help' : 'At workspace help');
		assert.strictEqual(event?.waitingForInput, false);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At workspace help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace help' : 'At workspace help');
		assert.strictEqual(event?.waitingForInput, false);

		// Agent with punctuation
		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At workspace, help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace help' : 'At workspace, help');
		assert.strictEqual(event?.waitingForInput, false);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At workspace, help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace help' : 'At workspace, help');
		assert.strictEqual(event?.waitingForInput, false);

		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At Workspace. help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace help' : 'At Workspace. help');
		assert.strictEqual(event?.waitingForInput, false);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At Workspace. help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace help' : 'At Workspace. help');
		assert.strictEqual(event?.waitingForInput, false);

		// Slash Command
		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'Slash fix' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace /fix' : '/fix');
		assert.strictEqual(event?.waitingForInput, true);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'Slash fix' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace /fix' : '/fix');
		assert.strictEqual(event?.waitingForInput, true);

		// Agent + Slash Command
		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At code slash search help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@vscode /search help' : 'At code slash search help');
		assert.strictEqual(event?.waitingForInput, false);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At code slash search help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@vscode /search help' : 'At code slash search help');
		assert.strictEqual(event?.waitingForInput, false);

		// Agent + Slash Command with punctuation
		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At code, slash search, help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@vscode /search help' : 'At code, slash search, help');
		assert.strictEqual(event?.waitingForInput, false);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At code, slash search, help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@vscode /search help' : 'At code, slash search, help');
		assert.strictEqual(event?.waitingForInput, false);

		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At code. slash, search help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@vscode /search help' : 'At code. slash, search help');
		assert.strictEqual(event?.waitingForInput, false);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At code. slash search, help' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@vscode /search help' : 'At code. slash search, help');
		assert.strictEqual(event?.waitingForInput, false);

		// Agent not detected twice
		await createSession(options);

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At workspace, for at workspace' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace for at workspace' : 'At workspace, for at workspace');
		assert.strictEqual(event?.waitingForInput, false);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At workspace, for at workspace' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, options.usesAgents ? '@workspace for at workspace' : 'At workspace, for at workspace');
		assert.strictEqual(event?.waitingForInput, false);

		// Slash command detected after agent recognized
		if (options.usesAgents) {
			await createSession(options);

			emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At workspace' });
			assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
			assert.strictEqual(event?.text, '@workspace');
			assert.strictEqual(event?.waitingForInput, true);

			emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'slash' });
			assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
			assert.strictEqual(event?.text, 'slash');
			assert.strictEqual(event?.waitingForInput, false);

			emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'slash fix' });
			assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
			assert.strictEqual(event?.text, '/fix');
			assert.strictEqual(event?.waitingForInput, true);

			emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'slash fix' });
			assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
			assert.strictEqual(event?.text, '/fix');
			assert.strictEqual(event?.waitingForInput, true);

			await createSession(options);

			emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At workspace' });
			assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
			assert.strictEqual(event?.text, '@workspace');
			assert.strictEqual(event?.waitingForInput, true);

			emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'slash fix' });
			assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
			assert.strictEqual(event?.text, '/fix');
			assert.strictEqual(event?.waitingForInput, true);
		}
	}

	test('waiting for input', async () => {

		// Agent
		await createSession({ usesAgents: true, model: {} as IChatModel });

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At workspace' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, '@workspace');
		assert.strictEqual(event.waitingForInput, true);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At workspace' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, '@workspace');
		assert.strictEqual(event.waitingForInput, true);

		// Slash Command
		await createSession({ usesAgents: true, model: {} as IChatModel });

		emitter.fire({ status: SpeechToTextStatus.Recognizing, text: 'At workspace slash explain' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognizing);
		assert.strictEqual(event?.text, '@workspace /explain');
		assert.strictEqual(event.waitingForInput, true);

		emitter.fire({ status: SpeechToTextStatus.Recognized, text: 'At workspace slash explain' });
		assert.strictEqual(event?.status, SpeechToTextStatus.Recognized);
		assert.strictEqual(event?.text, '@workspace /explain');
		assert.strictEqual(event.waitingForInput, true);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
