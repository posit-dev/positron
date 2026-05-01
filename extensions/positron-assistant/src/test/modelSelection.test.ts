/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { getCandidateModels, selectPreferredModel } from '../modelSelection.js';
import { ParticipantService } from '../participants.js';
import { mock } from './utils.js';

function createMockModel(id: string, vendor: string, name = id, family = 'test'): vscode.LanguageModelChat {
	return {
		id,
		name,
		vendor,
		family,
		version: '1.0.0',
		maxInputTokens: 2048,
		async sendRequest() {
			return {
				stream: (async function* () { yield 'ok'; })(),
				text: (async function* () { yield 'ok'; })(),
			} as vscode.LanguageModelChatResponse;
		},
		async countTokens() { return 0; },
	};
}

suite('modelSelection', () => {
	let participantService: ParticipantService;
	let log: vscode.LogOutputChannel;

	setup(() => {
		participantService = new ParticipantService();
		log = mock<vscode.LogOutputChannel>({
			debug: () => { },
			info: () => { },
			warn: () => { },
			error: () => { },
			trace: () => { },
		});
	});

	teardown(() => {
		participantService.dispose();
		sinon.restore();
	});

	test('configured exact match wins', async () => {
		const configuredModel = createMockModel('configured-model', 'vendor-a');
		const sessionModel = createMockModel('session-model', 'vendor-b');
		participantService.trackSessionModel('session-1', 'session-model');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id === 'session-model') {
				return [sessionModel];
			}
			return [configuredModel, sessionModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		const result = await selectPreferredModel({
			participantService,
			log,
			logPrefix: 'test',
			configuredModels: { patterns: ['configured-model'], matchMode: 'partial' },
		});

		assert.ok(result);
		assert.strictEqual(result.model.id, 'configured-model');
		assert.strictEqual(result.source, 'configured');
		assert.strictEqual(result.usedFallback, false);
	});

	test('configured partial match works for notebook suggestions', async () => {
		const model = createMockModel('openai/gpt-4.1-mini', 'openai');
		sinon.stub(vscode.lm, 'selectChatModels').resolves([model]);
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		const result = await selectPreferredModel({
			participantService,
			log,
			logPrefix: 'test',
			configuredModels: { patterns: ['4.1'], matchMode: 'partial' },
		});

		assert.ok(result);
		assert.strictEqual(result.model.id, model.id);
		assert.strictEqual(result.source, 'configured');
	});

	test('configured boundary match works for ghost cells and does not match inside a word', async () => {
		const gemini = createMockModel('google/gemini-pro', 'google', 'Gemini Pro');
		const mini = createMockModel('openai/gpt-4o-mini', 'openai', 'GPT 4o Mini');
		sinon.stub(vscode.lm, 'selectChatModels').resolves([gemini, mini]);
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		const result = await selectPreferredModel({
			participantService,
			log,
			logPrefix: 'test',
			configuredModels: { patterns: ['mini'], matchMode: 'boundary' },
		});

		assert.ok(result);
		assert.strictEqual(result.model.id, mini.id);
		assert.strictEqual(result.source, 'configured');
	});

	test('session model beats provider and fallback when configured model is unavailable', async () => {
		const sessionModel = createMockModel('session-model', 'vendor-a');
		const providerModel = createMockModel('provider-model', 'vendor-b');
		const fallbackModel = createMockModel('fallback-model', 'vendor-c');
		participantService.trackSessionModel('session-1', 'session-model');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id === 'session-model') {
				return [sessionModel];
			}
			if (selector?.vendor === 'vendor-b') {
				return [providerModel];
			}
			return [fallbackModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves({ id: 'vendor-b', displayName: 'Vendor B' });

		const result = await selectPreferredModel({
			participantService,
			log,
			logPrefix: 'test',
			configuredModels: { patterns: ['missing'], matchMode: 'partial' },
		});

		assert.ok(result);
		assert.strictEqual(result.model.id, sessionModel.id);
		assert.strictEqual(result.source, 'session');
		assert.strictEqual(result.usedFallback, true);
	});

	test('provider model beats all-model fallback', async () => {
		const providerModel = createMockModel('provider-model', 'vendor-b');
		const fallbackModel = createMockModel('fallback-model', 'vendor-c');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.vendor === 'vendor-b') {
				return [providerModel];
			}
			return [fallbackModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves({ id: 'vendor-b', displayName: 'Vendor B' });

		const result = await selectPreferredModel({ participantService, log, logPrefix: 'test' });

		assert.ok(result);
		assert.strictEqual(result.model.id, providerModel.id);
		assert.strictEqual(result.source, 'provider');
	});

	test('cancellation returns null between async selection steps', async () => {
		const cts = new vscode.CancellationTokenSource();

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async () => {
			cts.cancel();
			return [createMockModel('configured-model', 'vendor-a')];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves(undefined);

		const result = await selectPreferredModel({
			participantService,
			log,
			logPrefix: 'test',
			token: cts.token,
			configuredModels: { patterns: ['configured-model'], matchMode: 'partial' },
		});
		cts.dispose();

		assert.strictEqual(result, null);
	});

	test('candidate list deduplicates and filters fallback models for git', async () => {
		const sharedModel = createMockModel('shared-model', 'vendor-a');
		const providerModel = createMockModel('provider-model', 'vendor-b');
		const filteredModel = createMockModel('filtered-model', 'vendor-c', 'filtered-model', 'filtered');
		const fallbackModel = createMockModel('fallback-model', 'vendor-c');
		participantService.trackSessionModel('session-1', 'shared-model');

		sinon.stub(vscode.lm, 'selectChatModels').callsFake(async (selector) => {
			if (selector?.id === 'shared-model') {
				return [sharedModel];
			}
			if (selector?.vendor === 'vendor-b') {
				return [sharedModel, providerModel];
			}
			return [sharedModel, providerModel, filteredModel, fallbackModel];
		});
		sinon.stub(positron.ai, 'getCurrentProvider').resolves({ id: 'vendor-b', displayName: 'Vendor B' });

		const candidates = await getCandidateModels({
			participantService,
			fallbackModelFilter: model => model.family !== 'filtered',
		});

		assert.ok(candidates);
		assert.deepStrictEqual(
			candidates.map(model => model.id),
			['shared-model', 'provider-model', 'fallback-model'],
		);
	});
});
