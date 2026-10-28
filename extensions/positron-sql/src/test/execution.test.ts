/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { ConnectCode, ExecutionApi, GGSQL_LANGUAGE_ID, sessionOn, StatementRunner } from '../execution';
import { ConnectionRef } from '../schema';
import { sqlDocument, testLog, TEST_CONNECTION, TEST_DRIVER, TEST_PROFILE } from './support';

const CONNECTION: ConnectionRef = {
	profileId: TEST_PROFILE,
	name: TEST_CONNECTION,
	driverId: TEST_DRIVER,
};

const SHOP = '-- @connect: duckdb:///data/shop.duckdb';
const MEMORY = '-- @connect: duckdb://memory';

suite('sessionOn', () => {

	test('a console already on the database takes the statement', () => {
		assert.strictEqual(
			sessionOn(SHOP, undefined, [{ sessionId: 'a', code: MEMORY }, { sessionId: 'b', code: SHOP }]),
			'b',
		);
	});

	test('the one in front of the user, when several are', () => {
		assert.strictEqual(
			sessionOn(SHOP, session('b'), [{ sessionId: 'a', code: SHOP }, { sessionId: 'b', code: SHOP }]),
			'b',
		);
	});

	test('a console in front of the user on another database is not used', () => {
		// Connecting it to this one would take its database away from whoever is working in it.
		assert.strictEqual(sessionOn(SHOP, session('a'), [{ sessionId: 'a', code: MEMORY }]), undefined);
	});

	test('a console whose database is unknown is not used', () => {
		// Reconnected after a reload, say: it may be on the file's database, and it may not.
		assert.strictEqual(sessionOn(SHOP, session('a'), [{ sessionId: 'a', code: undefined }]), undefined);
	});
});

suite('StatementRunner', () => {

	test('runs the statement as written in a console already on the database', async () => {
		const api = new FakeApi();
		api.addSession('gg', SHOP);

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(
			{ outcome, executed: api.executed },
			{ outcome: { kind: 'executed', sessionId: 'gg' }, executed: [['gg', 'SELECT 1']] },
		);
	});

	test('starts a console, connects it, then runs the statement, when none is on the database', async () => {
		// The open console is on another database, and is left there.
		const api = new FakeApi();
		api.addSession('gg', MEMORY);

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(
			{ outcome, executed: api.executed, started: api.started },
			{
				outcome: { kind: 'executed', sessionId: 'new-1' },
				executed: [['new-1', SHOP], ['new-1', 'SELECT 1']],
				started: 1,
			},
		);
	});

	test('a second statement reuses the console the first one started', async () => {
		const api = new FakeApi();
		const run = runner(api);

		await run.run(await document(), CONNECTION, 'SELECT 1');
		await run.run(await document(), CONNECTION, 'SELECT 2');

		assert.deepStrictEqual(
			{ started: api.started, executed: api.executed },
			{ started: 1, executed: [['new-1', SHOP], ['new-1', 'SELECT 1'], ['new-1', 'SELECT 2']] },
		);
	});

	test('a notebook session on the database is passed over', async () => {
		const api = new FakeApi();
		api.addSession('nb', SHOP, positron.LanguageRuntimeSessionMode.Notebook);

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(outcome, { kind: 'executed', sessionId: 'new-1' });
	});

	test('a failed connect stops the statement, and says so', async () => {
		const api = new FakeApi();
		api.onConnect = 'fail';

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(
			{ outcome, executed: api.executed },
			{ outcome: { kind: 'connect-failed' }, executed: [['new-1', SHOP]] },
		);
	});

	test('a connect that succeeds counts, even when Positron reports the move after it', async () => {
		// The report travels apart from the line's result, so reading where the session is once
		// the line finishes would find it still on its startup database.
		const api = new FakeApi();
		api.onConnect = 'connect-reported-late';

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(outcome, { kind: 'executed', sessionId: 'new-1' });
	});

	test('the next run reuses a session whose move was reported late', async () => {
		// The run waits for the report, so the session reads as on the database by the time the
		// next one looks, and no second session is started.
		const api = new FakeApi();
		api.onConnect = 'connect-reported-late';

		await runner(api).run(await document(), CONNECTION, 'SELECT 1');
		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 2');

		assert.deepStrictEqual({ outcome, started: api.started }, { outcome: { kind: 'executed', sessionId: 'new-1' }, started: 1 });
	});

	test('a connect line that finishes without Positron reporting the move counts as failed', async () => {
		// The statement would otherwise run against the in-memory database the session started on.
		const api = new FakeApi();
		api.onConnect = 'unreported';

		const outcome = await runner(api, 10).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(
			{ outcome, executed: api.executed },
			{ outcome: { kind: 'connect-failed' }, executed: [['new-1', SHOP]] },
		);
	});

	test('a failed connect is reported as such before the startup database is known', async () => {
		// Not as an exit: the session is still running.
		const api = new FakeApi();
		api.startCode = undefined;
		api.onConnect = 'fail';

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(outcome, { kind: 'connect-failed' });
	});

	test('a session that exits while connecting does not hold the run up', async () => {
		// An execution in a session that has exited never finishes, so the exit is what ends the
		// wait. Without it, the run guard would stay set and every later Cmd+Enter would do nothing.
		const api = new FakeApi();
		api.onConnect = 'exit';

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(outcome, { kind: 'exited' });
	});

	test('a statement that never finishes does not hold the run up', async () => {
		// The user's query may take as long as it takes; the console queues the next one behind it.
		const api = new FakeApi();
		api.addSession('gg', SHOP);
		api.statementsSettle = false;

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(outcome, { kind: 'executed', sessionId: 'gg' });
	});

	test('a connection ggsql cannot reach is not sent anywhere', async () => {
		const api = new FakeApi();
		api.connectCode = { kind: 'unsupported' };

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(
			{ outcome, started: api.started, executed: api.executed },
			{ outcome: { kind: 'unsupported' }, started: 0, executed: [] },
		);
	});

	test('no ggsql runtime is reported as such, rather than as a failed start', async () => {
		const api = new FakeApi();
		api.runtime = undefined;

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(outcome, { kind: 'no-runtime' });
	});

	test('a ggsql that will not start says why', async () => {
		const api = new FakeApi();
		api.startError = new Error('kernel died');

		const outcome = await runner(api).run(await document(), CONNECTION, 'SELECT 1');

		assert.deepStrictEqual(outcome, { kind: 'not-started', reason: 'kernel died' });
	});
});

