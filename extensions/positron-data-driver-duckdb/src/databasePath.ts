/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import type { PlatformPath } from 'path';

/**
 * The machine a database path is resolved on. Passed in rather than read here, so this module
 * imports nothing from `vscode` and the path rules of each platform can be tested on any platform.
 */
export interface IDatabasePathEnvironment {
	// The path library for the platform the database file lives on (`path` itself, in production).
	readonly pathLib: PlatformPath;

	// The user's home folder, used to expand a leading `~/` on macOS and Linux.
	readonly homedir: string;

	// The file system paths of the open workspace folders, in order.
	readonly workspaceFolderPaths: readonly string[];

	// Whether a file or folder exists at the given path.
	readonly exists: (filePath: string) => boolean;
}

/**
 * Identifies a kind of database file by the bytes at a fixed offset in its header.
 */
export interface IDatabaseFileSignature {
	// The bytes the header carries.
	readonly magic: Uint8Array;

	// The offset of the bytes in the file.
	readonly offset: number;

	// Whether an empty file is a valid (empty) database of this kind.
	readonly allowEmpty: boolean;
}

/**
 * The outcome of checking a database file:
 * - `valid`: the file exists and nothing shows it is the wrong kind. This includes a file that
 *   exists but cannot be read (for example, a Windows file another process holds open), since
 *   connecting reports the actual problem better than a guess made here.
 * - `missing`: nothing exists at the path.
 * - `notFile`: the path names a folder or other non-file.
 * - `wrongKind`: the file's header does not carry the expected signature.
 */
export type DatabaseFileCheck = 'valid' | 'missing' | 'notFile' | 'wrongKind';

/**
 * Resolves a user-entered database path to an absolute path.
 * @param filePath The path as entered.
 * @param environment The machine the path is resolved on.
 * @returns The absolute path, or the path as entered (trimmed) when it is relative and no
 *   workspace folder is open to resolve it against.
 */
export function resolveDatabasePath(filePath: string, environment: IDatabasePathEnvironment): string {
	const { pathLib } = environment;

	// Trim whitespace and a matching pair of quotes around the path, which Windows' "Copy as path"
	// and some terminals add.
	const unquotedPath = filePath.trim().replace(/^(?<quote>["'])(?<path>.*)\k<quote>$/, '$<path>');

	// An empty path has nothing to resolve.
	if (!unquotedPath) {
		return unquotedPath;
	}

	// A Windows drive-relative path such as `C:data\db.sqlite` is relative to the current folder of
	// that drive, which is no workspace folder and means nothing here, so it is left unresolved.
	if (pathLib.sep === '\\' && /^[a-z]:(?![\\/])/i.test(unquotedPath)) {
		return unquotedPath;
	}

	// A leading `~/` is the home directory. `~` is a Unix shell convention with no native meaning on
	// Windows, so this only applies on macOS and Linux. The result is absolute, so return it directly.
	if (pathLib.sep === '/' && unquotedPath.startsWith('~/')) {
		return pathLib.join(environment.homedir, unquotedPath.slice(2));
	}

	// Resolve the path against the workspace folders, preferring the first one in which the file
	// exists. resolve() leaves an absolute path absolute (on Windows, giving a drive-less path such
	// as `\data\db.sqlite` the folder's drive) and normalizes `.` and `..` segments.
	const candidatePaths = environment.workspaceFolderPaths.map(folder => pathLib.resolve(folder, unquotedPath));
	if (candidatePaths.length) {
		return candidatePaths.find(candidate => environment.exists(candidate)) ?? candidatePaths[0];
	}

	// With no workspace folder, an absolute path is normalized and a relative path is returned as
	// entered, since there is nothing to resolve it against.
	return pathLib.isAbsolute(unquotedPath) ? pathLib.normalize(unquotedPath) : unquotedPath;
}

/**
 * Checks that an absolute path names an existing database file of the kind the signature
 * describes. Only what can be shown wrong is rejected; see {@link DatabaseFileCheck}.
 * @param filePath The absolute path to check.
 * @param signature The signature of the expected kind of database file.
 * @returns The outcome of the check.
 */
export async function checkDatabaseFile(filePath: string, signature: IDatabaseFileSignature): Promise<DatabaseFileCheck> {
	// The path must name an existing file. ENOTDIR means a parent in the path is a file, so nothing
	// can exist at the path either. Any other failure (a parent folder that can't be read, say)
	// leaves the file's existence unknown, so it is not rejected.
	let size: number;
	try {
		const stats = await fs.stat(filePath);
		if (!stats.isFile()) {
			return 'notFile';
		}
		size = stats.size;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'valid';
	}

	// An empty file has no header to check.
	if (size === 0) {
		return signature.allowEmpty ? 'valid' : 'wrongKind';
	}

	// Read the header. A file that exists but can't be opened or read is not rejected.
	const header = Buffer.alloc(signature.offset + signature.magic.length);
	let bytesRead: number;
	try {
		const handle = await fs.open(filePath, 'r');
		try {
			({ bytesRead } = await handle.read(header, 0, header.length, 0));
		} finally {
			await handle.close();
		}
	} catch {
		return 'valid';
	}

	// The header must carry the signature. A file too short to hold it does not.
	return bytesRead === header.length && header.subarray(signature.offset).equals(signature.magic)
		? 'valid'
		: 'wrongKind';
}
