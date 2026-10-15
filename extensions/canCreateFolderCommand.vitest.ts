/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';
import { CAN_CREATE_FOLDER_IN_COMMAND } from './positron-file-transfer/src/canCreateFolder';

/**
 * The New Folder dialogs in the renderer call a command that `positron-file-transfer` registers,
 * and the two sides cannot share a constant. If the IDs drift apart, the renderer's check treats
 * the missing command as "cannot tell" and passes, so the check turns off without any other test
 * failing. This guard ties the two IDs, and the activation event, together.
 */

// `__dirname` is this file's own directory, so the paths hold wherever Vitest is started from.
function read(relativePath: string): string {
	return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('canCreateFolderIn command', () => {
	it('is called by the renderer under the ID the extension registers', () => {
		expect(read('../src/vs/workbench/browser/utils/createFolder.ts'))
			.toContain(`export const CAN_CREATE_FOLDER_IN_COMMAND = '${CAN_CREATE_FOLDER_IN_COMMAND}';`);
	});

	it('activates the extension when it is called', () => {
		const packageJson = JSON.parse(read('positron-file-transfer/package.json'));

		expect(packageJson.activationEvents).toContain(`onCommand:${CAN_CREATE_FOLDER_IN_COMMAND}`);
	});
});