function runner(api: ExecutionApi, reportTimeoutMs?: number): StatementRunner {
	return new StatementRunner(api, testLog().log, reportTimeoutMs);
}

function document(): Thenable<vscode.TextDocument> {
	return sqlDocument('SELECT 1');
}

/** A running session, as the runtime API reports one. Only the fields this module reads. */
function session(
	sessionId: string,
	sessionMode = positron.LanguageRuntimeSessionMode.Console,
): positron.BaseLanguageRuntimeSession {
	return {
		metadata: { sessionId, sessionMode },
		runtimeMetadata: { languageId: GGSQL_LANGUAGE_ID },
	} as positron.BaseLanguageRuntimeSession;
}

/**
 * Positron and ggsql as far as the runner can see them: the sessions running, which database each
 * is on, and what happens when one is told to connect.
 */
class FakeApi implements ExecutionApi {
	public connectCode: ConnectCode = { kind: 'code', code: SHOP };
	public runtime: positron.LanguageRuntimeMetadata | undefined =
		{ runtimeId: 'ggsql', runtimeName: 'ggsql' } as positron.LanguageRuntimeMetadata;
	public startError: Error | undefined;

	/**
	 * What a session does with an `@connect` line: move, move with Positron's report of it
	 * landing after the line finishes, finish without Positron ever reporting a move, report an
	 * error, or exit.
	 */
	public onConnect: 'connect' | 'connect-reported-late' | 'unreported' | 'fail' | 'exit' = 'connect';

	/** Where a new session starts, as far as Positron has heard by the time it is connected. */
	public startCode: string | undefined = MEMORY;

	/** Whether the user's statements finish. */
	public statementsSettle = true;

	public readonly executed: [string, string][] = [];
	public started = 0;

	private readonly _sessions: positron.BaseLanguageRuntimeSession[] = [];
	private readonly _codes = new Map<string, string>();
	private readonly _onDidChange = new vscode.EventEmitter<positron.SessionConnectionCodeChangeEvent>();
	public readonly onDidChangeSessionConnectionCode = this._onDidChange.event;
	private readonly _onDidEnd = new vscode.EventEmitter<string>();

	public addSession(sessionId: string, code: string | undefined, mode = positron.LanguageRuntimeSessionMode.Console): void {
		this._sessions.push(session(sessionId, mode));
		if (code !== undefined) {
			this._codes.set(sessionId, code);
		}
	}

	onDidEndSession(sessionId: string, listener: () => void): vscode.Disposable {
		return this._onDidEnd.event(ended => {
			if (ended === sessionId) {
				listener();
			}
		});
	}

	async getConnectCode(): Promise<ConnectCode> {
		return this.connectCode;
	}

	async getSessionConnectionCode(sessionId: string): Promise<string | undefined> {
		return this._codes.get(sessionId);
	}

	async getForegroundSession(): Promise<positron.BaseLanguageRuntimeSession | undefined> {
		return this._sessions[0];
	}

	async getActiveSessions(): Promise<positron.BaseLanguageRuntimeSession[]> {
		return [...this._sessions];
	}

	async getPreferredRuntime(): Promise<positron.LanguageRuntimeMetadata | undefined> {
		return this.runtime;
	}

	async startSession(): Promise<string> {
		if (this.startError) {
			throw this.startError;
		}
		this.started += 1;
		const sessionId = `new-${this.started}`;
		// A new ggsql session starts on an in-memory database.
		this.addSession(sessionId, this.startCode);
		return sessionId;
	}

	executeCode(code: string, sessionId: string): Thenable<unknown> {
		this.executed.push([sessionId, code]);
		if (!code.startsWith('-- @connect: ')) {
			return this.statementsSettle ? Promise.resolve() : new Promise(() => { });
		}
		switch (this.onConnect) {
			case 'connect':
				this._codes.set(sessionId, code);
				this._onDidChange.fire({ sessionId, code });
				return Promise.resolve();
			case 'connect-reported-late':
				return Promise.resolve().then(() => {
					// After the runner has had the chance to act on the line's result.
					setTimeout(() => {
						this._codes.set(sessionId, code);
						this._onDidChange.fire({ sessionId, code });
					}, 0);
				});
			case 'unreported':
				return Promise.resolve();
			case 'fail':
				return Promise.reject({ message: 'Could not set lock on file' });
			case 'exit':
				this._codes.delete(sessionId);
				this._onDidChange.fire({ sessionId, code: undefined });
				this._onDidEnd.fire(sessionId);
				return new Promise(() => { });
		}
	}
}
