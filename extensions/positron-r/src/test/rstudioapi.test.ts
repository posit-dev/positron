/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as assert from 'assert';
import { withRSession, waitForSuccess as pollForSuccess } from './utils';

suite('RStudio API', () => {
	test('Navigate to file', async () => {
		await withRSession(async (_ses) => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstudioapi-test'));

			const fooUri = vscode.Uri.file(path.join(tmpDir, 'foo.R'));
			const barUri = vscode.Uri.file(path.join(tmpDir, 'bar.R'));

			await vscode.workspace.fs.writeFile(fooUri, Buffer.from('this-is-foo'));
			await vscode.workspace.fs.writeFile(barUri, Buffer.from('this-is-bar'));

			const fooDoc = await vscode.workspace.openTextDocument(fooUri);
			const barDoc = await vscode.workspace.openTextDocument(barUri);

			await vscode.window.showTextDocument(fooDoc, { preview: false });
			await vscode.window.showTextDocument(barDoc, { preview: false });

			const assertSelectedEditor = async (uri: vscode.Uri, text: string) => {
				// Poll for success because we can't synchronise `navigateToFile` reliably
				await pollForSuccess(() => {
					assert.strictEqual(1, 2);
					const ed = vscode.window.activeTextEditor;

					if (ed === undefined || ed.document.uri.fsPath !== uri.fsPath) {
						assert.fail(`Expected active editor for ${uri.fsPath}, but got ${ed?.document.uri.fsPath ?? 'undefined'}`);
					}

					assert.strictEqual(
						ed.document.getText(),
						text,
						`Unexpected editor contents for ${uri.fsPath}`
					);
				})
			};

			// Assert defensively that bar.R is selected
			assertSelectedEditor(barUri, 'this-is-bar');

			await positron.runtime.executeCode('r', '.rs.api.navigateToFile("foo.R")', false)

			// Now foo.R should be selected
			assertSelectedEditor(barUri, 'this-is-bar');
		});
	});

	test('Should fail on Windows', async () => {
		assert.strictEqual(process.platform === 'win32', false, 'This test should fail on Windows');
	});
});
