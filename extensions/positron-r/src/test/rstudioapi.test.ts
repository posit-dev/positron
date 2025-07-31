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
import { withRSession, waitFor } from './utils';

suite('RStudio API', () => {
	test('Navigate to file', async () => {
		await withRSession(async (_ses) => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstudioapi-test'));

			const fooUri = vscode.Uri.file(path.join(tmpDir, 'foo.R'));
			const barUri = vscode.Uri.file(path.join(tmpDir, 'bar.R'));

			await vscode.workspace.fs.writeFile(fooUri, Buffer.from(''));
			await vscode.workspace.fs.writeFile(barUri, Buffer.from(''));

			const fooDoc = await vscode.workspace.openTextDocument(fooUri);
			const barDoc = await vscode.workspace.openTextDocument(barUri);

			await vscode.window.showTextDocument(fooDoc, { preview: false });
			await vscode.window.showTextDocument(barDoc, { preview: false });

			const waitForSelectedEditor = async (uri: vscode.Uri) => {
				await waitFor(() => {
					const ed = vscode.window.activeTextEditor;
					return ed !== undefined && ed.document.uri.fsPath === uri.fsPath;
				})
			};

			// Assert defensively that bar.R is selected
			assert.ok(waitForSelectedEditor(barUri), 'bar.R did not become the active editor');

			await positron.runtime.executeCode('r', '.rs.api.navigateToFile("foo.R")', false)

			// Now foo.R should be selected
			assert.ok(waitForSelectedEditor(fooUri), 'foo.R did not become the active editor');
		});
	});

	test('Should fail on Windows', async () => {
		assert.strictEqual(process.platform === 'win32', false, 'This test should fail on Windows');
	});
});
