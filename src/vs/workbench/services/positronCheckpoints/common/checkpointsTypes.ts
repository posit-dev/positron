/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';

// The data types of a checkpoints engine, as core and the extension host protocol use them. They
// are structurally identical to the types in `extensions/positron-checkpoints/src/engine/types.ts`
// and to `namespace checkpoints` in `positron.d.ts`; `extHostCheckpoints.ts` passes values between
// the two, so the compiler reports any difference.

export type UnusualKind = 'detached' | 'operation-in-progress' | 'staged-differs' | 'unrecovered' | 'git-missing';
export type OperationKind = 'create-checkpoints' | 'edit-description' | 'get-changes' | 'go-back' | 'reverse-checkpoint' | 'check-changed-files' | 'start-tracking' | 'send-changes';

export interface IEngineState {
	tracking: 'not-a-project' | 'tracking';
	projectName: string;
	projectRoot: string;
	openedFolderIsInsideProject: boolean;
	branch?: string;
	shared: { exists: boolean; ahead: number; behind: number; lastChecked?: string; name?: string };
	identityMissing: boolean;
	syncAvailable: boolean;
	requiredGitVersion: '2.40';
	unusual?: { kind: UnusualKind; detail: string };
	pendingOverlap: boolean;
	pendingApproval?: { token: string; changedPaths: string[]; hookEditedFiles: string[] };
	interrupted?: { operationId: string; description: string; unexpectedPaths: string[]; indexUnexpected: boolean };
	recoveryNotice?: 'reversed' | 'completed';
	recoverySnapshots: { operationId: string; time: string }[];
	undo?: { operationId: string; description: string; kind?: OperationKind; restoresFiles?: boolean };
	redo?: { operationId: string; description: string; kind?: OperationKind; restoresFiles?: boolean };
	keptFileCount: number;
}

export interface IHunk { id: string; header: string; addedLines: number; removedLines: number; patch: string }
export interface IChangedFile {
	path: string; oldPath?: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	binary: boolean; sizeBytes: number; tooLarge: boolean;
	hunks: IHunk[];
}
export interface IChangeSet { basis: string; files: IChangedFile[] }
export interface IChunk { title: string; body: string; hunkIds: string[]; wholeFiles: string[] }

export interface ICheckpoint {
	id: string; title: string; body: string;
	authorName: string; authorIsMe: boolean; time: string;
	shared: boolean; partialFiles: string[];
}

export type ContentRef = { kind: 'empty' } | { kind: 'file'; path: string } | { kind: 'blob'; oid: string };
export type DiffTarget =
	| { kind: 'change'; path: string }
	| { kind: 'checkpoint'; id: string; path: string }
	| { kind: 'incoming'; path: string }
	| { kind: 'trees'; left: string; right: string; path: string }
	| { kind: 'pending'; token: string; path: string };

export type OverlapKind = 'text' | 'binary' | 'edit-delete' | 'rename' | 'file-folder' | 'unsupported';
export interface IOverlap {
	id: string; kind: OverlapKind; path: string; otherPaths: string[];
	base?: string; mine?: string; theirs?: string;
	mineSizeBytes?: number; theirsSizeBytes?: number;
	deletedBy?: 'me' | 'them'; theirAuthor: string; detail: string;
}
export type OverlapChoice =
	| { type: 'text'; content: string }
	| { type: 'take'; side: 'mine' | 'theirs' }
	| { type: 'keep-both'; renamedSide: 'mine' | 'theirs'; newPath: string }
	| { type: 'keep-file' } | { type: 'accept-deletion' }
	| { type: 'path'; keepPath: string };
export interface IResolution { overlapId: string; choice: OverlapChoice }

export interface IPathCollision { path: string; reason: 'ignored' | 'too-large'; sizeBytes: number; incomingAuthor?: string }
export interface ICollisionChoice { path: string; choice: 'use-theirs-keep-copy' }
export interface IKeptFile { id: string; originalPath: string; sizeBytes: number; time: string; action: string }

export interface IIncomingPreview {
	basis: string;
	incoming: ICheckpoint[];
	changedPaths: string[];
	touchesLocalWork: boolean;
	overlaps: IOverlap[];
	collisions: IPathCollision[];
}

