/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';
import { makeTempDir, toDisposable, withDisposables } from './utils-disposables';
import { execute, startR } from './utils-session';
import { assertSelectedEditor, pollForSuccess } from './utils-assertions';
import { closeAllEditors } from './utils-vscode';

suite('View', () => {
	let sesDisposable: vscode.Disposable;

	setup(async () => {
		// To be safe
		await closeAllEditors();

		const [_ses, disposable] = await startR();
		sesDisposable = disposable;
	});

	teardown(async () => {
		if (sesDisposable) {
			await sesDisposable.dispose();
		}
	});

	// https://github.com/posit-dev/positron/issues/8504
	test('Can use `View()` on sourced function', async () => {
		await withDisposables(async (disposables) => {
			const [tmpDir, dirDisposable] = makeTempDir('view-test');
			disposables.push(dirDisposable);

			const uri = vscode.Uri.file(path.join(tmpDir, 'file.R'));
			await vscode.workspace.fs.writeFile(uri, Buffer.from('f <- function() {}'));

			const escapedPath = uri.fsPath.replace(/\\/g, '\\\\');
			await execute(`source('${escapedPath}')`);
			await execute(`View(f)`);

			// Clean up editor opened by View
			disposables.push(toDisposable(closeAllEditors));

			// Should show source file in editor
			await assertSelectedEditor(uri, 'f <- function');
		});
	});

	// https://github.com/posit-dev/positron/issues/4651
	test('Can use `View()` on base function (virtual document)', async () => {
		await withDisposables(async (disposables) => {
			await execute(`View(identity)`);

			// Clean up editor opened by View
			disposables.push(toDisposable(closeAllEditors));

			// Should show source file in editor
			await pollForSuccess(() => {
				const ed = vscode.window.activeTextEditor;

				assert.strictEqual(
					ed?.document.uri.scheme,
					'ark',
					`Expected editor URI scheme to be 'ark', got '${ed?.document.uri.scheme}'`
				);

				assert.match(
					ed.document.getText(),
					new RegExp('Virtual namespace of package base'),
					`Unexpected editor contents for ${ed.document.uri.fsPath}: Expected base namespace`
				);
			});
		});
	});
});
