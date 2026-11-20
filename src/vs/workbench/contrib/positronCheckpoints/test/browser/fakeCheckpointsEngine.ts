/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import {
	CheckpointsMethod, ContentRef, DiffTarget, ICheckpoint, ICheckpointsEngineProxy, IChangedFile, IChangeSet, IChunk, ICollisionChoice,
	IEngineState, IIncomingPreview, IKeptFile, IResolution, OperationResult
} from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';

/** A tracked project with a shared copy, up to date, in no unusual state. */
export function fakeEngineState(overrides: Partial<IEngineState> = {}): IEngineState {
	return {
		tracking: 'tracking',
		projectName: 'dose-model',
		projectRoot: '/work/dose-model',
		openedFolderIsInsideProject: false,
		branch: 'main',
		shared: { exists: true, ahead: 0, behind: 0 },
		identityMissing: false,
		syncAvailable: true,
		requiredGitVersion: '2.40',
		pendingOverlap: false,
		recoverySnapshots: [],
		keptFileCount: 0,
		...overrides,
	};
}

/** One checkpoint for a history list. */
export function fakeCheckpoint(overrides: Partial<ICheckpoint> = {}): ICheckpoint {
	return {
		id: 'c1',
		title: 'First version of the dose model',
		body: '',
		authorName: 'You',
		authorIsMe: true,
		time: '2026-11-19T10:00:00Z',
		shared: true,
		partialFiles: [],
		...overrides,
	};
}

/** One call made to the fake engine. */
export interface IFakeEngineCall {
	method: CheckpointsMethod;
	args: unknown[];
}

/**
 * A checkpoints engine for view tests. The test sets `state`, `changes`, `history`, `checkpointFiles`, `pendingFiles`,
 * `keptFiles`, `diff`, `blobs`, `incoming`, `nextResult`, `queuedResults`, and `readError`; every call is recorded in
 * `calls`; `fireChange()` fires the state event.
 * `holdGetState()` makes the next `getState` wait until the test releases it.
 */
export class FakeCheckpointsEngine extends Disposable implements ICheckpointsEngineProxy {
	state: IEngineState = fakeEngineState();
	changes: IChangeSet = { basis: 'basis-1', files: [] };
	history: ICheckpoint[] = [];
	/** The files of each checkpoint, by checkpoint id. Other ids have none. */
	checkpointFiles = new Map<string, IChangedFile[]>();
	/** The files of each pending approval, by token. Other tokens have none. */
	pendingFiles = new Map<string, IChangedFile[]>();
	/**
	 * When set, every read method (`getState`, `getHistory`, `getChanges`, `getCheckpointFiles`,
	 * `getPendingFiles`, `getDiff`, `readBlob`, `previewIncoming`) fails with this error, as the
	 * engine's read methods do when git does not answer in time.
	 */
	readError?: Error;
	keptFiles: IKeptFile[] = [];
	/** When set, `getKeptFiles` fails with this error. */
	keptFilesError?: Error;
	/** The answer to `getDiff`. Without it, the left side is empty and the right side is the file (empty for an overlap). */
	diff?: { left: ContentRef; right: ContentRef };
	/** The content `readBlob` returns for each blob id. Other ids read as empty. */
	blobs = new Map<string, VSBuffer>();
	gitignore = '.Rhistory\n';
	/** The result of every operation, unless `queuedResults` has one. */
	nextResult: OperationResult = { kind: 'done', operationId: 'op-1', hookEditedFiles: [] };
	/** Results given to the next operations, first in first out, before `nextResult`. */
	queuedResults: OperationResult[] = [];
	/** The answer to `previewIncoming`. */
	incoming: IIncomingPreview = { basis: 'basis-1', incoming: [], changedPaths: [], touchesLocalWork: false, overlaps: [], collisions: [] };

	readonly calls: IFakeEngineCall[] = [];

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private _heldStates: Promise<IEngineState>[] = [];

	/** Fires the state event, as the engine does after any change. */
	fireChange(): void {
		this._onDidChangeState.fire();
	}

	/**
	 * Makes the next `getState` call wait. The returned function answers it with the given state.
	 */
	holdGetState(): (state: IEngineState) => void {
		let release!: (state: IEngineState) => void;
		this._heldStates.push(new Promise<IEngineState>(resolve => { release = resolve; }));
		return release;
	}

	/** The calls of one method, in order. */
	callsOf(method: CheckpointsMethod): unknown[][] {
		return this.calls.filter(call => call.method === method).map(call => call.args);
	}

	private _record(method: CheckpointsMethod, ...args: unknown[]): void {
		this.calls.push({ method, args });
	}

