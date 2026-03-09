/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ParticipantService } from '../participants.js';
import { generateCommitMessage, getCandidateModels } from '../git.js';
import { mock } from './utils.js';

/** Create a mock language model with configurable behavior. */
function createMockModel(
	id: string,
	vendor: string,
	options?: { shouldFail?: boolean; failDuringStream?: boolean; failMessage?: string; family?: string },
): vscode.LanguageModelChat {
	return {
		id,
		name: id,
		vendor,
		family: options?.family ?? 'test',
		version: '1.0.0',
		maxInputTokens: 2048,
		async sendRequest() {
			if (options?.shouldFail) {
				throw new Error(options.failMessage ?? 'model_not_supported');
			}
			if (options?.failDuringStream) {
				const failMessage = options.failMessage ?? 'stream_error';
				return {
					stream: (async function* () { yield 'partial '; throw new Error(failMessage); })(),
					text: (async function* () { yield 'partial '; throw new Error(failMessage); })(),
				} as vscode.LanguageModelChatResponse;
			}
			return {
				stream: (async function* () { yield 'test commit message'; })(),
				text: (async function* () { yield 'test commit message'; })(),
			} as vscode.LanguageModelChatResponse;
		},
		async countTokens() { return 0; },
	};
}

suite('getCandidateModels', () => {
	let participantService: ParticipantService;

	setup(() => {
		participantService = new ParticipantService();
	});

	teardown(() => {
		participantService.dispose();
		sinon.restore();
	});

	test('returns session model as first candidate', async () => {
		const sessionModel = createMockModel('session-model', 'test-vendor');
		const providerModel = createMockModel('provider-model', 'test-vendor');

		participantService.trackSessionModel('session-1', 'session-model');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id === 'session-model') {
				return [sessionModel];
			}
			if (selector?.vendor === 'test-vendor') {
				return [providerModel];
			}
			return [sessionModel, providerModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves({ id: 'test-vendor', displayName: 'Test' });

		const candidates = await getCandidateModels(participantService);
		assert.strictEqual(candidates[0].id, 'session-model');
	});

	test('falls back to provider models when no session model', async () => {
		const providerModel = createMockModel('provider-model', 'test-vendor');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id) {
				return [];
			}
			if (selector?.vendor === 'test-vendor') {
				return [providerModel];
			}
			return [providerModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves({ id: 'test-vendor', displayName: 'Test' });

		const candidates = await getCandidateModels(participantService);
		assert.strictEqual(candidates[0].id, 'provider-model');
	});

	test('falls back to all models when no session model and no provider', async () => {
		const globalModel = createMockModel('global-model', 'other-vendor');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id || selector?.vendor) {
				return [];
			}
			return [globalModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		const candidates = await getCandidateModels(participantService);
		assert.strictEqual(candidates.length, 1);
		assert.strictEqual(candidates[0].id, 'global-model');
	});

	test('deduplicates models across priority tiers', async () => {
		const sharedModel = createMockModel('shared-model', 'test-vendor');

		participantService.trackSessionModel('session-1', 'shared-model');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id === 'shared-model') {
				return [sharedModel];
			}
			if (selector?.vendor === 'test-vendor') {
				return [sharedModel];
			}
			return [sharedModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves({ id: 'test-vendor', displayName: 'Test' });

		const candidates = await getCandidateModels(participantService);
		assert.strictEqual(candidates.length, 1);
		assert.strictEqual(candidates[0].id, 'shared-model');
	});

	test('filters out echo and error model families', async () => {
		const echoModel = createMockModel('echo-model', 'test-vendor', { family: 'echo' });
		const errorModel = createMockModel('error-model', 'test-vendor', { family: 'error' });
		const goodModel = createMockModel('good-model', 'test-vendor');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id || selector?.vendor) {
				return [];
			}
			return [echoModel, errorModel, goodModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		const candidates = await getCandidateModels(participantService);
		assert.strictEqual(candidates.length, 1);
		assert.strictEqual(candidates[0].id, 'good-model');
	});

	test('throws when no models are available', async () => {
		sinon.stub(vscode.lm, 'selectChatModels').resolves([]);
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		await assert.rejects(
			() => getCandidateModels(participantService),
			{ message: 'No language models available for git commit message generation' },
		);
	});

	test('preserves priority ordering across tiers', async () => {
		const sessionModel = createMockModel('session-model', 'vendor-a');
		const providerModel1 = createMockModel('provider-model-1', 'vendor-b');
		const providerModel2 = createMockModel('provider-model-2', 'vendor-b');
		const globalModel = createMockModel('global-model', 'vendor-c');

		participantService.trackSessionModel('session-1', 'session-model');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id === 'session-model') {
				return [sessionModel];
			}
			if (selector?.vendor === 'vendor-b') {
				return [providerModel1, providerModel2];
			}
			return [sessionModel, providerModel1, providerModel2, globalModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves({ id: 'vendor-b', displayName: 'Vendor B' });

		const candidates = await getCandidateModels(participantService);
		assert.deepStrictEqual(
			candidates.map(m => m.id),
			['session-model', 'provider-model-1', 'provider-model-2', 'global-model'],
		);
	});
});

