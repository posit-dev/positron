/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { SqlLog } from './log';
import { ConnectionRef } from './schema';

/**
 * Running a SQL statement against the data connection its file is written against.
 *
 * Statements run in a ggsql console. ggsql is a SQL runtime in its own right -- a kernel and a
 * console that run SQL as written -- so there is no R or Python to generate around the statement:
 * what the user wrote is the code that runs, and it lands in a console they can scroll back
 * through.
 *
 * What it runs against is the one thing to arrange. A ggsql session holds one database at a time.
 * It starts on an in-memory DuckDB and moves when it executes `-- @connect: <uri>`, and the file's
 * completions and diagnostics are scoped to the file's connection, so the statement has to reach
 * that same database. Three facts decide how:
 *
 *   - The data connection's driver writes the `@connect` line. It owns the connection's
 *     parameters, and the DuckDB and SQLite drivers already generate it as their ggsql connection
 *     code. Drivers that do not are drivers ggsql cannot reach yet.
 *   - Positron reports the `@connect` line for the database each ggsql session is on (see
 *     `positron.dataConnections.getSessionConnectionCode`), in the same form, so the two compare
 *     directly.
 *   - Connecting always reconnects, even to the database the session is already on, and that wipes
 *     an in-memory database. So a session is never sent `@connect` for where it already is, and
 *     never re-pointed away from a database the user may be working in.
 *
 * Which gives one session per connection: a ggsql console already on the file's database takes the
 * statement; otherwise a new one is started, connected, and confirmed connected before the
 * statement follows.
 */

/** The language id ggsql registers its runtime under. */
export const GGSQL_LANGUAGE_ID = 'ggsql';

/** The extension that provides the ggsql runtime, as published to the extension gallery. */
export const GGSQL_EXTENSION_ID = 'ggsql.ggsql';

/**
 * How long a finished `@connect` line waits for Positron's report of the move. The report follows
 * the line within milliseconds; this only bounds a connect that finished without moving.
 */
const CONNECT_REPORT_TIMEOUT_MS = 5000;

/**
 * The part of Positron this module drives.
 *
 * Injected rather than imported so the flow above can be tested without ggsql installed: every
 * branch of it is a decision about what the user has running, and those are worth pinning down.
 */
export interface ExecutionApi {
	/** The ggsql connection code for a connection, or why there is none. */
	getConnectCode(profileId: string): Thenable<ConnectCode>;

	/** The `@connect` line for the database a session is on, or undefined if unknown. */
	getSessionConnectionCode(sessionId: string): Thenable<string | undefined>;
	readonly onDidChangeSessionConnectionCode: vscode.Event<positron.SessionConnectionCodeChangeEvent>;

	/** Calls back once a session has exited, or soon after if it has already. */
	onDidEndSession(sessionId: string, listener: () => void): vscode.Disposable;

	getForegroundSession(): Thenable<positron.BaseLanguageRuntimeSession | undefined>;
	getActiveSessions(): Thenable<positron.BaseLanguageRuntimeSession[]>;
	getPreferredRuntime(languageId: string): Thenable<positron.LanguageRuntimeMetadata | undefined>;

	/** Starts a new console session for a runtime, resolving to its id. */
	startSession(runtime: positron.LanguageRuntimeMetadata): Thenable<string>;

	/**
	 * Executes code in a ggsql session, resolving once it has run.
	 *
	 * @param documentUri The file the code came from, if it came from one.
	 */
	executeCode(code: string, sessionId: string, documentUri?: vscode.Uri): Thenable<unknown>;
}

/** What the Data Connections pane's getConnectionCode command answers with. */
interface ConnectionCodeResult {
	readonly languages?: Record<string, { readonly code: string } | undefined>;
	readonly reason?: string;
}

/** The ggsql connection code for a connection, or why there is none. */
export type ConnectCode =
	| { readonly kind: 'code'; readonly code: string }
	/** The connection is gone. */
	| { readonly kind: 'no-connection' }
	/** Its driver writes no ggsql code: ggsql cannot reach this kind of database yet. */
	| { readonly kind: 'unsupported' }
	/** Data Connections is off, or the driver's extension is not running. */
	| { readonly kind: 'unavailable'; readonly reason: string };

