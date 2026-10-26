/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { ConnectionRef } from '../schema';
import { SessionApi, SqlSession } from '../session';
import { testLog, TEST_DRIVER } from './support';

const Kind = positron.DataConnectionNodeKind;

/**
 * Stands in for `positron.dataConnections`: a list of connections the test edits, a schema per
 * connection, and a count of what the session asked for.
 */
class FakeConnections implements SessionApi {

	/** What getConnections answers with; edited by the test between reads. */
	public connections: positron.DataConnectionSummary[] = [];

	/** Profiles openConnection was called for, in order. */
	public readonly opened: string[] = [];

	/** Profiles getSchema was called for, in order. */
	public readonly walked: string[] = [];

	/** How many listeners are subscribed to onDidChangeConnections right now. */
	public listeners = 0;

	/**
	 * When set, each getConnections call waits to be let go, in the order it was made: lets a test
	 * finish reads out of order.
	 */
	public holdReads = false;
	public readonly held: (() => void)[] = [];

	private readonly _onDidChange = new vscode.EventEmitter<void>();

	public readonly onDidChangeConnections: vscode.Event<void> = (listener, thisArgs, disposables) => {
		this.listeners++;
		const subscription = this._onDidChange.event(listener, thisArgs);
		const counted = {
			dispose: () => {
				this.listeners--;
				subscription.dispose();
			},
		};
		disposables?.push(counted);
		return counted;
	};

	public async getConnections(): Promise<positron.DataConnectionSummary[]> {
		// Copied when asked, not when answered: what a read sees is the state it began in.
		const answer = this.connections.map(connection => ({ ...connection }));
		if (this.holdReads) {
			await new Promise<void>(resolve => this.held.push(resolve));
		}
		return answer;
	}

	public async getSchema(profileId: string): Promise<positron.DataConnectionSchema | undefined> {
		this.walked.push(profileId);
		return {
			profileId,
			truncated: false,
			nodes: [{ name: 'orders', kind: Kind.Table, children: [{ name: 'id', kind: Kind.Field }] }],
		};
	}

	public async openConnection(profileId: string): Promise<boolean> {
		this.opened.push(profileId);
		return true;
	}

	/** Says the connections changed, as Positron does when one opens or closes. */
	public fire(): void {
		this._onDidChange.fire();
	}
}

/** A connection summary, as getConnections reports one. */
function summary(profileId: string, connected: boolean): positron.DataConnectionSummary {
	return { profileId, name: profileId.toUpperCase(), driverId: TEST_DRIVER, driverName: 'DuckDB', connected };
}

/** How a connection is stored as a file's choice. */
function ref(profileId: string): ConnectionRef {
	return { profileId, name: profileId.toUpperCase(), driverId: TEST_DRIVER };
}

/** A workspace memento that keeps what is written to it in memory. */
function memento(initial: Record<string, unknown> = {}): vscode.Memento {
	const values = new Map(Object.entries(initial));
	return {
		keys: () => [...values.keys()],
		get: <T>(key: string, fallback?: T) => (values.has(key) ? values.get(key) : fallback) as T,
		update: async (key: string, value: unknown) => { values.set(key, value); },
	};
}

