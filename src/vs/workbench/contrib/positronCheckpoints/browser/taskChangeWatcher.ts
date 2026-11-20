/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableMap, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { IChangeSet } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { splitIntoChunksJob } from '../common/agent/splitIntoChunks.js';
import { DetectorEvent, TaskChangeDetector } from '../common/taskChangeDetector.js';
import { ICheckpointsAgentService } from './checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from './checkpointsSuggestionService.js';
import { projectRootUri } from './projectRoot.js';

/** How long typing in one file must pause before it counts as one edit of that file. */
export const EDIT_DEBOUNCE_MS = 2000;

/** The paths of the changed files, with the earlier name of a renamed one. */
function changedPathsOf(changes: IChangeSet): Set<string> {
	return new Set(changes.files.flatMap(file => file.oldPath !== undefined ? [file.path, file.oldPath] : [file.path]));
}

/**
 * Feeds the task-change detector (spec 7.1) and turns its signals into checkpoint suggestions.
 *
 * - An edit is a save of a file in the project, or typing in an open file of the project that
 *   pauses for `EDIT_DEBOUNCE_MS`. Whether the file is in the set of changed files comes from the
 *   change set, which is read again whenever the engine reports a change of state and before an
 *   edit counts as outside the set.
 * - Each read of the change set reports its size. A new latest checkpoint reports that a
 *   checkpoint was created and closes the open suggestion, and a change set with another basis
 *   than the suggestion's closes it too.
 * - On a signal, while the agent is available, the "split into chunks" job runs. When at least one
 *   chunk looks finished, the suggestion is published for the view. Nothing else is shown: never
 *   a notification.
 * - A signal that does not lead to a published suggestion is retracted, so that it does not use up
 *   the wait between suggestions.
 * - A dismissal of the suggestion is reported to the detector, which doubles its wait.
 */
