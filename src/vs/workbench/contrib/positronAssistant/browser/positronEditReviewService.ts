/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { Schemas } from '../../../../base/common/network.js';
import { autorun, observableValue } from '../../../../base/common/observable.js';
import { assertType } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IChatProgress, IChatService } from '../../chat/common/chatService/chatService.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { IChatEditingSession, IModifiedFileEntry, ModifiedFileEntryState } from '../../chat/common/editing/chatEditingService.js';
import { ChatModel, ChatRequestModel } from '../../chat/common/model/chatModel.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfigurationKeys.js';
import { changeStates, IChange } from '../common/editAttribution.js';
import { IPositronEditReviewEntry, IPositronEditReviewService, IPositronEditReviewSession } from '../common/positronEditReview.js';

const entryStates: Record<ModifiedFileEntryState, IPositronEditReviewEntry['state']> = {
	[ModifiedFileEntryState.Modified]: 'pending',
	[ModifiedFileEntryState.Accepted]: 'kept',
	[ModifiedFileEntryState.Rejected]: 'undone',
};

type TrackedEdit = IPositronEditReviewEntry['edits'][number];

/** A group of edits in progress. */
interface IOperation {
	readonly request: ChatRequestModel;
	readonly resources: readonly URI[];
	/** The text of each of `resources` before the edits, once read; undefined while it does not exist. */
	before?: readonly (string | undefined)[];
}

/** The edits to one file. */
interface ITrackedFile {
	/** The changes awaiting review, oldest first. */
	pending: (IChange & { readonly operationId: number })[];
	/** What became of the changes reviewed so far. */
	readonly settled: TrackedEdit[];
	/** The states of `pending`, and the texts they were worked out from. */
	cache?: { readonly key: string; readonly edits: readonly TrackedEdit[] };
}

/**
 * Reviews edits with the chat editing UI, by recording them as the external
 * edits of a chat model that is never shown.
 */
class PositronEditReviewSession extends Disposable implements IPositronEditReviewSession {

	/** The groups of edits in progress, by operation id. */
	private readonly _operations = new Map<number, IOperation>();
	private _nextOperationId = 0;
	private readonly _files = new ResourceMap<ITrackedFile>();
	/** Changes when edits are recorded, so that the entries are reported again. */
	private readonly _recorded = observableValue(this, 0);
	private readonly _model: ChatModel;
	private readonly _editingSession: IChatEditingSession;

	private readonly _onDidChangeEntries = this._register(new Emitter<readonly IPositronEditReviewEntry[]>());
	readonly onDidChangeEntries = this._onDidChangeEntries.event;

	constructor(
		chatService: IChatService,
		private readonly _notebookService: INotebookService,
		private readonly _modelService: IModelService,
		private readonly _fileService: IFileService,
	) {
		super();
		const modelReference = this._register(chatService.startNewLocalSession(ChatAgentLocation.EditorInline));
		this._model = modelReference.object as ChatModel;
		// The editor overlay and inline diffs are only shown for global editing sessions.
		this._model.startEditingSession(true);
		assertType(this._model.editingSession);
		this._editingSession = this._model.editingSession;
		// Fires as each change is kept or undone, since that changes the number of changes.
		this._register(autorun(reader => {
			this._recorded.read(reader);
			this._onDidChangeEntries.fire(this._editingSession.entries.read(reader).map(entry => {
				const state = entryStates[entry.state.read(reader)];
				entry.changesCount.read(reader);
				return { uri: entry.modifiedURI, state, edits: this._edits(entry, state) };
			}));
		}));
	}

	/**
	 * What became of each group of edits' changes to the file of `entry`.
	 * Once its edits are settled, so are the states of its pending changes.
	 */
	private _edits(entry: IModifiedFileEntry, state: IPositronEditReviewEntry['state']): readonly TrackedEdit[] {
		const file = this._files.get(entry.modifiedURI);
		if (!file || file.pending.length === 0) {
			return file?.settled ?? [];
		}
		const currentModel = this._modelService.getModel(entry.modifiedURI);
		const baselineModel = state === 'pending' ? this._modelService.getModel(entry.originalURI) : undefined;
		const key = [state, file.pending.length, currentModel?.getVersionId(), baselineModel?.getVersionId()].join();
		if (file.cache?.key !== key) {
			const current = currentModel?.getValue() ?? '';
			// Undoing a file's creation deletes it, though its model may still hold the text.
			const states = state === 'undone' && file.pending[0].before === undefined
				? file.pending.map(() => 'undone' as const)
				: changeStates(file.pending, baselineModel?.getValue() ?? current, current);
			file.cache = { key, edits: file.pending.map(({ operationId }, i) => ({ operationId, state: states[i] })) };
		}
		if (state === 'pending') {
			return [...file.settled, ...file.cache.edits];
		}
		// Later edits to the file are reviewed afresh.
		file.settled.push(...file.cache.edits);
		file.pending = [];
		file.cache = undefined;
		return file.settled;
	}

	/** The text of `resource` on disk, or undefined when it does not exist. */
	private async _read(resource: URI): Promise<string | undefined> {
		try {
			return (await this._fileService.readFile(resource)).value.toString();
		} catch {
			return undefined;
		}
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
		const operation: IOperation = { request, resources: tracked };
		this._operations.set(operationId, operation);
		try {
			assertType(request.response);
			this._acceptProgress(request, await this._editingSession.startExternalEdits(request.response, operationId, tracked, generateUuid()));
			// Starting external edits saves the files first.
			operation.before = await Promise.all(tracked.map(resource => this._read(resource)));
		} catch (error) {
			this._operations.delete(operationId);
			request.response?.complete();
			throw error;
		}
		return operationId;
	}

	async stopEdits(operationId: number): Promise<void> {
		const operation = this._operations.get(operationId);
		if (!operation) {
			return;
		}
		this._operations.delete(operationId);
		const { request, resources, before } = operation;
		assertType(request.response);
		try {
			this._acceptProgress(request, await this._editingSession.stopExternalEdits(request.response, operationId));
			if (before) {
				this._record(operationId, resources, before, await Promise.all(resources.map(resource => this._read(resource))));
			}
		} finally {
			request.response.complete();
		}
	}

	/** Record the changes a group of edits made to `resources` as pending review. */
	private _record(operationId: number, resources: readonly URI[], before: readonly (string | undefined)[], after: readonly (string | undefined)[]): void {
		resources.forEach((resource, i) => {
			if (before[i] === after[i]) {
				return;
			}
			let file = this._files.get(resource);
			if (!file) {
				file = { pending: [], settled: [] };
				this._files.set(resource, file);
			}
			file.pending.push({ operationId, before: before[i], after: after[i] });
		});
		this._recorded.set(this._recorded.get() + 1, undefined);
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
		@IFileService private readonly _fileService: IFileService,
	) { }

	createSession(): IPositronEditReviewSession {
		if (this._configurationService.getValue<boolean>(AI_ENABLED_KEY) !== true) {
			throw new Error('AI features are disabled');
		}
		return new PositronEditReviewSession(this._chatService, this._notebookService, this._modelService, this._fileService);
	}
}

registerSingleton(IPositronEditReviewService, PositronEditReviewService, InstantiationType.Delayed);
