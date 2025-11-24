/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as testKit from './kit';

suite.skip('Debugger', () => {
	let sesDisposable: vscode.Disposable;

	suiteSetup(async () => {
		const [_ses, disposable] = await testKit.startR('Suite: Debugger');
		sesDisposable = disposable;
	});

	suiteTeardown(async () => {
		if (sesDisposable) {
			await sesDisposable.dispose();
		}
	});

	test('Can debug in virtual namespace', async () => {
		await testKit.withDisposables(async (disposables) => {
			// Force virtual namespace generation via `View()`
			// This happens synchronously
			await testKit.execute('View(points)');
			await testKit.closeAllEditors();

			await testKit.execute('debugonce(points)');
			await testKit.execute('points()');

			// Clean up editor opened by the debugger on exit
			disposables.push(testKit.toDisposable(testKit.closeAllEditors));

			// Quit debugger on exit
			disposables.push(testKit.toDisposable(async () => await testKit.execute('Q')));

			// Should show virtual namespace in editor. We poll for success to give Ark
			// a bit of time to generate the virtual namespace.
			await testKit.pollForSuccess(async () => {
				const ed = vscode.window.activeTextEditor;

				assert.strictEqual(
					ed?.document.uri.scheme,
					'ark',
					`Expected editor URI scheme to be 'ark', got '${ed?.document.uri.scheme}'`
				);

				assert.match(
					ed.document.getText(),
					new RegExp('Virtual namespace of package graphics'),
					`Unexpected editor contents for ${ed.document.uri.fsPath}: Expected graphics namespace`
				);
			})
		});
	});

	test('Can debug in virtual fallback', async () => {
		await testKit.withDisposables(async (disposables) => {
			await testKit.execute('f <- function() {}');
			await testKit.execute('debug(f)');
			await testKit.execute('f()');

			// Clean up editor opened by the debugger
			disposables.push(testKit.toDisposable(testKit.closeAllEditors));

			// Quit debugger on exit
			disposables.push(testKit.toDisposable(async () => await testKit.execute('Q')));

			// Should show virtual fallback document in editor
			await testKit.pollForSuccess(async () => {
				const ed = vscode.window.activeTextEditor;

				assert.strictEqual(
					ed?.document.uri.scheme,
					'ark',
					`Expected editor URI scheme to be 'ark', got '${ed?.document.uri.scheme}'`
				);

				assert.match(
					ed.document.getText(),
					new RegExp('f <- function'),
					`Unexpected editor contents for ${ed.document.uri.fsPath}`
				);
			})
		});
	});
});
