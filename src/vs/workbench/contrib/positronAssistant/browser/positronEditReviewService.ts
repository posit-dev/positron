/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { autorun } from '../../../../base/common/observable.js';
import { assertType } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IChatProgress, IChatService } from '../../chat/common/chatService/chatService.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { IChatEditingSession, ModifiedFileEntryState } from '../../chat/common/editing/chatEditingService.js';
import { ChatModel, ChatRequestModel } from '../../chat/common/model/chatModel.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfigurationKeys.js';
import { IPositronEditReviewEntry, IPositronEditReviewService, IPositronEditReviewSession } from '../common/positronEditReview.js';

const entryStates: Record<ModifiedFileEntryState, IPositronEditReviewEntry['state']> = {
	[ModifiedFileEntryState.Modified]: 'pending',
	[ModifiedFileEntryState.Accepted]: 'kept',
	[ModifiedFileEntryState.Rejected]: 'undone',
};

/**
 * Reviews edits with the chat editing UI, by recording them as the external
 * edits of a chat model that is never shown.
 */
class PositronEditReviewSession extends Disposable implements IPositronEditReviewSession {

	/** The request of each group of edits in progress, by operation id. */
	private readonly _operations = new Map<number, ChatRequestModel>();
	private _nextOperationId = 0;
	private readonly _model: ChatModel;
	private readonly _editingSession: IChatEditingSession;

	private readonly _onDidChangeEntries = this._register(new Emitter<readonly IPositronEditReviewEntry[]>());
	readonly onDidChangeEntries = this._onDidChangeEntries.event;

	constructor(
		chatService: IChatService,
		private readonly _notebookService: INotebookService,
		modelService: IModelService,
	) {
		super();
		const modelReference = this._register(chatService.startNewLocalSession(ChatAgentLocation.EditorInline));
		this._model = modelReference.object as ChatModel;
		// The editor overlay and inline diffs are only shown for global editing sessions.
		this._model.startEditingSession(true);
		assertType(this._model.editingSession);
		this._editingSession = this._model.editingSession;
		// Fires as each change is kept or undone, since that changes the number of changes.
		this._register(autorun(reader => this._onDidChangeEntries.fire(
			this._editingSession.entries.read(reader).map(entry => {
				const state = entryStates[entry.state.read(reader)];
				entry.changesCount.read(reader);
				return {
					uri: entry.modifiedURI,
					state,
					baseline: state === 'pending' ? modelService.getModel(entry.originalURI)?.getValue() : undefined,
				};
			})
		)));
	}

	async keep(resources: readonly URI[] = []): Promise<void> {
		await this._editingSession.accept(...resources);
	}

	async undo(resources: readonly URI[] = []): Promise<void> {
		await this._editingSession.reject(...resources);
	}

	async show(): Promise<void> {
		await this._editingSession.show();
	}

	async startEdits(resources: readonly URI[]): Promise<number> {
		const operationId = this._nextOperationId++;
		// Starting external edits saves the file, which prompts for a location
		// when it is untitled. The Positron notebook editor can't show pending edits.
		const tracked = resources.filter(resource =>
			resource.scheme !== Schemas.untitled && !this._notebookService.hasSupportedNotebooks(resource));
		if (tracked.length === 0) {
			return operationId;
		}

		// Each group of edits is its own request, so that edits can be kept
		// or undone between groups.
		const request = this._model.addRequest({ text: '', parts: [] }, { variables: [] }, 0);
		this._operations.set(operationId, request);
		try {
			assertType(request.response);
			this._acceptProgress(request, await this._editingSession.startExternalEdits(request.response, operationId, tracked, generateUuid()));
		} catch (error) {
			this._operations.delete(operationId);
			request.response?.complete();
			throw error;
		}
		return operationId;
	}

	async stopEdits(operationId: number): Promise<void> {
		const request = this._operations.get(operationId);
		if (!request) {
			return;
		}
		this._operations.delete(operationId);
		assertType(request.response);
		try {
			this._acceptProgress(request, await this._editingSession.stopExternalEdits(request.response, operationId));
		} finally {
			request.response.complete();
		}
	}

	private _acceptProgress(request: ChatRequestModel, progress: IChatProgress[]): void {
		for (const part of progress) {
			this._model.acceptResponseProgress(request, part);
		}
	}

	override dispose(): void {
		// End the edits in progress first; each holds a lock on its files. Then
		// keep what is pending, so that no edits outlive their session.
		const stopping = Array.from(this._operations.keys(), operationId => this.stopEdits(operationId));
		Promise.allSettled(stopping)
			.then(() => this._editingSession.accept())
			.finally(() => super.dispose());
	}
}

export class PositronEditReviewService implements IPositronEditReviewService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IChatService private readonly _chatService: IChatService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IModelService private readonly _modelService: IModelService,
	) { }

	createSession(): IPositronEditReviewSession {
		if (this._configurationService.getValue<boolean>(AI_ENABLED_KEY) !== true) {
			throw new Error('AI features are disabled');
		}
		return new PositronEditReviewSession(this._chatService, this._notebookService, this._modelService);
	}
}

registerSingleton(IPositronEditReviewService, PositronEditReviewService, InstantiationType.Delayed);