export class TaskChangeWatcher extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronCheckpointsTaskChangeWatcher';

	private readonly _detector = new TaskChangeDetector();

	/** The project root, while the project is tracked and in no unusual state. */
	private _root: URI | undefined;
	/** The latest change set, while `_root` is set. */
	private _changes: IChangeSet | undefined;
	/** The paths of the changed files, with the earlier name of a renamed one. */
	private _changedPaths = new Set<string>();
	/** The id of the latest checkpoint, once read. Undefined in `_latestCheckpoint` means no checkpoint. */
	private _latestCheckpoint: { id: string | undefined } | undefined;
	/** Counts reads of the state, so that only the latest one applies. */
	private _reads = 0;
	/** The running "split into chunks" job. */
	private _job: CancellationTokenSource | undefined;

	/** Change listeners of the open text models, by resource. */
	private readonly _modelListeners = this._register(new DisposableMap<string>());
	/** Typing that waits for its pause, by resource. */
	private readonly _pendingEdits = this._register(new DisposableMap<string>());

	constructor(
		@ICheckpointsService private readonly _checkpointsService: ICheckpointsService,
		@ICheckpointsAgentService private readonly _agentService: ICheckpointsAgentService,
		@ICheckpointsSuggestionService private readonly _suggestionService: ICheckpointsSuggestionService,
		@ITextFileService textFileService: ITextFileService,
		@IModelService modelService: IModelService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(toDisposable(() => this._job?.dispose(true)));

		this._register(textFileService.files.onDidSave(event => {
			const resource = event.model.resource;
			this._pendingEdits.deleteAndDispose(resource.toString());
			this._edited(resource);
		}));

		for (const model of modelService.getModels()) {
			this._watchModel(model);
		}
		this._register(modelService.onModelAdded(model => this._watchModel(model)));
		this._register(modelService.onModelRemoved(model => {
			this._modelListeners.deleteAndDispose(model.uri.toString());
			this._pendingEdits.deleteAndDispose(model.uri.toString());
		}));

		this._register(this._suggestionService.onDidDismiss(() => this._handle({ type: 'dismissed', time: Date.now() })));
		this._register(this._agentService.onDidChangeAvailable(() => {
			if (!this._agentService.available) {
				this._suggestionService.clear();
			}
		}));
		this._register(this._checkpointsService.onDidChangeEngine(() => void this._read()));
		this._register(this._checkpointsService.onDidChangeState(() => void this._read()));
		void this._read();
	}

	private _watchModel(model: ITextModel): void {
		const resource = model.uri;
		this._modelListeners.set(resource.toString(), model.onDidChangeContent(() => {
			if (!this._inProject(resource)) {
				return;
			}
			// Each change restarts the wait for this file.
			this._pendingEdits.set(resource.toString(), disposableTimeout(() => {
				this._pendingEdits.deleteAndLeak(resource.toString());
				this._edited(resource);
			}, EDIT_DEBOUNCE_MS));
		}));
	}

	private _inProject(resource: URI): boolean {
		return this._root !== undefined && this._uriIdentityService.extUri.isEqualOrParent(resource, this._root);
	}

	/** Reports an edit of `resource` when it is a file in the project. */
	private _edited(resource: URI): void {
		if (!this._root || !this._inProject(resource)) {
			return;
		}
		const path = this._uriIdentityService.extUri.relativePath(this._root, resource);
		if (!path || path === '.git' || path.startsWith('.git/')) {
			return;
		}
		const time = Date.now();
		if (this._changedPaths.has(path)) {
			this._handle({ type: 'edit', path, inChangedSet: true, time });
			return;
		}
		void this._editedOutsideKnownSet(path, time);
	}

	/**
	 * Reports an edit of a file that is not in the last known set of changed files. The set is
	 * read again once first, since the file may have changed after the last read.
	 */
	private async _editedOutsideKnownSet(path: string, time: number): Promise<void> {
		const root = this._root;
		const engine = this._checkpointsService.engine;
		if (engine) {
			try {
				const changes = await engine.getChanges();
				if (this._store.isDisposed || this._root !== root) {
					return;
				}
				this._changes = changes;
				this._changedPaths = changedPathsOf(changes);
			} catch (error) {
				if (this._store.isDisposed) {
					return;
				}
				this._logService.error('The checkpoint suggestions could not read the changed files.', error);
			}
		}
		this._handle({ type: 'edit', path, inChangedSet: this._changedPaths.has(path), time });
	}

	/** Reads the state, the change set, and the latest checkpoint, and reports what changed. */
	private async _read(): Promise<void> {
		const read = ++this._reads;
		const engine = this._checkpointsService.engine;
		if (!engine) {
			this._forget();
			return;
		}
		try {
			const state = await engine.getState();
			if (read !== this._reads || this._store.isDisposed) {
				return;
			}
			if (state.tracking !== 'tracking' || state.unusual) {
				this._forget();
				return;
			}
			const [changes, history] = await Promise.all([engine.getChanges(), engine.getHistory(0, 1)]);
			if (read !== this._reads || this._store.isDisposed) {
				return;
			}
			this._apply(state.projectRoot, changes, history[0]?.id);
		} catch (error) {
			if (!this._store.isDisposed) {
				this._logService.error('The checkpoint suggestions could not read the project.', error);
			}
		}
	}

	private _apply(projectRoot: string, changes: IChangeSet, latestCheckpoint: string | undefined): void {
		const time = Date.now();
		this._root = projectRootUri(this._workspaceContextService, projectRoot);
		this._changes = changes;
		this._changedPaths = changedPathsOf(changes);

		if (this._latestCheckpoint && this._latestCheckpoint.id !== latestCheckpoint) {
			this._detector.handle({ type: 'checkpoint-created', time });
			this._suggestionService.clear();
		}
		this._latestCheckpoint = { id: latestCheckpoint };

		const suggestion = this._suggestionService.current;
		if (suggestion && suggestion.changes.basis !== changes.basis) {
			this._suggestionService.clear();
		}

		const lines = changes.files.reduce((total, file) => total + file.hunks.reduce((sum, hunk) => sum + hunk.addedLines + hunk.removedLines, 0), 0);
		this._handle({ type: 'changes', lines, files: changes.files.length, time });
	}

	/** Stops watching a project that is gone, not tracked, or in an unusual state. */
	private _forget(): void {
		this._root = undefined;
		this._changes = undefined;
		this._changedPaths = new Set();
		this._latestCheckpoint = undefined;
		this._pendingEdits.clearAndDisposeAll();
		this._suggestionService.clear();
	}

	private _handle(event: DetectorEvent): void {
		if (this._detector.handle(event) === 'signal') {
			void this._suggestOrRetract(event.time);
		}
	}

	/**
	 * Suggests, and retracts the signal at `time` when no job started. A job that ran keeps the gap
	 * spent whatever it gave, so a large change set does not start a model call on every save.
	 */
	private async _suggestOrRetract(time: number): Promise<void> {
		const changes = this._changes;
		if (!changes || this._job || !this._agentService.available || this._suggestionService.current?.changes.basis === changes.basis) {
			this._detector.retract(time);
			return;
		}
		try {
			await this._suggest(changes);
		} catch (error) {
			if (!this._store.isDisposed) {
				this._logService.error('The checkpoint suggestion failed.', error);
			}
		}
	}

	/**
	 * Runs the "split into chunks" job on `changes`, and publishes the proposal when a chunk looks
	 * finished and the changes are still the same.
	 */
	private async _suggest(changes: IChangeSet): Promise<void> {
		const source = new CancellationTokenSource();
		this._job = source;
		try {
			const outcome = await this._agentService.run(splitIntoChunksJob, changes, source.token);
			if (source.token.isCancellationRequested || !outcome.ok || !this._agentService.available || this._changes?.basis !== changes.basis) {
				return;
			}
			if (outcome.value.chunks.some(chunk => chunk.finished)) {
				this._suggestionService.publish({ changes, chunks: outcome.value.chunks });
			}
		} finally {
			if (this._job === source) {
				this._job = undefined;
			}
			source.dispose();
		}
	}
}