suite('generateCommitMessage', () => {
	let participantService: ParticipantService;
	let log: vscode.LogOutputChannel;
	let logMessages: { level: string; message: string }[];
	let context: vscode.ExtensionContext;

	setup(() => {
		participantService = new ParticipantService();
		logMessages = [];
		log = mock<vscode.LogOutputChannel>({
			debug: (msg: string) => { logMessages.push({ level: 'debug', message: msg }); },
			info: (msg: string) => { logMessages.push({ level: 'info', message: msg }); },
			warn: (msg: string) => { logMessages.push({ level: 'warn', message: msg }); },
			error: (msg: string) => { logMessages.push({ level: 'error', message: msg }); },
			trace: (msg: string) => { logMessages.push({ level: 'trace', message: msg }); },
		});
		context = mock<vscode.ExtensionContext>({});
	});

	teardown(() => {
		participantService.dispose();
		sinon.restore();
	});

	/** Set up common stubs needed for generateCommitMessage tests. */
	function setupGitMock(changes: { uri: string; status: number }[]) {
		const rootUri = vscode.Uri.file('/test-repo');
		const mockChanges = changes.map(c => ({
			uri: vscode.Uri.file(`/test-repo${c.uri}`),
			originalUri: vscode.Uri.file(`/test-repo${c.uri}`),
			renameUri: undefined,
			status: c.status,
		}));

		const mockRepo = {
			rootUri,
			state: {
				indexChanges: mockChanges,
				workingTreeChanges: [],
				untrackedChanges: [],
				mergeChanges: [],
			},
			inputBox: { value: '' },
			diffIndexWithHEAD: sinon.stub().resolves('diff content'),
			diffWithHEAD: sinon.stub().resolves('diff content'),
		};

		sinon.stub(vscode.extensions, 'getExtension').returns({
			id: 'vscode.git',
			extensionUri: vscode.Uri.file('/extensions/git'),
			extensionPath: '/extensions/git',
			isActive: true,
			packageJSON: {},
			extensionKind: vscode.ExtensionKind.Workspace,
			exports: {
				getAPI: () => ({
					repositories: [mockRepo],
				}),
			},
			activate: () => Promise.resolve(),
		});

		sinon.stub(vscode.commands, 'executeCommand').resolves();
		sinon.stub(vscode.commands, 'registerCommand').returns({ dispose: () => { } });

		return mockRepo;
	}

	test('falls back to next model when first model fails', async () => {
		const failingModel = createMockModel('bad-model', 'test-vendor', {
			shouldFail: true,
			failMessage: 'The requested model is not supported',
		});
		const workingModel = createMockModel('good-model', 'test-vendor');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id || selector?.vendor) {
				return [];
			}
			return [failingModel, workingModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		// Status.INDEX_ADDED = 1
		const mockRepo = setupGitMock([{ uri: '/file.ts', status: 1 }]);

		await generateCommitMessage(context, participantService, log);

		// Verify the working model was used
		assert.strictEqual(mockRepo.inputBox.value, 'test commit message');

		// Verify the failure was logged as a warning
		const warnings = logMessages.filter(m => m.level === 'warn');
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0].message.includes('bad-model'));
		assert.ok(warnings[0].message.includes('The requested model is not supported'));
	});

	test('throws when all candidate models fail', async () => {
		const failingModel1 = createMockModel('bad-model-1', 'vendor-a', {
			shouldFail: true,
			failMessage: 'model_not_supported',
		});
		const failingModel2 = createMockModel('bad-model-2', 'vendor-b', {
			shouldFail: true,
			failMessage: 'unauthorized',
		});

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id || selector?.vendor) {
				return [];
			}
			return [failingModel1, failingModel2];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);
		sinon.stub(vscode.window, 'showErrorMessage').resolves();

		// Status.INDEX_ADDED = 1
		setupGitMock([{ uri: '/file.ts', status: 1 }]);

		await assert.rejects(
			() => generateCommitMessage(context, participantService, log),
			{ message: 'All candidate models failed for commit message generation. Check the log for details.' },
		);

		// Verify both failures were logged
		const warnings = logMessages.filter(m => m.level === 'warn');
		assert.strictEqual(warnings.length, 2);
		assert.ok(warnings[0].message.includes('bad-model-1'));
		assert.ok(warnings[1].message.includes('bad-model-2'));

		// Verify error was logged
		const errors = logMessages.filter(m => m.level === 'error');
		assert.strictEqual(errors.length, 1);
	});

	test('logs each model attempt', async () => {
		const workingModel = createMockModel('good-model', 'test-vendor');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id || selector?.vendor) {
				return [];
			}
			return [workingModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		// Status.INDEX_ADDED = 1
		setupGitMock([{ uri: '/file.ts', status: 1 }]);

		await generateCommitMessage(context, participantService, log);

		// Verify model attempt was logged
		const infoLogs = logMessages.filter(m => m.level === 'info');
		assert.ok(infoLogs.some(m => m.message.includes('Trying model') && m.message.includes('good-model')));
	});

	test('uses first successful model and skips remaining candidates', async () => {
		let model2Called = false;
		const workingModel = createMockModel('good-model', 'test-vendor');
		const unusedModel: vscode.LanguageModelChat = {
			...createMockModel('unused-model', 'test-vendor'),
			async sendRequest() {
				model2Called = true;
				return {
					stream: (async function* () { yield 'unused'; })(),
					text: (async function* () { yield 'unused'; })(),
				} as vscode.LanguageModelChatResponse;
			},
		};

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id || selector?.vendor) {
				return [];
			}
			return [workingModel, unusedModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		// Status.INDEX_ADDED = 1
		const mockRepo = setupGitMock([{ uri: '/file.ts', status: 1 }]);

		await generateCommitMessage(context, participantService, log);

		assert.strictEqual(mockRepo.inputBox.value, 'test commit message');
		assert.strictEqual(model2Called, false);
	});

	test('clears partial inputBox content when model fails mid-stream', async () => {
		const streamFailModel = createMockModel('stream-fail-model', 'test-vendor', {
			failDuringStream: true,
			failMessage: 'connection reset',
		});
		const workingModel = createMockModel('good-model', 'test-vendor');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id || selector?.vendor) {
				return [];
			}
			return [streamFailModel, workingModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		// Status.INDEX_ADDED = 1
		const mockRepo = setupGitMock([{ uri: '/file.ts', status: 1 }]);

		await generateCommitMessage(context, participantService, log);

		// Verify the final value is from the working model, not partial content
		assert.strictEqual(mockRepo.inputBox.value, 'test commit message');

		// Verify the mid-stream failure was logged with repo context
		const warnings = logMessages.filter(m => m.level === 'warn');
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0].message.includes('stream-fail-model'));
		assert.ok(warnings[0].message.includes('connection reset'));
		assert.ok(warnings[0].message.includes('[test-repo]'));
	});
});