/** The Positron API itself, in the shape {@link ExecutionApi} asks for. */
export function positronExecutionApi(): ExecutionApi {
	return {
		getConnectCode: async profileId => {
			const result = await vscode.commands.executeCommand<ConnectionCodeResult | undefined>(
				'positronDataConnections.getConnectionCode',
				{ profileId, languageId: GGSQL_LANGUAGE_ID },
			);
			const code = result?.languages?.[GGSQL_LANGUAGE_ID]?.code;
			if (code) {
				return { kind: 'code', code };
			}
			switch (result?.reason) {
				case 'not-found':
					return { kind: 'no-connection' };
				case 'no-code':
					return { kind: 'unsupported' };
				case 'no-driver':
					return { kind: 'unavailable', reason: vscode.l10n.t("its driver is not available") };
				default:
					return { kind: 'unavailable', reason: vscode.l10n.t("Data Connections is turned off") };
			}
		},
		getSessionConnectionCode: sessionId => positron.dataConnections.getSessionConnectionCode(sessionId),
		onDidChangeSessionConnectionCode: positron.dataConnections.onDidChangeSessionConnectionCode,
		onDidEndSession: (sessionId, listener) => {
			let subscription: vscode.Disposable | undefined;
			let disposed = false;
			positron.runtime.getSession(sessionId).then(session => {
				if (disposed) {
					return;
				}
				if (!session || session.getRuntimeState?.() === positron.RuntimeState.Exited) {
					listener();
					return;
				}
				subscription = session.onDidChangeRuntimeState?.(state => {
					if (state === positron.RuntimeState.Exited) {
						listener();
					}
				});
			}, () => {
				if (!disposed) {
					listener();
				}
			});
			return new vscode.Disposable(() => {
				disposed = true;
				subscription?.dispose();
			});
		},
		getForegroundSession: () => positron.runtime.getForegroundSession(),
		getActiveSessions: () => positron.runtime.getActiveSessions(),
		getPreferredRuntime: languageId => positron.runtime.getPreferredRuntime(languageId),
		startSession: async runtime =>
			(await positron.runtime.startLanguageRuntime(runtime.runtimeId, runtime.runtimeName)).metadata.sessionId,
		executeCode: (code, sessionId, documentUri) => positron.runtime.executeCode(
			GGSQL_LANGUAGE_ID,
			code,
			// Not focused: the user is typing in the editor, and taking focus to the console on
			// every run would put their next keystroke somewhere they were not looking.
			false,
			// A statement as the user wrote it, which the console runs whole.
			false,
			undefined /* mode */,
			undefined /* errorBehavior */,
			undefined /* observer */,
			sessionId,
			documentUri,
		),
	};
}

/**
 * How a run ended, in the caller's terms rather than the API's.
 *
 * Every case other than `executed` is something the user needs told, and each is told differently.
 */
export type ExecutionOutcome =
	/**
	 * Sent to a session on the file's database. Its result, or its error, is the console's to show,
	 * like anything else run there.
	 */
	| { readonly kind: 'executed'; readonly sessionId: string }
	| { readonly kind: 'no-connection' }
	| { readonly kind: 'unsupported' }
	| { readonly kind: 'unavailable'; readonly reason: string }
	/** No ggsql runtime is registered: ggsql is not installed. */
	| { readonly kind: 'no-runtime' }
	/** A ggsql session was asked for and did not start. */
	| { readonly kind: 'not-started'; readonly reason: string }
	/** The new session did not move to the file's database; it is still where it started. */
	| { readonly kind: 'connect-failed' }
	/** The new session exited before it connected. */
	| { readonly kind: 'exited' };

/**
 * The ggsql console session on a database, or undefined if none is.
 *
 * The foreground session when it is one, so a run lands in the console the user is looking at.
 * Notebook sessions are passed over: their output would appear in a cell of a notebook the user is
 * not editing.
 *
 * Pure, so the choice can be pinned down without a session behind it.
 *
 * @param connectCode The `@connect` line for the file's database.
 * @param foreground The session in front of the user, if there is one.
 * @param candidates Each ggsql console session, with the `@connect` line for where it is, if known.
 */
export function sessionOn(
	connectCode: string,
	foreground: positron.BaseLanguageRuntimeSession | undefined,
	candidates: readonly { readonly sessionId: string; readonly code: string | undefined }[],
): string | undefined {
	const on = candidates.filter(candidate => candidate.code === connectCode);
	return on.find(candidate => candidate.sessionId === foreground?.metadata.sessionId)?.sessionId
		?? on[0]?.sessionId;
}

/**
 * Runs one SQL statement against the connection its file is written against.
 *
 * See the note at the top of this file for the shape of it.
 */
export class StatementRunner {

	/**
	 * @param _reportTimeoutMs How long a finished `@connect` line waits for Positron to report the
	 *   session on the database before the connect counts as failed.
	 */
	constructor(
		private readonly _api: ExecutionApi,
		private readonly _log: SqlLog,
		private readonly _reportTimeoutMs = CONNECT_REPORT_TIMEOUT_MS,
	) { }

	/**
	 * @param document The file the statement came from, so the execution is attributed to it.
	 * @param connection The connection the file is written against.
	 * @param query The statement to run, as the user wrote it.
	 */
	public async run(
		document: vscode.TextDocument,
		connection: ConnectionRef,
		query: string,
	): Promise<ExecutionOutcome> {
		const connect = await this._api.getConnectCode(connection.profileId);
		if (connect.kind !== 'code') {
			this._log.warn(`No ggsql connection code for ${connection.name}: ${connect.kind}.`);
			return connect;
		}

		let sessionId = await this._sessionOn(connect.code);
		if (!sessionId) {
			const started = await this._startOn(connection, connect.code);
			if (started.kind !== 'connected') {
				return started;
			}
			sessionId = started.sessionId;
		}

		this._log.info(`Running a statement from ${document.uri.toString(true)} against`
			+ ` ${connection.name} in ggsql session ${sessionId}.`);
		// Not awaited. The statement is the user's and may take as long as it takes; the console
		// shows its result or its error, and the next Cmd+Enter is queued behind it there rather
		// than held up here.
		this._api.executeCode(query, sessionId, document.uri).then(undefined, error => {
			this._log.warn(`The statement from ${document.uri.toString(true)} failed in ggsql`
				+ ` session ${sessionId}: ${errorMessage(error)}`);
		});
		return { kind: 'executed', sessionId };
	}

