/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Returns true if given file path exists within the given parent directory, false otherwise.
 * Copied from the function of the same name in extensions/positron-python/src/client/pythonEnvironments/common/externalDependencies.ts.
 * @param filePath File path to check for
 * @param parentPath The potential parent path to check for
 */
export function isParentPath(filePath: string, parentPath: string): boolean {
	if (!parentPath.endsWith(path.sep)) {
		parentPath += path.sep;
	}
	if (!filePath.endsWith(path.sep)) {
		filePath += path.sep;
	}
	return normCasePath(filePath).startsWith(normCasePath(parentPath));
}

/**
 * Adapted from the function of the same name in extensions/positron-python/src/client/pythonEnvironments/common/externalDependencies.ts.
 */
export function normCasePath(filePath: string): string {
	return os.platform() === 'win32' ? path.normalize(filePath).toUpperCase() : path.normalize(filePath);
}

/**
 * Copied from the function of the same name in extensions/positron-python/src/client/pythonEnvironments/common/externalDependencies.ts.
 */
export function arePathsSame(path1: string, path2: string): boolean {
	return normCasePath(path1) === normCasePath(path2);
}

/**
 * Copied from the function of the same name in extensions/positron-python/src/client/common/helpers.ts.
 * NOTE: We do not export this since in all known cases, normalizeUserPath()
 * is the better choice.
 */
function untildify(path: string): string {
	return path.replace(/^~($|\/|\\)/, `${os.homedir()}$1`);
}

/**
 * Normalizes a user-provided path (e.g., from settings) by expanding tilde (~) to the home
 * directory, normalizing path separators, and resolving `.` and `..`. This leaves us with
 * more robust and predictable paths in, e.g., the R installation metadata.
 * @param filepath The user-provided path to normalize
 * @returns The normalized, tilde-expanded, absolute path
 */
export function normalizeUserPath(filepath: string): string {
	return path.normalize(untildify(filepath));
}

/**
 * Check if a path is a file.
 * A combination of isFile and resolveSymbolicLink in extensions/positron-python/src/client/pythonEnvironments/common/externalDependencies.ts.
 * @param filePath The path to check
 * @returns Whether the path is a file
 */
export function isFile(filePath: string): boolean {
	try {
		const stats = fs.lstatSync(filePath);
		if (stats.isSymbolicLink()) {
			let resolvedPath = fs.realpathSync(filePath);
			// Stop at a maximum depth of 5 symbolic links to avoid infinite loops
			const maximumDepth = 5;
			for (let i = 0; i < maximumDepth; i++) {
				const resolvedStats = fs.lstatSync(resolvedPath);
				if (resolvedStats.isFile()) {
					return true;
				}
				resolvedPath = fs.realpathSync(resolvedPath);
			}
			console.error(`[isFile] Detected a potential symbolic link loop at ${filePath}, terminating resolution.`);
			return false;
		}
		return stats.isFile();
	} catch (error) {
		console.error(`[isFile] Error checking if path is a file: ${error}`);
		return false;
	}
}

/**
 * Check if a path is a directory.
 * @param filePath The path to check
 * @returns Whether the path is a directory
 */
export function isDirectory(filePath: string): boolean {
	try {
		const stats = fs.lstatSync(filePath);
		return stats.isDirectory();
	} catch (error) {
		console.error(`[isDirectory] Error checking if path is a directory: ${error}`);
		return false;
	}
}
