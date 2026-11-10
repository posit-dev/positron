/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IChatProgress, IChatService } from '../../../chat/common/chatService/chatService.js';
import { IChatEditingSession, IModifiedFileEntry, ModifiedFileEntryState } from '../../../chat/common/editing/chatEditingService.js';
import { ChatModel, ChatRequestModel, ChatResponseModel } from '../../../chat/common/model/chatModel.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { PositronEditReviewService } from '../../browser/positronEditReviewService.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfigurationKeys.js';
import { IPositronEditReviewSession } from '../../common/positronEditReview.js';

describe('PositronEditReviewService', () => {
	const file = URI.file('/workspace/analysis.R');
	const notebook = URI.file('/workspace/analysis.ipynb');
	const untitled = URI.from({ scheme: 'untitled', path: 'Untitled-1' });
	const startProgress = stubInterface<IChatProgress>({ kind: 'markdownContent' });

	const startExternalEdits = vi.fn<IChatEditingSession['startExternalEdits']>();
	const stopExternalEdits = vi.fn<IChatEditingSession['stopExternalEdits']>();
	const accept = vi.fn<IChatEditingSession['accept']>();
	const reject = vi.fn<IChatEditingSession['reject']>();
	const show = vi.fn<IChatEditingSession['show']>();
	const entryState = observableValue<ModifiedFileEntryState>('entryState', ModifiedFileEntryState.Modified);
	const entries = observableValue<readonly IModifiedFileEntry[]>('entries', []);
	const changesCount = observableValue<number>('changesCount', 2);
	const original = URI.from({ scheme: 'chat-editing-text-model', path: '/workspace/analysis.R' });
	let baseline = 'x <- 1\n';
	const startEditingSession = vi.fn();
	const acceptResponseProgress = vi.fn();
	const complete = vi.fn();
	const disposeModel = vi.fn();
	const startNewLocalSession = vi.fn<IChatService['startNewLocalSession']>();

	const ctx = createLightTestContainer()
		.stub(IChatService, { startNewLocalSession })
		.stub(INotebookService, { hasSupportedNotebooks: (resource: URI) => resource.path.endsWith('.ipynb') })
		.stub(IModelService, {
			getModel: (resource: URI) => resource.toString() === original.toString() ? stubInterface<ITextModel>({ getValue: () => baseline }) : null,
		})
		.build();

	beforeEach(() => {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({ [AI_ENABLED_KEY]: true }));
		startExternalEdits.mockResolvedValue([startProgress]);
		stopExternalEdits.mockResolvedValue([]);
		entries.set([], undefined);
		entryState.set(ModifiedFileEntryState.Modified, undefined);
		changesCount.set(2, undefined);
		baseline = 'x <- 1\n';
		const model = stubInterface<ChatModel>({
			startEditingSession,
			editingSession: stubInterface<IChatEditingSession>({ startExternalEdits, stopExternalEdits, accept, reject, show, entries }),
			addRequest: () => stubInterface<ChatRequestModel>({ response: stubInterface<ChatResponseModel>({ complete }) }),
			acceptResponseProgress,
		});
		startNewLocalSession.mockReturnValue({ object: model, dispose: disposeModel });
	});

	let session: IPositronEditReviewSession | undefined;

	// Disposal ends the edits in progress first, so it completes asynchronously.
	afterEach(async () => {
		if (session) {
			session.dispose();
			session = undefined;
			await vi.waitFor(() => expect(disposeModel).toHaveBeenCalled());
		}
	});

	function createSession(): IPositronEditReviewSession {
		session = ctx.instantiationService.createInstance(PositronEditReviewService).createSession();
		return session;
	}

	it('refuses to create a session while AI features are disabled', () => {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({ [AI_ENABLED_KEY]: false }));

		expect(() => createSession()).toThrow('AI features are disabled');
		expect(startNewLocalSession).not.toHaveBeenCalled();
	});

	it('records edits made between start and stop in a global editing session', async () => {
		const session = createSession();

		const operationId = await session.startEdits([file]);
		expect(complete).not.toHaveBeenCalled();
		await session.stopEdits(operationId);

		expect(startEditingSession).toHaveBeenCalledWith(true);
		expect(startExternalEdits).toHaveBeenCalledWith(expect.anything(), operationId, [file], expect.any(String));
		expect(acceptResponseProgress).toHaveBeenCalledWith(expect.anything(), startProgress);
		expect(stopExternalEdits).toHaveBeenCalledWith(expect.anything(), operationId);
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it('does not track notebooks or untitled documents', async () => {
		const session = createSession();

		const operationId = await session.startEdits([notebook, untitled, file]);
		await session.stopEdits(await session.startEdits([notebook, untitled]));

		expect(startExternalEdits).toHaveBeenCalledTimes(1);
		expect(startExternalEdits).toHaveBeenCalledWith(expect.anything(), operationId, [file], expect.any(String));
		expect(stopExternalEdits).not.toHaveBeenCalled();
	});

	it('ends the edits in progress and keeps pending edits before releasing the chat model when disposed', async () => {
		const session = createSession();
		const operationId = await session.startEdits([file]);

		session.dispose();
		expect(disposeModel).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(disposeModel).toHaveBeenCalled());

		expect(stopExternalEdits).toHaveBeenCalledWith(expect.anything(), operationId);
		expect(complete).toHaveBeenCalledTimes(1);
		expect(accept).toHaveBeenCalledWith();
		expect(stopExternalEdits.mock.invocationCallOrder[0]).toBeLessThan(accept.mock.invocationCallOrder[0]);
	});

	it('reports each edited file, each change kept or undone, and how its edits were settled', () => {
		const session = createSession();
		const onDidChangeEntries = vi.fn();
		ctx.disposables.add(session.onDidChangeEntries(onDidChangeEntries));

		entries.set([stubInterface<IModifiedFileEntry>({ modifiedURI: file, originalURI: original, state: entryState, changesCount })], undefined);
		// Keeping one of two changes moves it into the baseline.
		baseline = 'x <- 2\n';
		changesCount.set(1, undefined);
		entryState.set(ModifiedFileEntryState.Rejected, undefined);
		entryState.set(ModifiedFileEntryState.Accepted, undefined);

		expect(onDidChangeEntries.mock.calls.map(([changed]) => changed)).toEqual([
			[{ uri: file, state: 'pending', baseline: 'x <- 1\n' }],
			[{ uri: file, state: 'pending', baseline: 'x <- 2\n' }],
			[{ uri: file, state: 'undone', baseline: undefined }],
			[{ uri: file, state: 'kept', baseline: undefined }],
		]);
	});

	it('keeps, undoes and shows the edits of the editing session', async () => {
		const session = createSession();

		await session.keep([file]);
		await session.undo();
		await session.show();

		expect(accept).toHaveBeenCalledWith(file);
		expect(reject).toHaveBeenCalledWith();
		expect(show).toHaveBeenCalled();
	});

	it('completes the response when the edits cannot be recorded', async () => {
		stopExternalEdits.mockRejectedValue(new Error('disk read failed'));
		const session = createSession();

		await expect(session.stopEdits(await session.startEdits([file]))).rejects.toThrow('disk read failed');

		expect(complete).toHaveBeenCalledTimes(1);
	});
});
