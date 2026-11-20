/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IHeadlessLanguageModelService, IStreamTextRequest, StreamTextResult } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { CheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CHECKPOINTS_MODEL_KEY, CHECKPOINTS_SUGGESTIONS_ENABLED_KEY } from '../../common/checkpointsConfiguration.js';
import { Job } from '../../common/agent/jobTypes.js';

/** A job whose answer must be an object with a string `title`. */
const titleJob: Job<string, { title: string }> = {
	name: 'title',
	weight: 'light',
	version: 1,
	buildPrompt: input => ({ systemPrompt: 'Write a title.', user: input }),
	check: raw => {
		const title = (raw as { title?: unknown }).title;
		return typeof title === 'string' ? { title } : undefined;
	},
};

function answer(...pieces: string[]): StreamTextResult {
	return {
		available: true,
		model: { id: 'model-1', name: 'Model 1' },
		usedFallback: false,
		text: (async function* () {
			yield* pieces;
		})(),
	};
}

describe('CheckpointsAgentService', () => {
	const disposables = new DisposableStore();
	let configuration: TestConfigurationService;
	let storage: InMemoryStorageService;
	let streamText: ReturnType<typeof vi.fn<(request: IStreamTextRequest) => Promise<StreamTextResult>>>;
	let service: CheckpointsAgentService;
	const none = CancellationToken.None;

	/** Changes a setting and fires the change event, as the configuration service does. */
	async function setSetting(key: string, value: unknown): Promise<void> {
		await configuration.setUserConfiguration(key, value);
		configuration.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: affected => affected === key }));
	}

	/** Creates the service with the notice already answered, unless `disclosed` is false. */
	function createService(disclosed = true): CheckpointsAgentService {
		if (disclosed) {
			storage.store(CheckpointsAgentService.DISCLOSED_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		return disposables.add(new CheckpointsAgentService(
			configuration,
			storage,
			stubInterface<IHeadlessLanguageModelService>({ streamText }),
			new NullLogService(),
		));
	}

	beforeEach(() => {
		configuration = new TestConfigurationService({ [AI_ENABLED_KEY]: true, [CHECKPOINTS_SUGGESTIONS_ENABLED_KEY]: true, [CHECKPOINTS_MODEL_KEY]: [] });
		vi.spyOn(configuration, 'updateValue').mockImplementation(async (key, value) => setSetting(key, value));
		storage = disposables.add(new InMemoryStorageService());
		streamText = vi.fn(async () => answer('{"title": "Fixed the dose units"}'));
		service = createService();
	});

	afterEach(() => disposables.clear());

	test('ai.enabled false: no model call, outcome ai-off', async () => {
		await setSetting(AI_ENABLED_KEY, false);

		expect(await service.run(titleJob, 'diff', none)).toEqual({ ok: false, reason: 'ai-off' });
		expect(streamText).not.toHaveBeenCalled();
		expect(service.available).toBe(false);
	});

	test('ai.enabled toggled at runtime is respected on the next call', async () => {
		const changes = vi.fn();
		disposables.add(service.onDidChangeAvailable(changes));
		expect((await service.run(titleJob, 'one', none)).ok).toBe(true);

		await setSetting(AI_ENABLED_KEY, false);
		expect(await service.run(titleJob, 'two', none)).toEqual({ ok: false, reason: 'ai-off' });
		await setSetting(AI_ENABLED_KEY, true);
		expect((await service.run(titleJob, 'three', none)).ok).toBe(true);

		expect(streamText).toHaveBeenCalledTimes(2);
		expect(changes).toHaveBeenCalledTimes(2);
	});

	test('suggestions setting false: no model call', async () => {
		await setSetting(CHECKPOINTS_SUGGESTIONS_ENABLED_KEY, false);

		expect(await service.run(titleJob, 'diff', none)).toEqual({ ok: false, reason: 'suggestions-off' });
		expect(streamText).not.toHaveBeenCalled();
		expect(service.available).toBe(false);
	});

	test('a second identical call is answered from the cache', async () => {
		expect(await service.run(titleJob, 'diff', none)).toEqual({ ok: true, value: { title: 'Fixed the dose units' }, fromCache: false });

		// A new service reads the same workspace storage, as after the view is opened again.
		const reopened = createService();
		expect(await reopened.run(titleJob, 'diff', none)).toEqual({ ok: true, value: { title: 'Fixed the dose units' }, fromCache: true });
		expect(streamText).toHaveBeenCalledTimes(1);
	});

	test('a new job version does not use the old cache entry', async () => {
		await service.run(titleJob, 'diff', none);

		const outcome = await service.run({ ...titleJob, version: 2 }, 'diff', none);

		expect(outcome).toEqual({ ok: true, value: { title: 'Fixed the dose units' }, fromCache: false });
		expect(streamText).toHaveBeenCalledTimes(2);
	});

	test('a changed model setting does not use the old cache entry, and selects the model', async () => {
		await service.run(titleJob, 'diff', none);
		await setSetting(CHECKPOINTS_MODEL_KEY, ['haiku']);

		const outcome = await service.run(titleJob, 'diff', none);

		expect(outcome.ok && outcome.fromCache).toBe(false);
		expect(streamText.mock.calls.map(([request]) => request.model)).toEqual([{ tier: 'fast-cheap' }, { patterns: ['haiku'] }]);
	});

	test('a failed check gives failed-check and is not cached', async () => {
		streamText.mockImplementation(async () => answer('```json\n{"name": "no title"}\n```'));

		expect(await service.run(titleJob, 'diff', none)).toEqual({ ok: false, reason: 'failed-check', detail: 'rejected' });
		expect(await service.run(titleJob, 'diff', none)).toEqual({ ok: false, reason: 'failed-check', detail: 'rejected' });
		expect(streamText).toHaveBeenCalledTimes(2);
	});

	test('model unavailable gives unavailable', async () => {
		streamText.mockImplementation(async () => ({ available: false, reason: 'no-providers-configured' }));

		expect(await service.run(titleJob, 'diff', none)).toEqual({ ok: false, reason: 'unavailable', detail: 'no-providers-configured' });
	});

	test('the system prompt ends with the instruction to answer with one JSON object', async () => {
		await service.run(titleJob, 'diff', none);

		const request = streamText.mock.calls[0][0];
		expect(request.systemPrompt.startsWith('Write a title.')).toBe(true);
		expect(request.systemPrompt.endsWith('Answer with one JSON object only, with no text before or after it.')).toBe(true);
		expect(request.messages).toEqual([{ role: 'user', content: 'diff' }]);
	});

	test('the first call waits for the disclosure and the second does not', async () => {
		storage.remove(CheckpointsAgentService.DISCLOSED_KEY, StorageScope.WORKSPACE);
		const pendingChanges = vi.fn();
		disposables.add(service.onDidChangePendingDisclosure(pendingChanges));

		const first = service.run(titleJob, 'one', none);
		const alsoWaiting = service.run(titleJob, 'two', none);
		await vi.waitFor(() => expect(service.pendingDisclosure).toBe(true));
		expect(pendingChanges).toHaveBeenCalledTimes(1);
		expect(streamText).not.toHaveBeenCalled();

		await service.answerDisclosure('ok');

		expect((await first).ok).toBe(true);
		expect((await alsoWaiting).ok).toBe(true);
		expect(service.pendingDisclosure).toBe(false);
		expect(pendingChanges).toHaveBeenCalledTimes(2);
		expect(storage.getBoolean(CheckpointsAgentService.DISCLOSED_KEY, StorageScope.WORKSPACE)).toBe(true);

		expect((await service.run(titleJob, 'three', none)).ok).toBe(true);
		expect(service.pendingDisclosure).toBe(false);
		expect(pendingChanges).toHaveBeenCalledTimes(2);
	});

	test('Turn off suggestions sets the setting and returns suggestions-off', async () => {
		storage.remove(CheckpointsAgentService.DISCLOSED_KEY, StorageScope.WORKSPACE);
		const waiting = service.run(titleJob, 'diff', none);
		await vi.waitFor(() => expect(service.pendingDisclosure).toBe(true));

		await service.answerDisclosure('turn-off');

		expect(await waiting).toEqual({ ok: false, reason: 'suggestions-off' });
		expect(configuration.updateValue).toHaveBeenCalledWith(CHECKPOINTS_SUGGESTIONS_ENABLED_KEY, false);
		expect(configuration.getValue(CHECKPOINTS_SUGGESTIONS_ENABLED_KEY)).toBe(false);
		expect(streamText).not.toHaveBeenCalled();
		expect(service.pendingDisclosure).toBe(false);
	});

	test('turning AI off while the notice waits withdraws it with ai-off', async () => {
		storage.remove(CheckpointsAgentService.DISCLOSED_KEY, StorageScope.WORKSPACE);
		const waiting = service.run(titleJob, 'diff', none);
		await vi.waitFor(() => expect(service.pendingDisclosure).toBe(true));

		await setSetting(AI_ENABLED_KEY, false);

		expect(await waiting).toEqual({ ok: false, reason: 'ai-off' });
		expect(service.pendingDisclosure).toBe(false);
		expect(streamText).not.toHaveBeenCalled();
	});

	test('cancellation stops the stream and returns cancelled', async () => {
		const source = new CancellationTokenSource();
		let pulled = 0;
		streamText.mockImplementation(async () => ({
			available: true,
			model: { id: 'model-1', name: 'Model 1' },
			usedFallback: false,
			text: (async function* () {
				pulled++;
				source.cancel();
				yield '{"title": ';
				pulled++;
				yield '"Fixed"}';
			})(),
		}));

		expect(await service.run(titleJob, 'diff', source.token)).toEqual({ ok: false, reason: 'cancelled' });
		expect(pulled).toBe(1);
		expect(streamText.mock.calls[0][0].cancellationToken).toBe(source.token);
	});

	test('cancellation while the notice waits returns cancelled and leaves the notice', async () => {
		storage.remove(CheckpointsAgentService.DISCLOSED_KEY, StorageScope.WORKSPACE);
		const source = new CancellationTokenSource();
		const waiting = service.run(titleJob, 'diff', source.token);
		await vi.waitFor(() => expect(service.pendingDisclosure).toBe(true));

		source.cancel();

		expect(await waiting).toEqual({ ok: false, reason: 'cancelled' });
		expect(service.pendingDisclosure).toBe(true);
	});
});