	/** Records a call of a read method, and fails it when `readError` is set. */
	private _read(method: CheckpointsMethod, ...args: unknown[]): void {
		this._record(method, ...args);
		if (this.readError) {
			throw this.readError;
		}
	}

	private async _operation(method: CheckpointsMethod, ...args: unknown[]): Promise<OperationResult> {
		this._record(method, ...args);
		return this.queuedResults.shift() ?? this.nextResult;
	}

	async getState(): Promise<IEngineState> {
		this._read('getState');
		const held = this._heldStates.shift();
		return held ? held : this.state;
	}

	async getHistory(skip: number, limit: number): Promise<ICheckpoint[]> {
		this._read('getHistory', skip, limit);
		return this.history.slice(skip, skip + limit);
	}

	async getChanges(): Promise<IChangeSet> {
		this._read('getChanges');
		return this.changes;
	}

	async getCheckpointFiles(id: string): Promise<IChangedFile[]> {
		this._read('getCheckpointFiles', id);
		return this.checkpointFiles.get(id) ?? [];
	}

	async getPendingFiles(token: string): Promise<IChangedFile[]> {
		this._read('getPendingFiles', token);
		return this.pendingFiles.get(token) ?? [];
	}

	async getDiff(target: DiffTarget): Promise<{ left: ContentRef; right: ContentRef }> {
		this._read('getDiff', target);
		return this.diff ?? { left: { kind: 'empty' }, right: target.kind === 'overlap' ? { kind: 'empty' } : { kind: 'file', path: target.path } };
	}

	async readBlob(oid: string): Promise<VSBuffer> {
		this._read('readBlob', oid);
		return this.blobs.get(oid) ?? VSBuffer.fromString('');
	}

	createCheckpoints(basis: string, chunks: IChunk[]): Promise<OperationResult> {
		return this._operation('createCheckpoints', basis, chunks);
	}

	acceptCheckedCheckpoint(token: string): Promise<OperationResult> {
		return this._operation('acceptCheckedCheckpoint', token);
	}

	declineCheckedCheckpoint(token: string): Promise<OperationResult> {
		return this._operation('declineCheckedCheckpoint', token);
	}

	editDescription(id: string, title: string, body: string): Promise<OperationResult> {
		return this._operation('editDescription', id, title, body);
	}

	reverseCheckpoint(id: string): Promise<OperationResult> {
		return this._operation('reverseCheckpoint', id);
	}

	checkShared(): Promise<OperationResult> {
		return this._operation('checkShared');
	}

	async previewIncoming(): Promise<IIncomingPreview> {
		this._read('previewIncoming');
		return this.incoming;
	}

	getIncoming(basis: string, resolutions: IResolution[], collisionChoices: ICollisionChoice[]): Promise<OperationResult> {
		return this._operation('getIncoming', basis, resolutions, collisionChoices);
	}

	sendChanges(): Promise<OperationResult> {
		return this._operation('sendChanges');
	}

	goBackTo(id: string, collisionChoices: ICollisionChoice[]): Promise<OperationResult> {
		return this._operation('goBackTo', id, collisionChoices);
	}

	undo(operationId: string, collisionChoices: ICollisionChoice[]): Promise<OperationResult> {
		return this._operation('undo', operationId, collisionChoices);
	}

	redo(operationId: string, collisionChoices: ICollisionChoice[]): Promise<OperationResult> {
		return this._operation('redo', operationId, collisionChoices);
	}

	async getKeptFiles(): Promise<IKeptFile[]> {
		this._record('getKeptFiles');
		if (this.keptFilesError) {
			throw this.keptFilesError;
		}
		return this.keptFiles;
	}

	restoreKeptFile(id: string, destination?: string): Promise<OperationResult> {
		return this._operation('restoreKeptFile', id, destination);
	}

	deleteKeptFile(id: string): Promise<OperationResult> {
		return this._operation('deleteKeptFile', id);
	}

	resolveInterrupted(choice: 'reverse-keep-newer' | 'leave-as-is'): Promise<OperationResult> {
		return this._operation('resolveInterrupted', choice);
	}

	async removeRecoverySnapshot(operationId: string): Promise<void> {
		this._record('removeRecoverySnapshot', operationId);
	}

	startTracking(identity?: { name: string; email: string }, gitignore?: string): Promise<OperationResult> {
		return this._operation('startTracking', identity, gitignore);
	}

	async proposedGitignore(): Promise<string> {
		this._record('proposedGitignore');
		return this.gitignore;
	}

	connectSharedCopy(url: string): Promise<OperationResult> {
		return this._operation('connectSharedCopy', url);
	}
}
