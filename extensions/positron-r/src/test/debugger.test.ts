/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import { toDisposable, withDisposables } from "./utils-disposables";
import { execute, startR } from './utils-session';
import { closeAllEditors } from './utils-vscode';
import { pollForSuccess } from './utils-assertions';
import { delay } from '../util';

suite('Debugger', () => {
	let sesDisposable: vscode.Disposable;

	suiteSetup(async () => {
		const [_ses, disposable] = await startR();
		sesDisposable = disposable;
	});

	suiteTeardown(async () => {
		if (sesDisposable) {
			await sesDisposable.dispose();
		}
	});

	test('Can debug in virtual namespace', async () => {
		await withDisposables(async (disposables) => {
			// Generate virtual namespace synchronously via `View()`
			await execute('View(points)');
			await closeAllEditors();

			await execute('debugonce(points)');
			await execute('points()');

			// Clean up editor opened by the debugger
			disposables.push(toDisposable(closeAllEditors));

			// Quit debugger on exit
			disposables.push(toDisposable(async () => await execute('Q')));

			// Should show vritual namespace in editor. We poll for success to give Ark
			// a bit of time to generate the virtual namespace.
			await pollForSuccess(async () => {
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
		await withDisposables(async (disposables) => {
			await execute('f <- function() {}');
			await execute('debug(f)');
			await execute('f()');

			// Clean up editor opened by the debugger
			disposables.push(toDisposable(closeAllEditors));

			// Quit debugger on exit
			disposables.push(toDisposable(async () => await execute('Q')));

			// Should show vritual fallback document in editor
			await pollForSuccess(async () => {
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
