/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export type UnusualKind = 'detached' | 'operation-in-progress' | 'staged-differs' | 'unrecovered' | 'git-missing';
export type OperationKind = 'create-checkpoints' | 'edit-description' | 'get-changes' | 'go-back' | 'reverse-checkpoint' | 'check-changed-files' | 'start-tracking' | 'send-changes';

export interface EngineState {
	tracking: 'not-a-project' | 'tracking';
	projectName: string;
	projectRoot: string;
	openedFolderIsInsideProject: boolean;
	branch?: string;
	/** `name` is the shared copy's branch as git names it (for example `origin/main`). */
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
	/** `restoresFiles` is true when undoing or redoing the operation changes working files. */
	undo?: { operationId: string; description: string; kind: OperationKind; restoresFiles: boolean };
	redo?: { operationId: string; description: string; kind: OperationKind; restoresFiles: boolean };
	keptFileCount: number;
}

export interface Hunk { id: string; header: string; addedLines: number; removedLines: number; patch: string }
export interface ChangedFile {
	path: string; oldPath?: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	binary: boolean; sizeBytes: number; tooLarge: boolean;
	hunks: Hunk[];
}
export interface ChangeSet { basis: string; files: ChangedFile[] }
export interface Chunk { title: string; body: string; hunkIds: string[]; wholeFiles: string[] }

export interface Checkpoint {
	id: string; title: string; body: string;
	authorName: string; authorIsMe: boolean; time: string;
	shared: boolean; partialFiles: string[];
}

export type ContentRef = { kind: 'empty' } | { kind: 'file'; path: string } | { kind: 'blob'; oid: string };
export type DiffTarget =
	| { kind: 'change'; path: string; oldPath?: string }
	| { kind: 'checkpoint'; id: string; path: string }
	| { kind: 'incoming'; path: string }
	| { kind: 'trees'; left: string; right: string; path: string }
	| { kind: 'pending'; token: string; path: string }
	| { kind: 'overlap'; overlapId: string; side: 'mine' | 'theirs' };

export type OverlapKind = 'text' | 'binary' | 'edit-delete' | 'rename' | 'file-folder' | 'unsupported';
export interface Overlap {
	id: string; kind: OverlapKind; path: string; otherPaths: string[];
	base?: string; mine?: string; theirs?: string;
	mineSizeBytes?: number; theirsSizeBytes?: number;
	deletedBy?: 'me' | 'them'; theirAuthor: string; detail: string;
	/** For a `file-folder` overlap: the side that has the file. */
	fileSide?: 'mine' | 'theirs';
}
export type OverlapChoice =
	| { type: 'text'; content: string }
	| { type: 'take'; side: 'mine' | 'theirs' }
	| { type: 'keep-both'; renamedSide: 'mine' | 'theirs'; newPath: string }
	| { type: 'keep-file' } | { type: 'accept-deletion' }
	| { type: 'path'; keepPath: string };
export interface Resolution { overlapId: string; choice: OverlapChoice }

export interface PathCollision { path: string; reason: 'ignored' | 'too-large'; sizeBytes: number; incomingAuthor?: string }
export interface CollisionChoice { path: string; choice: 'use-theirs-keep-copy' }
export interface KeptFile { id: string; originalPath: string; sizeBytes: number; time: string; action: string }

export interface IncomingPreview {
	basis: string;
	incoming: Checkpoint[];
	changedPaths: string[];
	touchesLocalWork: boolean;
	overlaps: Overlap[];
	collisions: PathCollision[];
}

export type UnavailableReason = 'busy' | 'unusual-state' | 'git-too-old' | 'not-tracking' | 'stale-operation-id' | 'not-undoable' | 'shared-checkpoint' | 'timed-out' | 'nothing-to-do' | 'occupied';
export type RejectedReason = 'shared-copy-moved' | 'review-required' | 'sign-in-required' | 'no-shared-copy' | 'offline' | 'unknown';

export type OperationResult =
	| { kind: 'done'; operationId: string; hookEditedFiles: string[] }
	| { kind: 'check-failed'; output: string; hookEditedFiles: string[]; operationId?: string; chunkIndex?: number }
	| { kind: 'check-changed-checkpoint'; token: string; changedPaths: string[]; hookEditedFiles: string[]; chunkIndex?: number }
	| { kind: 'path-collisions'; collisions: PathCollision[] }
	| { kind: 'overlaps'; preview: IncomingPreview }
	| { kind: 'inputs-changed'; changed: ('mine' | 'shared' | 'files')[]; preview: IncomingPreview }
	| { kind: 'changes-moved' }
	| { kind: 'project-changed' }
	| { kind: 'rejected'; reason: RejectedReason; detail: string }
	| { kind: 'could-not-finish'; detail: string }
	| { kind: 'interrupted' }
	| { kind: 'unavailable'; reason: UnavailableReason; detail?: string };

export interface CheckpointsEngine {
	getState(): Promise<EngineState>;
	getHistory(skip: number, limit: number): Promise<Checkpoint[]>;
	getChanges(): Promise<ChangeSet>;
	getCheckpointFiles(id: string): Promise<ChangedFile[]>;
	getPendingFiles(token: string): Promise<ChangedFile[]>;
	getDiff(target: DiffTarget): Promise<{ left: ContentRef; right: ContentRef }>;
	readBlob(oid: string): Promise<Uint8Array>;
	createCheckpoints(basis: string, chunks: Chunk[]): Promise<OperationResult>;
	acceptCheckedCheckpoint(token: string): Promise<OperationResult>;
	declineCheckedCheckpoint(token: string): Promise<OperationResult>;
	editDescription(id: string, title: string, body: string): Promise<OperationResult>;
	reverseCheckpoint(id: string): Promise<OperationResult>;
	checkShared(): Promise<OperationResult>;
	previewIncoming(): Promise<IncomingPreview>;
	getIncoming(basis: string, resolutions: Resolution[], collisionChoices: CollisionChoice[]): Promise<OperationResult>;
	sendChanges(): Promise<OperationResult>;
	goBackTo(id: string, collisionChoices: CollisionChoice[]): Promise<OperationResult>;
	undo(operationId: string, collisionChoices: CollisionChoice[]): Promise<OperationResult>;
	redo(operationId: string, collisionChoices: CollisionChoice[]): Promise<OperationResult>;
	getKeptFiles(): Promise<KeptFile[]>;
	restoreKeptFile(id: string, destination?: string): Promise<OperationResult>;
	deleteKeptFile(id: string): Promise<OperationResult>;
	resolveInterrupted(choice: 'reverse-keep-newer' | 'leave-as-is'): Promise<OperationResult>;
	removeRecoverySnapshot(operationId: string): Promise<void>;
	startTracking(identity?: { name: string; email: string }, gitignore?: string): Promise<OperationResult>;
	proposedGitignore(): Promise<string>;
	connectSharedCopy(url: string): Promise<OperationResult>;
	onDidChangeState(listener: () => void): { dispose(): void };
}
