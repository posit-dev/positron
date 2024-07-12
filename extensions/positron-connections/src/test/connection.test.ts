/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { ConnectionItemsProvider } from '../connection';
import * as mocha from 'mocha';
import { randomUUID } from 'crypto';

suite('Connections pane works for R', () => {
	suiteTeardown(() => {
		vscode.window.showInformationMessage('All tests done!');
	});

	test('Can list tables and fields from R connections', async () => {

		// Waits until positron is ready to start a runtime
		const info = await assert_or_timeout(async () => {
			return await positron.runtime.getPreferredRuntime('r');
		});

		const session = await positron.runtime.startLanguageRuntime(info!.runtimeId, 'Test connections pane!');
		executeRCode(
			session,
			'con <- connections::connection_open(RSQLite::SQLite(), tempfile())',
		);

		const ext = vscode.extensions.getExtension<ConnectionItemsProvider>('vscode.positron-connections');
		const provider = ext?.exports;
		assert(provider !== undefined);

		// There's some delay between the connection being registered in R, the comm opened with
		// positron and the extension being able to get the message. We wait up to 1 second for
		// this to happen.
		const sqlite = await assert_or_timeout(() => {
			const connections = provider.listConnections();
			assert(connections !== undefined);
			assert(connections[0].name === "SQLiteConnection");
			return connections[0];
		});

		// Add a table to the connection
		executeRCode(
			session,
			'DBI::dbWriteTable(con, "mtcars", mtcars)'
		);

		const catalog = await provider.getChildren(sqlite);
		assert(catalog.length === 1);

		const schema = await provider.getChildren(catalog[0]);
		assert(schema.length === 1);

		const tables = await provider.getChildren(schema[0]);
		assert(tables.length === 1);
		const mtcars = tables[0];
		assert(mtcars.name === "mtcars");

		const fields = await provider.getChildren(mtcars);
		assert(fields.length === 11);
		assert.notStrictEqual(
			fields.map(f => f.name),
			['mpg', 'cyl', 'disp', 'hp', 'drat', 'wt', 'qsec', 'vs', 'am', 'gear', 'carb']
		);
	});
});

async function sleep(time: number) {
	return new Promise((resolve) => setTimeout(resolve, time));
}

async function assert_or_timeout<T>(fn: () => T, timeout: number = 5000): Promise<T> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			return await fn();
		} catch (_) {
			await sleep(50);
		}
	}
	throw new Error('Assert failed');
}

function executeRCode(session: positron.LanguageRuntimeSession, code: string) {
	session.execute(
		code,
		randomUUID(),
		positron.RuntimeCodeExecutionMode.Interactive,
		positron.RuntimeErrorBehavior.Stop
	);
}
