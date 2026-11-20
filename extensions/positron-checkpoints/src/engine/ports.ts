/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RejectedReason } from './types';

export interface GitResult { stdout: string; stderr: string; exitCode: number; timedOut: boolean }
export interface GitOptions {
	env?: Record<string, string>;
	stdin?: string | Uint8Array;
	binary?: boolean;
	timeoutMs?: number;
	/**
	 * An absolute file path. Git's output is written to this file as it arrives (the file is
	 * created or emptied first, and flushed to disk at the end), and the result's `stdout` is
	 * empty. A failure to open or write the file rejects.
	 */
	stdoutToFile?: string;
}
export type GitRunner = (args: string[], options?: GitOptions) => Promise<GitResult>;
export interface FilePort {
	read(path: string): Promise<Uint8Array | undefined>;
	/**
	 * Replaces whatever file or link is at `path` with a new file: the content goes to a new file
	 * beside it, which is renamed over `path`, so another name of the old file keeps the old
	 * content. An existing file's permission bits are kept, apart from the executable bit; a new
	 * file follows the umask.
	 */
	write(path: string, content: Uint8Array, executable: boolean): Promise<void>;
	/**
	 * Creates a symbolic link to `target` at `path`, only when nothing exists at `path`. Returns
	 * false, and changes nothing, when something exists. The check and the creation are one step.
	 */
	createLinkExclusive(path: string, target: string): Promise<boolean>;
	remove(path: string): Promise<void>;
	/** Removes a directory only when it is empty. Returns false when it is not empty or does not exist. */
	removeEmptyDirectory(path: string): Promise<boolean>;
	/**
	 * Renames `from` to `to`, replacing a file at `to`. When the two are on different file
	 * systems, `from` is copied (with its permission bits) to a new name beside `to`, that copy is
	 * renamed to `to`, and `from` is removed.
	 */
	move(from: string, to: string): Promise<void>;
	/**
	 * Gives the file at `from` the second name `to` (a hard link), so `to` keeps the original
	 * bytes and permission bits after `from` is replaced. Where a hard link is not possible (`to`
	 * is on another file system), `to` is a copy with the same permission bits. A symbolic link is
	 * copied as a link. Fails when something exists at `to`.
	 */
	linkOrCopy(from: string, to: string): Promise<void>;
	/**
	 * Sets the permission bits of the file at `path` to those of the regular file at `like`, or
	 * keeps its own when `like` is undefined or is not a regular file, then sets or clears the
	 * executable bit. Setting it gives the owner the bit, and group and others the bit where they
	 * may read.
	 */
	setPermissions(path: string, executable: boolean, like?: string): Promise<void>;
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
export interface EnginePorts {
	git: GitRunner; files: FilePort; network: NetworkPort; now: () => Date; newId: () => string; projectRoot: string; openedFolder: string;
	/** Receives a description of each unexpected error that the engine facade turns into `could-not-finish`. */
	log?: (message: string) => void;
}
