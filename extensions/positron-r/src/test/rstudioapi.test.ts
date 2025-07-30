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
import { waitFor } from './utils';

suite('RStudio API', () => {
	test('Navigate to file', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstudioapi-test'));

		const fooUri = vscode.Uri.file(path.join(tmpDir, 'foo.R'));
		const barUri = vscode.Uri.file(path.join(tmpDir, 'bar.R'));

		await vscode.workspace.fs.writeFile(fooUri, Buffer.from(''));
		await vscode.workspace.fs.writeFile(barUri, Buffer.from(''));

		const fooDoc = await vscode.workspace.openTextDocument(fooUri);
		const barDoc = await vscode.workspace.openTextDocument(barUri);

		await vscode.window.showTextDocument(fooDoc, { preview: false });
		await vscode.window.showTextDocument(barDoc, { preview: false });

		// Assert defensively that bar.R is selected
		let activeEditor = vscode.window.activeTextEditor;
		assert.ok(activeEditor);
		assert.strictEqual(activeEditor.document.uri.fsPath, barUri.fsPath);

		await positron.runtime.executeCode('r', '.rs.api.navigateToFile("foo.R")', false)

		// Now foo.R should be selected
		const barSelected = await waitFor(() => {
			const ed = vscode.window.activeTextEditor;
			return !!ed && ed.document.uri.fsPath === barUri.fsPath;
		});

		assert.ok(barSelected, 'bar.R did not become the active editor');
	});
});
