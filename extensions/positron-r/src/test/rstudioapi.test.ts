/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as assert from 'assert';
import { assertSelectedEditor, makeTempDir, pollForSuccess, startR, withDisposables } from './utils';

suite('RStudio API', () => {
	// https://github.com/posit-dev/positron/issues/8374
	test('Navigate to file', async () => {
		await withDisposables(async (disposables) => {
			const [_ses, sesDisposable] = await startR();
			disposables.push(sesDisposable);

			await vscode.commands.executeCommand('workbench.action.closeAllEditors');

			const [tmpDir, dirDisposable] = makeTempDir('rstudioapi-test');
			disposables.push(dirDisposable);

			const fooUri = vscode.Uri.file(path.join(tmpDir, 'foo.R'));
			const barUri = vscode.Uri.file(path.join(tmpDir, 'bar.R'));

			await vscode.workspace.fs.writeFile(fooUri, Buffer.from('this-is-foo'));
			await vscode.workspace.fs.writeFile(barUri, Buffer.from('this-is-bar'));

			const fooDoc = await vscode.workspace.openTextDocument(fooUri);
			const barDoc = await vscode.workspace.openTextDocument(barUri);

			await vscode.window.showTextDocument(fooDoc, { preview: false });
			await vscode.window.showTextDocument(barDoc, { preview: false });

			// Assert defensively that bar.R is selected
			await assertSelectedEditor(barUri, 'this-is-bar');

			const escapedPath = fooUri.fsPath.replace(/\\/g, '\\\\');
			await positron.runtime.executeCode('r', `.rs.api.navigateToFile('${escapedPath}')`, false, false);

			// Now foo.R should be selected
			await assertSelectedEditor(fooUri, 'this-is-foo');
		});
	});
});
