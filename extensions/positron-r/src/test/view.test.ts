/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import * as vscode from 'vscode';
import { makeTempDir, toDisposable, withDisposables } from './utils-disposables';
import { execute, startR } from './utils-session';
import { assertSelectedEditor } from './utils-assertions';

suite('View', () => {
	// https://github.com/posit-dev/positron/issues/8504
	test('Can use `View()` on sourced function', async () => {
		await withDisposables(async (disposables) => {
			const [_ses, sesDisposable] = await startR();
			disposables.push(sesDisposable);

			await vscode.commands.executeCommand('workbench.action.closeAllEditors');

			const [tmpDir, dirDisposable] = makeTempDir('view-test');
			disposables.push(dirDisposable);

			const uri = vscode.Uri.file(path.join(tmpDir, 'file.R'));
			await vscode.workspace.fs.writeFile(uri, Buffer.from('f <- function() {}'));

			const escapedPath = uri.fsPath.replace(/\\/g, '\\\\');
			await execute(`source('${escapedPath}')`);
			await execute(`View(f)`);

			// Should show source file in editor
			await assertSelectedEditor(uri, 'f <- function');
		});
	});
});
