/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RejectedReason } from './types';

export interface GitResult { stdout: string; stderr: string; exitCode: number; timedOut: boolean }
export type GitRunner = (args: string[], options?: { env?: Record<string, string>; stdin?: string | Uint8Array; binary?: boolean; timeoutMs?: number }) => Promise<GitResult>;
export interface FilePort {
	read(path: string): Promise<Uint8Array | undefined>;
	write(path: string, content: Uint8Array, executable: boolean): Promise<void>;
	/** Replaces whatever file or link is at `path` with a symbolic link to `target`. */
	writeLink(path: string, target: string): Promise<void>;
	remove(path: string): Promise<void>;
	/** Removes a directory only when it is empty. Returns false when it is not empty or does not exist. */
	removeEmptyDirectory(path: string): Promise<boolean>;
	move(from: string, to: string): Promise<void>;
	stat(path: string): Promise<{ sizeBytes: number; isDirectory: boolean } | undefined>;
	/** Like `stat`, but describes a symbolic link itself instead of its target. */
	lstat(path: string): Promise<{ sizeBytes: number; isDirectory: boolean; isSymbolicLink: boolean; mtimeMs: number } | undefined>;
	/**
	 * Copies a file and gives the copy the modification time of the original (rounded down to a
	 * millisecond). Git treats an index entry as unverified when its file time is not older than
	 * the index file, so a copy of an index needs the time of the original to keep that check.
	 * Replaces an existing file at `to`.
	 */
	copyKeepingTime(from: string, to: string): Promise<void>;
	appendDurable(path: string, line: string): Promise<void>;
	/**
	 * Creates a file with `content` and flushes it to disk, only when no file exists at `path`.
	 * Returns false, and changes nothing, when one exists. The check and the creation are one step.
	 */
	createExclusive(path: string, content: string): Promise<boolean>;
	caseInsensitive(): Promise<boolean>;
}
export type NetworkResult = { ok: true } | { ok: false; reason: RejectedReason; detail: string };
export interface NetworkPort { fetch(): Promise<NetworkResult>; push(branch: string): Promise<NetworkResult> }
export interface EnginePorts { git: GitRunner; files: FilePort; network: NetworkPort; now: () => Date; newId: () => string; projectRoot: string; openedFolder: string }
