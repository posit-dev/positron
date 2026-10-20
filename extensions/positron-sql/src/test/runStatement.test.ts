/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { sqlDocument } from './support';

/**
 * The run command itself, end to end as far as the first question it asks.
 *
 * A run holds a guard against a second run while it awaits that question, so a question that never
 * settles is a run that never ends, and every Cmd+Enter after it silently does nothing. With no data
 * connection open, the question is a notification -- and a notification the user never answers,
 * which is what one that hid itself is, never settles.
 */
suite('sql.runStatement', () => {

	const showInformationMessage = vscode.window.showInformationMessage;
	let shownMessages: string[];

	suiteSetup(async () => {
		// The command is registered once the extension is active and `sql.enabled` is on.
		await vscode.extensions.getExtension('positron.positron-sql')!.activate();
		await vscode.workspace.getConfiguration('sql').update('enabled', true, vscode.ConfigurationTarget.Global);
	});

	suiteTeardown(async () => {
		await vscode.workspace.getConfiguration('sql').update('enabled', undefined, vscode.ConfigurationTarget.Global);
	});

	setup(() => {
		shownMessages = [];
		(vscode.window as { showInformationMessage: unknown }).showInformationMessage = (message: string) => {
			shownMessages.push(message);
			return new Promise<undefined>(() => { });
		};
	});

	teardown(async () => {
		(vscode.window as { showInformationMessage: unknown }).showInformationMessage = showInformationMessage;
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('an unanswered notification does not stop the next run', async () => {
		await vscode.window.showTextDocument(await sqlDocument('SELECT 1;'));

		const first = await settlesWithin(vscode.commands.executeCommand('sql.runStatement'));
		const second = await settlesWithin(vscode.commands.executeCommand('sql.runStatement'));

		assert.deepStrictEqual(
			{ first, second, notifications: shownMessages.length },
			// The second press asked again, rather than returning early on the first's guard.
			{ first: true, second: true, notifications: 2 },
		);
	});
});

/** Whether a promise settles within a second; far longer than a run that asks nothing takes. */
async function settlesWithin(promise: Thenable<unknown>): Promise<boolean> {
	const timedOut = Symbol('timed out');
	const result = await Promise.race([
		Promise.resolve(promise).then(() => true),
		new Promise<typeof timedOut>(resolve => setTimeout(() => resolve(timedOut), 1000)),
	]);
	return result !== timedOut;
}