/** Waits for a condition the session reaches on its own, such as a read started by an event. */
async function until(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error(`Timed out waiting for ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

/** Whether a promise has settled, without waiting for it to. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
	const pending = Symbol();
	const result = await Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(pending), 20))]);
	return result !== pending;
}

/** A SQL file on disk with the given text, so that its choice of connection is kept by URI. */
function sqlFile(name: string, text: string): vscode.Uri {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-sql-session-'));
	const file = path.join(directory, name);
	fs.writeFileSync(file, text);
	return vscode.Uri.file(file);
}

suite('SqlSession', () => {
	const sessions: SqlSession[] = [];

	/** A session over the fake, started, and disposed when the test ends. */
	function startSession(api: FakeConnections, store = memento()): SqlSession {
		const extension = vscode.extensions.getExtension('positron.positron-sql')!;
		const session = new SqlSession(
			{ extensionPath: extension.extensionPath, workspaceState: store },
			testLog().log,
			api,
			0,
		);
		sessions.push(session);
		session.start();
		return session;
	}

	teardown(async () => {
		for (const session of sessions.splice(0)) {
			session.dispose();
		}
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('a read overtaken by a later one does not replace what the later one found', async () => {
		const api = new FakeConnections();
		api.connections = [summary('a', true)];
		api.holdReads = true;
		const session = startSession(api);
		await until(() => api.held.length === 1, 'the first read');

		// Closed while the first read is in flight; the read begun after knows better.
		api.connections = [summary('a', false)];
		const second = session.refreshSchema();
		await until(() => api.held.length === 2, 'the second read');
		api.held[1]();
		await second;
		api.held[0]();
		await until(() => api.walked.length > 0, 'the first read to walk');
		await new Promise(resolve => setTimeout(resolve, 20));

		assert.deepStrictEqual(session.schema.connections, []);
	});

	test('the first read is not over until a read has set the schema', async () => {
		// A connection opening while the first read is in flight starts a second one, and the first
		// then finishes as stale, having set nothing.
		const api = new FakeConnections();
		api.connections = [summary('a', true)];
		api.holdReads = true;
		const session = startSession(api);
		await until(() => api.held.length === 1, 'the first read');
		api.fire();
		await until(() => api.held.length === 2, 'the read the event started');

		api.held[0]();
		assert.strictEqual(await hasSettled(session.whenRead()), false, 'settled on a read that set nothing');

		api.held[1]();
		await session.whenRead();
		assert.deepStrictEqual(session.schema.connections.map(connection => connection.profileId), ['a']);
	});

	test('a burst of connection changes is read once', async () => {
		const api = new FakeConnections();
		const session = startSession(api);
		await session.whenRead();
		let reads = 0;
		const getConnections = api.getConnections.bind(api);
		api.getConnections = () => {
			reads++;
			return getConnections();
		};

		api.fire();
		api.fire();
		api.fire();
		await until(() => reads > 0, 'the read the changes asked for');
		await new Promise(resolve => setTimeout(resolve, 20));

		assert.strictEqual(reads, 1);
	});

	test('a file\'s connection is opened for it once a session, not every time it is asked for', async () => {
		const first = sqlFile('first.sql', 'SELECT 1;');
		const second = sqlFile('second.sql', 'SELECT 2;');
		const api = new FakeConnections();
		api.connections = [summary('p', false)];
		const session = startSession(api, memento({
			connectionByDocument: { [first.toString()]: ref('p'), [second.toString()]: ref('p') },
		}));
		await session.whenRead();

		await vscode.workspace.openTextDocument(first);
		await until(() => api.opened.length === 1, 'the connection to be opened');
		// The fake does not open it, as a connection with expired credentials would not.
		api.fire();
		await session.refreshSchema();
		await vscode.workspace.openTextDocument(second);
		await new Promise(resolve => setTimeout(resolve, 20));

		assert.deepStrictEqual(api.opened, ['p']);
	});

	test('a renamed file keeps its connection and its diagnostics', async () => {
		const before = sqlFile('before.sql', 'SELECT * FROM missing;');
		const after = vscode.Uri.file(path.join(path.dirname(before.fsPath), 'after.sql'));
		const api = new FakeConnections();
		api.connections = [summary('a', true), summary('b', true)];
		// Two open, so the file reads its own choice rather than the only open connection.
		const session = startSession(api, memento({ connectionByDocument: { [before.toString()]: ref('a') } }));
		await session.whenRead();
		await vscode.workspace.openTextDocument(before);
		await until(() => vscode.languages.getDiagnostics(before).length > 0, 'the unknown table to be reported');

		const edit = new vscode.WorkspaceEdit();
		edit.renameFile(before, after);
		assert.ok(await vscode.workspace.applyEdit(edit));
		await until(() => vscode.languages.getDiagnostics(after).length > 0, 'the renamed file to be reported');

		const renamed = vscode.workspace.textDocuments.find(document => document.uri.toString() === after.toString())!;
		assert.strictEqual(resolved(session, renamed), 'connection:a');
	});

	/** Which open connection a document resolves to, by profile, or the kind of nothing it has. */
	function resolved(session: SqlSession, document: vscode.TextDocument): string {
		const selection = session.selectionFor(document);
		return selection.kind === 'none' ? 'none' : `${selection.kind}:${selection.connection.profileId}`;
	}

	test('a file saved from the file in front of the user takes over its connection', async () => {
		// What Save As from a file on disk looks like: the new file opens holding the same text,
		// while the file it was saved from is still the active editor.
		const text = 'SELECT * FROM orders;';
		const original = sqlFile('original.sql', text);
		const copy = sqlFile('copy.sql', text);
		const api = new FakeConnections();
		api.connections = [summary('a', true), summary('b', true)];
		const session = startSession(api, memento({ connectionByDocument: { [original.toString()]: ref('a') } }));
		await session.whenRead();
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(original));

		const saved = await vscode.workspace.openTextDocument(copy);

		assert.strictEqual(resolved(session, saved), 'connection:a');
	});

	test('a file that only holds the same text as another does not take its connection', async () => {
		// Two copies of a query, one written against a database: opening the other must not
		// connect it to that database.
		const text = 'SELECT * FROM orders;';
		const bound = sqlFile('bound.sql', text);
		const unrelated = sqlFile('unrelated.sql', text);
		const api = new FakeConnections();
		api.connections = [summary('a', true), summary('b', true)];
		const session = startSession(api, memento({ connectionByDocument: { [bound.toString()]: ref('a') } }));
		await session.whenRead();
		await vscode.workspace.openTextDocument(bound);

		const opened = await vscode.workspace.openTextDocument(unrelated);
		await vscode.window.showTextDocument(opened);
		// Edited and put back, so it is saved holding the same text as the other.
		const insert = new vscode.WorkspaceEdit();
		insert.insert(opened.uri, new vscode.Position(0, 0), ' ');
		await vscode.workspace.applyEdit(insert);
		const undo = new vscode.WorkspaceEdit();
		undo.delete(opened.uri, new vscode.Range(0, 0, 0, 1));
		await vscode.workspace.applyEdit(undo);
		await opened.save();

		assert.strictEqual(resolved(session, opened), 'none');
	});
});
