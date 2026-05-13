/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';
import * as testKit from './kit';

suite('RStudio API', () => {
	// https://github.com/posit-dev/positron/issues/8374
	test('Navigate to file', async () => {
		await testKit.withDisposables(async (disposables) => {
			const [_ses, sesDisposable] = await testKit.startR();
			disposables.push(sesDisposable);

			const [tmpDir, dirDisposable] = testKit.makeTempDir('rstudioapi-test');
			disposables.push(dirDisposable);

			const fooUri = vscode.Uri.file(path.join(tmpDir, 'foo.R'));
			const barUri = vscode.Uri.file(path.join(tmpDir, 'bar.R'));

			await vscode.workspace.fs.writeFile(fooUri, Buffer.from('this-is-foo'));
			await vscode.workspace.fs.writeFile(barUri, Buffer.from('this-is-bar'));

			const [fooDoc, fooDocDisposable] = await testKit.openTextDocument(fooUri);
			const [barDoc, barDocDisposable] = await testKit.openTextDocument(barUri);
			disposables.push(fooDocDisposable, barDocDisposable);

			await vscode.window.showTextDocument(fooDoc, { preview: false });
			await vscode.window.showTextDocument(barDoc, { preview: false });

			// Assert defensively that bar.R is selected
			await testKit.assertSelectedEditor(barUri, 'this-is-bar');

			const escapedPath = fooUri.fsPath.replace(/\\/g, '\\\\');
			await testKit.execute(`.rs.api.navigateToFile('${escapedPath}')`);

			// Now foo.R should be selected
			await testKit.assertSelectedEditor(fooUri, 'this-is-foo');
		});
	});

	// https://github.com/posit-dev/positron/issues/13431
	test('Navigate to file with UNC path on Windows', async function () {
		if (process.platform !== 'win32') {
			this.skip();
			return;
		}

		await testKit.withDisposables(async (disposables) => {
			const [_ses, sesDisposable] = await testKit.startR();
			disposables.push(sesDisposable);

			const [tmpDir, dirDisposable] = testKit.makeTempDir('rstudioapi-unc');
			disposables.push(dirDisposable);

			const fooUri = vscode.Uri.file(path.join(tmpDir, 'foo.R'));
			await vscode.workspace.fs.writeFile(fooUri, Buffer.from('this-is-foo'));

			// Build a UNC version of fooUri.fsPath via the Windows admin
			// loopback share: C:\path\to\foo.R -> \\127.0.0.1\C$\path\to\foo.R.
			// This lets us point at a real file via a UNC-shaped path, which
			// is what the OpenEditor handler historically mishandled (#13431).
			const localPath = fooUri.fsPath;
			const drive = localPath[0];
			const rest = localPath.substring(3); // drop "C:\"
			const uncPath = `\\\\127.0.0.1\\${drive}$\\${rest}`;

			// The admin loopback share is reachable by default to local
			// administrators on Windows, but some environments disable it.
			// Skip the test rather than fail flakily when it isn't reachable.
			try {
				await vscode.workspace.fs.stat(vscode.Uri.file(uncPath));
			} catch {
				this.skip();
				return;
			}

			// Hand the UNC-shaped path to navigateToFile.
			const escapedUncPath = uncPath.replace(/\\/g, '\\\\');
			await testKit.execute(`.rs.api.navigateToFile('${escapedUncPath}')`);

			// We compare contents rather than URIs because Positron sees
			// a `file://127.0.0.1/C$/...` URI: a structurally-correct UNC
			// URI, but not identical to fooUri.
			await testKit.pollForSuccess(() => {
				const ed = vscode.window.activeTextEditor;
				assert.ok(ed, 'Expected an active text editor');
				assert.strictEqual(
					ed.document.getText(),
					'this-is-foo',
					`Expected foo.R contents, got: ${ed.document.getText()}`
				);
			});

			// Clean up the editor we opened
			disposables.push(testKit.toDisposable(testKit.closeAllEditors));
		});
	});
});