export type UnavailableReason = 'busy' | 'unusual-state' | 'git-too-old' | 'not-tracking' | 'stale-operation-id' | 'not-undoable' | 'shared-checkpoint' | 'timed-out' | 'nothing-to-do' | 'occupied';
export type RejectedReason = 'shared-copy-moved' | 'review-required' | 'sign-in-required' | 'no-shared-copy' | 'offline' | 'unknown';

export type OperationResult =
	| { kind: 'done'; operationId: string; hookEditedFiles: string[] }
	| { kind: 'check-failed'; output: string; hookEditedFiles: string[]; operationId?: string }
	| { kind: 'check-changed-checkpoint'; token: string; changedPaths: string[]; hookEditedFiles: string[] }
	| { kind: 'path-collisions'; collisions: IPathCollision[] }
	| { kind: 'overlaps'; preview: IIncomingPreview }
	| { kind: 'inputs-changed'; changed: ('mine' | 'shared' | 'files')[]; preview: IIncomingPreview }
	| { kind: 'changes-moved' }
	| { kind: 'project-changed' }
	| { kind: 'rejected'; reason: RejectedReason; detail: string }
	| { kind: 'could-not-finish'; detail: string }
	| { kind: 'interrupted' }
	| { kind: 'unavailable'; reason: UnavailableReason; detail?: string };

/**
 * A registered checkpoints engine as core sees it. The methods match `CheckpointsEngine` in the
 * engine, except that `readBlob` returns a `VSBuffer` and `onDidChangeState` is an `Event`.
 */
export interface ICheckpointsEngineProxy {
	getState(): Promise<IEngineState>;
	getHistory(skip: number, limit: number): Promise<ICheckpoint[]>;
	getChanges(): Promise<IChangeSet>;
	getDiff(target: DiffTarget): Promise<{ left: ContentRef; right: ContentRef }>;
	readBlob(oid: string): Promise<VSBuffer>;
	createCheckpoints(basis: string, chunks: IChunk[]): Promise<OperationResult>;
	acceptCheckedCheckpoint(token: string): Promise<OperationResult>;
	declineCheckedCheckpoint(token: string): Promise<OperationResult>;
	editDescription(id: string, title: string, body: string): Promise<OperationResult>;
	reverseCheckpoint(id: string): Promise<OperationResult>;
	checkShared(): Promise<OperationResult>;
	previewIncoming(): Promise<IIncomingPreview>;
	getIncoming(basis: string, resolutions: IResolution[], collisionChoices: ICollisionChoice[]): Promise<OperationResult>;
	sendChanges(): Promise<OperationResult>;
	goBackTo(id: string, collisionChoices: ICollisionChoice[]): Promise<OperationResult>;
	undo(operationId: string, collisionChoices: ICollisionChoice[]): Promise<OperationResult>;
	redo(operationId: string, collisionChoices: ICollisionChoice[]): Promise<OperationResult>;
	getKeptFiles(): Promise<IKeptFile[]>;
	restoreKeptFile(id: string, destination?: string): Promise<OperationResult>;
	deleteKeptFile(id: string): Promise<OperationResult>;
	resolveInterrupted(choice: 'reverse-keep-newer' | 'leave-as-is'): Promise<OperationResult>;
	removeRecoverySnapshot(operationId: string): Promise<void>;
	startTracking(identity?: { name: string; email: string }, gitignore?: string): Promise<OperationResult>;
	proposedGitignore(): Promise<string>;
	/** Fires when any result of `getState()` or `getChanges()` may differ. */
	readonly onDidChangeState: Event<void>;
}

/** The name of an engine method that crosses the extension host protocol. */
export type CheckpointsMethod = Exclude<keyof ICheckpointsEngineProxy, 'onDidChangeState'>;

/** The arguments and the result of each engine method. */
export type CheckpointsMethodMap = {
	[M in CheckpointsMethod]: {
		args: Parameters<ICheckpointsEngineProxy[M]>;
		result: Awaited<ReturnType<ICheckpointsEngineProxy[M]>>;
	};
};

/** A call of one engine method, sent from the main thread to the extension host. */
export type ICheckpointsRequest = {
	[M in CheckpointsMethod]: { method: M; args: CheckpointsMethodMap[M]['args'] };
}[CheckpointsMethod];

/** The result of one engine method, returned by the extension host for an `ICheckpointsRequest`. */
export type ICheckpointsResponse = {
	[M in CheckpointsMethod]: { method: M; result: CheckpointsMethodMap[M]['result'] };
}[CheckpointsMethod];
