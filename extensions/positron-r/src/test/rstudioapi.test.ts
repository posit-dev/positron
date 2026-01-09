/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as vscode from 'vscode';
import * as path from 'path';
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
});
