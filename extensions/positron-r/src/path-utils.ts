/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';

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
 */
export function untildify(path: string): string {
	return path.replace(/^~($|\/|\\)/, `${os.homedir()}$1`);
}
