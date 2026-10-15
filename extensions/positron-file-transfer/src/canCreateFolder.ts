/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/**
 * The command that answers `canCreateFolderIn` for the renderer. The renderer declares the same ID
 * in `src/vs/workbench/browser/utils/createFolder.ts`; `extensions/canCreateFolderCommand.vitest.ts`
 * keeps the two in step.
 */
export const CAN_CREATE_FOLDER_IN_COMMAND = 'positron.fileTransfer.canCreateFolderIn';

/**
 * The error codes that mean the current user cannot write to a folder.
 */
const NO_WRITE_ACCESS_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

/**
 * Checks whether the current user can create a folder in the given folder. This runs where the
 * files are, as the user who owns the session, so the operating system's answer applies to that
 * user. On Windows, only the read-only attribute is checked, not access control lists.
 *
 * A folder that does not exist yet is answered for the nearest folder above it that does, since
 * that is the folder the missing ones would be created in (`git clone` creates them).
 * @param parentPath The folder to create a folder in.
 * @returns true or false, or undefined if it cannot tell, for example when the path runs through
 * a file.
 */
export async function canCreateFolderIn(parentPath: string): Promise<boolean | undefined> {
	let folder = parentPath;
	for (; ;) {
		try {
			// Creating an entry in a folder needs its search (execute) permission as well as write.
			await fs.promises.access(folder, fs.constants.W_OK | fs.constants.X_OK);
			return true;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			const parent = path.dirname(folder);
			if (code === 'ENOENT' && parent !== folder) {
				folder = parent;
				continue;
			}
			return code !== undefined && NO_WRITE_ACCESS_CODES.has(code) ? false : undefined;
		}
	}
}
