/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * What the SQL analyzer's scripts need to know about Git LFS, which stores the built module.
 *
 * A checkout with git-lfs installed has the module itself at `resources/sql-analyzer.wasm`. One
 * without it has a pointer there instead: three lines naming the module by its SHA-256 and size.
 * `fetch-analyzer.mts` turns a pointer into the module; `build-analyzer.mts --check` reads the
 * hash off a pointer rather than needing the module to have been fetched.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const extensionDir = path.dirname(import.meta.dirname);

/** The built module, as the extension loads it. */
export const modulePath = path.join(extensionDir, 'resources', 'sql-analyzer.wasm');

/** The module's path from the repository root, as git and `.gitattributes` name it. */
export const moduleRepoPath = 'extensions/positron-sql/resources/sql-analyzer.wasm';

/** The object a pointer names. */
export interface LfsPointer {
	/** The SHA-256 of the object, in hex. */
	readonly oid: string;
	readonly size: number;
}

/** Larger than any pointer, and far smaller than the module: anything bigger is not one. */
const POINTER_LIMIT = 1024;

const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:(?<oid>[0-9a-f]{64})\nsize (?<size>\d+)\n?$/;

/** The object some bytes point to, if they are an LFS pointer rather than the object itself. */
export function parsePointer(bytes: Uint8Array): LfsPointer | undefined {
	if (bytes.length > POINTER_LIMIT) {
		return undefined;
	}
	const match = POINTER.exec(new TextDecoder().decode(bytes));
	return match?.groups ? { oid: match.groups.oid, size: Number(match.groups.size) } : undefined;
}

/** The object a file points to, if it is an LFS pointer. */
export function readPointer(file: string): LfsPointer | undefined {
	return parsePointer(fs.readFileSync(file));
}

/** Runs git in the extension directory; `undefined` when it is not installed or fails. */
export function git(args: string[], input?: Uint8Array): Buffer | undefined {
	const result = spawnSync('git', args, { cwd: extensionDir, input, shell: false });
	return result.status === 0 ? result.stdout : undefined;
}

/** Whether git-lfs is installed, which is what decides whether git can fetch the module itself. */
export function hasGitLfs(): boolean {
	return git(['lfs', 'version']) !== undefined;
}
