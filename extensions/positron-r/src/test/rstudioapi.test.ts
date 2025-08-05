/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { makeTempDir, withDisposables } from './utils-disposables';
import { execute, startR } from './utils-session';
import { assertSelectedEditor } from './utils-assertions';
import { openTextDocument } from './utils-vscode';

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

			const [fooDoc, fooDocDisposable] = await openTextDocument(fooUri);
			const [barDoc, barDocDisposable] = await openTextDocument(barUri);
			disposables.push(fooDocDisposable, barDocDisposable);

			await vscode.window.showTextDocument(fooDoc, { preview: false });
			await vscode.window.showTextDocument(barDoc, { preview: false });

			// Assert defensively that bar.R is selected
			await assertSelectedEditor(barUri, 'this-is-bar');

			const escapedPath = fooUri.fsPath.replace(/\\/g, '\\\\');
			await execute(`.rs.api.navigateToFile('${escapedPath}')`);

			// Now foo.R should be selected
			await assertSelectedEditor(fooUri, 'this-is-foo');
		});
	});
});