	/** The ggsql console already on the database, if there is one. */
	private async _sessionOn(connectCode: string): Promise<string | undefined> {
		const [foreground, active] = await Promise.all([
			this._api.getForegroundSession(),
			this._api.getActiveSessions(),
		]);
		const consoles = active.filter(session =>
			session.runtimeMetadata.languageId === GGSQL_LANGUAGE_ID
			&& session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console);
		const candidates = await Promise.all(consoles.map(async session => ({
			sessionId: session.metadata.sessionId,
			code: await this._api.getSessionConnectionCode(session.metadata.sessionId),
		})));
		return sessionOn(connectCode, foreground, candidates);
	}

	/**
	 * Starts a ggsql console and moves it to the database.
	 *
	 * A new session rather than one already open, even when one is: a session on another database,
	 * or on one Positron cannot see, may be one the user is working in, and connecting it elsewhere
	 * would take that database away from them -- for good, if it was in memory.
	 */
	private async _startOn(connection: ConnectionRef, connectCode: string): Promise<StartOutcome> {
		const runtime = await this._api.getPreferredRuntime(GGSQL_LANGUAGE_ID).then(undefined, () => undefined);
		if (!runtime) {
			this._log.warn('No ggsql runtime is registered, so there is nothing to run SQL in.');
			return { kind: 'no-runtime' };
		}

		let sessionId: string;
		try {
			sessionId = await this._api.startSession(runtime);
		} catch (error) {
			this._log.warn(`Could not start ${runtime.runtimeName}: ${errorMessage(error)}`);
			return { kind: 'not-started', reason: errorMessage(error) };
		}

		this._log.info(`Connecting ggsql session ${sessionId} to ${connection.name}.`);
		switch (await this._connect(sessionId, connectCode)) {
			case 'connected':
				return { kind: 'connected', sessionId };
			case 'exited':
				this._log.warn(`ggsql session ${sessionId} exited before it connected to ${connection.name}.`);
				return { kind: 'exited' };
			case 'failed':
				this._log.warn(`ggsql session ${sessionId} did not connect to ${connection.name}.`);
				return { kind: 'connect-failed' };
		}
	}

	/**
	 * Sends the `@connect` line and resolves to how that went.
	 *
	 * Connected once Positron reports the session on the database. Failed if the line fails -- the
	 * session is still where it was, and ggsql's error in the console says why -- or if it finishes
	 * and no report follows within a few seconds. Exited if the session exits first, which is
	 * watched for because an execution in a session that exits never finishes.
	 *
	 * The report is what counts, not the line finishing: it travels apart from the line's result
	 * and can land on either side of it, and until it lands the session does not read as on the
	 * database, so the next run would start another one.
	 */
	private async _connect(sessionId: string, connectCode: string): Promise<'connected' | 'failed' | 'exited'> {
		const store: vscode.Disposable[] = [];
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await new Promise(resolve => {
				store.push(this._api.onDidChangeSessionConnectionCode(e => {
					// The startup connection can arrive after this is listening, and is not the
					// answer being waited for.
					if (e.sessionId === sessionId && e.code === connectCode) {
						resolve('connected');
					}
				}));
				store.push(this._api.onDidEndSession(sessionId, () => resolve('exited')));
				// Not attributed to the file: the line is Positron's doing, not a statement the
				// user ran from it.
				this._api.executeCode(connectCode, sessionId).then(() => {
					timer = setTimeout(() => {
						this._log.warn(`Connecting ggsql session ${sessionId} finished, but Positron did`
							+ ` not report it on the database within ${this._reportTimeoutMs} ms.`);
						resolve('failed');
					}, this._reportTimeoutMs);
				}, error => {
					this._log.warn(`Connecting ggsql session ${sessionId} failed: ${errorMessage(error)}`);
					resolve('failed');
				});
			});
		} finally {
			clearTimeout(timer);
			store.forEach(disposable => disposable.dispose());
		}
	}
}

/** What {@link StatementRunner._startOn} settled on, or why it did not. */
type StartOutcome =
	| { readonly kind: 'connected'; readonly sessionId: string }
	| Extract<ExecutionOutcome, { kind: 'no-runtime' | 'not-started' | 'connect-failed' | 'exited' }>;

/**
 * What a rejection says, for the log.
 *
 * A runtime error arrives as a plain object with a message rather than as an Error, and would
 * otherwise be logged as `[object Object]`.
 */
export function errorMessage(error: unknown): string {
	if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
		return error.message;
	}
	return String(error);
}
