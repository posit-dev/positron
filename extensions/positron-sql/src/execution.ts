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
 * There is no SQL runtime to send it to. A `.sql` file has no console of its own, and Positron
 * resolves a console from the document's language id, so the ordinary path -- statement range
 * provider, then execute in the console for this language -- stops at the last step with nothing
 * to execute in.
 *
 * What runs the statement instead is the user's own R or Python session, through the connection
 * the Data Connections pane already knows how to set up there. That is the "Connect With" code:
 * `con <- DBI::dbConnect(...)` or `conn = psycopg2.connect(...)`. Once a session holds that
 * connection, the driver can write the code that runs a query through it, and the statement
 * becomes an ordinary console execution the user can see, scroll back to, and re-run.
 *
 * So a run is four questions, in this order:
 *
 *   1. Which connection is the file written against? -- already answered, per file, by the status
 *      bar picker (see `selection.ts`).
 *   2. Which language should it run in? -- see {@link chooseLanguage}.
 *   3. Does a session already hold that connection? -- see {@link findBinding}. If one does, it is
 *      used; this is the "if a connection doesn't already exist" part, and it is what stops a
 *      second connection being opened beside the first on every keystroke.
 *   4. What code runs the query through it? -- the driver's, via `generateQueryCode`.
 *
 * Only step 3 can be skipped, and only when the answer is yes. Step 4 cannot be guessed here: the
 * connection object is a DBI connection, a SQLAlchemy engine or a DBAPI connection depending on
 * which library the user connected with, and the three are queried differently.
 */

/**
 * The part of Positron this module drives.
 *
 * Injected rather than imported so the flow above can be tested without a database, a driver or a
 * running session behind it -- every branch of it is a decision about what the user has, and those
 * are worth pinning down.
 */
export interface ExecutionApi {
	getConnections(): Thenable<positron.DataConnectionSummary[]>;
	getSessionBindings(sessionId: string): Thenable<positron.DataConnectionBinding[]>;
	registerSessionBinding(binding: positron.DataConnectionBinding): Thenable<void>;
	connectDataConnectionWith(
		profileId: string,
		languageId: string,
		options: positron.ConnectDataConnectionOptions,
	): Thenable<positron.DataConnectionBinding | undefined>;
	generateQueryCode(binding: positron.DataConnectionBinding, query: string): Thenable<string | undefined>;
	getForegroundSession(): Thenable<positron.BaseLanguageRuntimeSession | undefined>;
	getActiveSessions(): Thenable<positron.BaseLanguageRuntimeSession[]>;

	/**
	 * The session's root variables.
	 *
	 * Deliberately the whole list rather than a lookup by name: the underlying API inspects a
	 * named variable's *children*, so asking it about `con` answers with what is inside `con`,
	 * which is not how you find out whether `con` is there.
	 */
	getSessionVariables(sessionId: string): Thenable<positron.RuntimeVariable[][]>;

	/** Runs a trivial expression, queued, so that awaiting it awaits what is already queued. */
	settle(languageId: string, sessionId: string): Thenable<unknown>;

	executeCode(languageId: string, code: string, sessionId: string, documentUri: vscode.Uri): Thenable<unknown>;

	/** Asks which language to run in, when nothing else has said. See {@link chooseLanguage}. */
	pickLanguage(candidates: readonly string[], connectionName: string): Thenable<string | undefined>;

	/** Asks which of the session's connections to run through. See {@link pickConnection}. */
	pickConnection(
		candidates: readonly ConnectionCandidate[],
		connectionName: string,
	): Thenable<ConnectionChoice | undefined>;
}

/** The Positron API itself, in the shape {@link ExecutionApi} asks for. */
export function positronExecutionApi(): ExecutionApi {
	return {
		getConnections: () => positron.dataConnections.getConnections(),
		getSessionBindings: sessionId => positron.dataConnections.getSessionBindings(sessionId),
		registerSessionBinding: binding => positron.dataConnections.registerSessionBinding(binding),
		connectDataConnectionWith: (profileId, languageId, options) =>
			positron.dataConnections.connectDataConnectionWith(profileId, languageId, options),
		generateQueryCode: (binding, query) =>
			positron.dataConnections.generateQueryCode(binding, query),
		getForegroundSession: () => positron.runtime.getForegroundSession(),
		getActiveSessions: () => positron.runtime.getActiveSessions(),
		getSessionVariables: sessionId => positron.runtime.getSessionVariables(sessionId),
		// `1` is a valid expression in every language a data connection driver generates code for,
		// and evaluating it silently costs nothing. What is being waited on is not the answer but
		// the queue: this is queued behind the connection code, so it resolves once that has run.
		settle: (languageId, sessionId) => positron.runtime.evaluateCode(
			languageId,
			'1',
			undefined /* cancellationToken */,
			sessionId,
			positron.RuntimeBusyBehavior.Queue,
		),
		executeCode: (languageId, code, sessionId, documentUri) => positron.runtime.executeCode(
			languageId,
			code,
			// Not focused: the user is typing in the editor, and taking focus to the console on
			// every run would put their next keystroke somewhere they were not looking.
			false,
			// The driver wrote this code, and it wrote one expression. There is nothing incomplete
			// for the runtime to wait for more of.
			false,
			undefined /* mode */,
			undefined /* errorBehavior */,
			undefined /* observer */,
			sessionId,
			documentUri,
		),
		pickLanguage,
		pickConnection,
	};
}

/**
 * How a run ended, in the caller's terms rather than the API's.
 *
 * Every case other than `executed` is something the user needs told, and each one is told
 * differently, which is why they are kept apart rather than collapsed into a boolean. `cancelled`
 * is the exception: dismissing a dialog is an answer, and answering it with a notification would
 * be arguing.
 */
export type ExecutionOutcome =
	| { readonly kind: 'executed'; readonly binding: positron.DataConnectionBinding; readonly code: string }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'no-connection' }
	| { readonly kind: 'no-language' }
	| { readonly kind: 'connect-failed'; readonly binding: positron.DataConnectionBinding }
	| { readonly kind: 'no-query-code'; readonly binding: positron.DataConnectionBinding };

/**
 * A connection a session holds, as offered to the user when asked which to run through.
 *
 * Two sorts end up here and they are not equally well known. One Positron made, and so knows which
 * database it reaches and which library made it. The other the user made in their console, where
 * all Positron can say is that a variable of a connection-like type exists. Both are worth
 * offering; only the first can be described.
 */
export interface ConnectionCandidate {
	/** The variable holding it, which is what code will be written against. */
	readonly variableName: string;

	/** What the session says it is, e.g. `PqConnection`. Shown, so a wrong guess is visible. */
	readonly displayType: string;

	/** What Positron recorded about it, if Positron is what made it. */
	readonly binding?: positron.DataConnectionBinding;
}

/** What the user chose when asked which connection to run through. */
export type ConnectionChoice =
	| { readonly kind: 'existing'; readonly candidate: ConnectionCandidate }
	| { readonly kind: 'new' };

/**
 * Which language a statement runs in, and what decided it.
 *
 * `ask` carries the candidates rather than resolving them, so that the one case needing the user
 * is the one case that shows them something.
 */
export type LanguageChoice =
	| { readonly kind: 'language'; readonly languageId: string }
	| { readonly kind: 'ask'; readonly candidates: readonly string[] }
	| { readonly kind: 'none' };

/**
 * The language to run a connection's statements in.
 *
 * The session in front of the user wins whenever it can. Someone working in an R console who runs
 * a statement means that console: it holds their other objects, its output is what they are
 * reading, and sending the result to a Python session they cannot see would be a surprise even
 * though it would work.
 *
 * Only when the foreground session cannot be used -- there is none, or it speaks a language the
 * driver has no connection code for -- does anything else decide. Then a language the file has
 * been run in before, then the driver's only choice if it has one, and only after all of those is
 * the user asked. Asking is last because the answer is nearly always obvious from what is already
 * open, and a question with an obvious answer is one the user has to dismiss.
 *
 * Pure, and the whole rule.
 *
 * @param supported The languages the driver can generate connection code for.
 * @param foregroundLanguageId The language of the session in front of the user, if there is one.
 * @param remembered The language this file was run in before, if it has been.
 */
export function chooseLanguage(
	supported: readonly string[],
	foregroundLanguageId: string | undefined,
	remembered: string | undefined,
): LanguageChoice {
	if (supported.length === 0) {
		// A driver that generates no connection code: its connections can be browsed in the pane,
		// but there is no way to hand one to a session.
		return { kind: 'none' };
	}
	if (foregroundLanguageId && supported.includes(foregroundLanguageId)) {
		return { kind: 'language', languageId: foregroundLanguageId };
	}
	if (remembered && supported.includes(remembered)) {
		return { kind: 'language', languageId: remembered };
	}
	if (supported.length === 1) {
		return { kind: 'language', languageId: supported[0] };
	}
	return { kind: 'ask', candidates: supported };
}

/**
 * The console session to run in for a language, or undefined if none is running.
 *
 * The foreground session when it speaks the language, so that a run lands in the console the user
 * is looking at; otherwise the first console session that does. Notebook sessions are passed over:
 * they belong to a notebook the user is not editing, and their output would appear in a cell.
 *
 * Undefined is not a failure. It means nobody has connected yet, and connecting starts a session
 * -- which is where the session id then comes from.
 *
 * @param languageId The language to run in.
 * @param foreground The session in front of the user, if there is one.
 * @param active Every session currently running.
 */
export function consoleSessionFor(
	languageId: string,
	foreground: positron.BaseLanguageRuntimeSession | undefined,
	active: readonly positron.BaseLanguageRuntimeSession[],
): string | undefined {
	if (foreground && isConsoleFor(foreground, languageId)) {
		return foreground.metadata.sessionId;
	}
	return active.find(session => isConsoleFor(session, languageId))?.metadata.sessionId;
}

function isConsoleFor(session: positron.BaseLanguageRuntimeSession, languageId: string): boolean {
	return session.runtimeMetadata.languageId === languageId
		&& session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console;
}

/**
 * Whether a session still holds the variable a binding names.
 *
 * Positron records a binding when the connection code is submitted and does not watch the session
 * afterwards, so a binding is a claim about the past. The user is free to remove the variable, or
 * to clear the workspace, and generating `DBI::dbGetQuery(con, ...)` against a `con` that is gone
 * produces an error in the console where a dialog offering to reconnect belongs.
 *
 * @param variables What `getSessionVariables` answered for the variable's access key.
 * @param variableName The name the binding claims.
 */
export function holdsVariable(
	variables: readonly (readonly positron.RuntimeVariable[])[],
	variableName: string,
): boolean {
	return rootVariables(variables).some(variable => variable.display_name === variableName);
}

/**
 * Flattens what `getSessionVariables` answers with, which is a list of lists.
 *
 * Asked with no access keys it is one list holding every root variable, which is what everything
 * here wants. The outer array exists for the by-access-key form.
 */
function rootVariables(
	variables: readonly (readonly positron.RuntimeVariable[])[],
): readonly positron.RuntimeVariable[] {
	return variables.flat();
}

/**
 * Types that name a database connection, matched against what the session reports a variable to
 * be.
 *
 * Every connection any of these drivers makes is one of two things: a connection object, whose
 * type name says so in every language (`PqConnection`, `duckdb_connection`, `DuckDBPyConnection`,
 * `SnowflakeConnection`), or a SQLAlchemy engine, which says `Engine`.
 *
 * A guess, and treated as one. It decides what to *offer*, never what to use: the user picks from
 * the list, and the list shows each variable's type so a wrong guess is visible rather than
 * silently acted on.
 */
const CONNECTION_TYPE_PATTERN = /connection|engine/i;

/**
 * How many times to wait for a just-submitted connection before calling it failed.
 *
 * More than one only because of the ordering gap described in `_confirmConnected`; a connection
 * that has genuinely finished is seen on the first. Each wait costs nothing once the runtime is
 * idle, so the extra rounds are paid for only when something is wrong.
 */
const CONNECTION_CHECKS = 3;

/**
 * The connections a session holds, as far as can be told from its variables.
 *
 * Recorded bindings come first and are trusted: Positron made those, and knows which database each
 * reaches and which library made it. The rest is what the variables themselves suggest -- the user
 * connecting by hand in the console is an ordinary thing to do, and a connection made that way is
 * just as usable as one Positron made.
 *
 * Pure, so what gets offered can be pinned down without a session behind it.
 *
 * @param variables The session's root variables.
 * @param recorded The bindings Positron has for this session, across every connection.
 */
export function connectionCandidates(
	variables: readonly (readonly positron.RuntimeVariable[])[],
	recorded: readonly positron.DataConnectionBinding[],
): ConnectionCandidate[] {
	const byName = new Map(recorded.map(binding => [binding.variableName, binding]));
	const candidates: ConnectionCandidate[] = [];
	for (const variable of rootVariables(variables)) {
		const binding = byName.get(variable.display_name);
		// A recorded binding is reason enough on its own. Its variable's type is whatever the
		// driver's library called it, and requiring that to also look like a connection would drop
		// connections Positron itself made.
		if (binding || CONNECTION_TYPE_PATTERN.test(variable.display_type)) {
			candidates.push({
				variableName: variable.display_name,
				displayType: variable.display_type,
				binding,
			});
		}
	}
	return candidates;
}

/**
 * Runs one SQL statement against the connection its file is written against.
 *
 * See the note at the top of this file for the shape of it. Everything here is the ordering of
 * those four questions and the handling of each way they can be answered with nothing; the
 * decisions themselves are the pure functions above.
 */
export class StatementRunner {

	constructor(
		private readonly _api: ExecutionApi,
		private readonly _log: SqlLog,
	) { }

	/**
	 * @param document The file the statement came from, so the execution is attributed to it.
	 * @param connection The connection the file is written against.
	 * @param query The statement to run, as the user wrote it.
	 * @param remembered The language this file was last run in, if it has been run.
	 */
	public async run(
		document: vscode.TextDocument,
		connection: ConnectionRef,
		query: string,
		remembered: string | undefined,
	): Promise<ExecutionOutcome> {
		// Read afresh rather than from the schema the editor features use: that one holds the
		// connections that are open, and a statement can be run against a connection that is not.
		// Nothing here needs the pane's connection -- the session opens its own.
		const summary = (await this._api.getConnections())
			.find(candidate => candidate.profileId === connection.profileId);
		if (!summary) {
			this._log.warn(`${connection.name} no longer exists, so ${document.uri.toString(true)}`
				+ ' has nothing to run against.');
			return { kind: 'no-connection' };
		}

		const languageId = await this._chooseLanguage(summary, remembered);
		if (!languageId) {
			// Either the driver offers no language, or the user dismissed the pick. The two read
			// the same from here; `chooseLanguage` is what told them apart.
			return summary.supportedLanguageIds.length === 0
				? { kind: 'no-language' }
				: { kind: 'cancelled' };
		}

		const bound = await this._bind(summary, languageId);
		if (bound.kind !== 'bound') {
			return bound;
		}
		const { binding } = bound;

		const code = await this._api.generateQueryCode(binding, query);
		if (!code) {
			this._log.warn(`The ${summary.driverName} driver cannot run a query through a`
				+ ` ${binding.variantId} connection in ${languageId}.`);
			return { kind: 'no-query-code', binding };
		}

		this._log.info(`Running a statement from ${document.uri.toString(true)} against`
			+ ` ${summary.name} as '${binding.variableName}' in session ${binding.sessionId}.`);
		await this._api.executeCode(languageId, code, binding.sessionId, document.uri);
		return { kind: 'executed', binding, code };
	}

	/** Step 2: which language, asking only when nothing else has said. */
	private async _chooseLanguage(
		summary: positron.DataConnectionSummary,
		remembered: string | undefined,
	): Promise<string | undefined> {
		const foreground = await this._api.getForegroundSession();
		const choice = chooseLanguage(
			summary.supportedLanguageIds,
			foreground?.runtimeMetadata.languageId,
			remembered,
		);
		switch (choice.kind) {
			case 'language':
				return choice.languageId;
			case 'ask':
				return this._api.pickLanguage(choice.candidates, summary.name);
			case 'none':
				return undefined;
		}
	}

	/**
	 * Step 3: the connection to run through -- the one already remembered for this database, one
	 * the user points at, or a new one.
	 *
	 * The remembered one is used without asking, which is the whole point of remembering: a user
	 * who has connected once should not be asked again on every statement. It is confirmed first,
	 * because a binding records what was submitted rather than what survived, and writing
	 * `dbGetQuery(con, ...)` against a `con` that is gone produces an error in the console where
	 * an offer to reconnect belongs.
	 *
	 * Failing that, the session's own connections are offered before a new one is made. A session
	 * often already holds exactly the connection wanted -- opened by hand, or made for another
	 * file -- and connecting a second time beside it costs a round trip to the database and leaves
	 * the user with two of something they wanted one of.
	 *
	 * The Connect With dialog is what makes a new one, shown rather than skipped: which library to
	 * connect with, and whether to put a stored password into code that lands in console history,
	 * are the user's decisions.
	 */
	private async _bind(
		summary: positron.DataConnectionSummary,
		languageId: string,
	): Promise<BindOutcome> {
		const sessionId = await this._sessionFor(languageId);
		const session = sessionId ? await this._readSession(sessionId) : undefined;

		if (session) {
			const remembered = session.bindings.find(binding =>
				binding.profileId === summary.profileId
				&& holdsVariable(session.variables, binding.variableName));
			if (remembered) {
				this._log.trace(`${summary.name} is already held by session ${session.sessionId}`
					+ ` as '${remembered.variableName}'.`);
				return { kind: 'bound', binding: remembered };
			}

			const candidates = connectionCandidates(session.variables, session.bindings);
			if (candidates.length > 0) {
				const choice = await this._api.pickConnection(candidates, summary.name);
				if (!choice) {
					return { kind: 'cancelled' };
				}
				if (choice.kind === 'existing') {
					return { kind: 'bound', binding: await this._adopt(summary, languageId, session.sessionId, choice.candidate) };
				}
			}
		}

		// Nothing to reuse, or the user asked for a new one. The names already in the session go
		// with the request so that the code they are shown binds a name that is free -- connecting
		// to a second database must not overwrite the first.
		const binding = await this._api.connectDataConnectionWith(summary.profileId, languageId, {
			takenVariableNames: session
				? rootVariables(session.variables).map(variable => variable.display_name)
				: [],
		});
		if (!binding) {
			// The user closed the dialog. They were asked and they said no, so there is nothing
			// further to tell them.
			return { kind: 'cancelled' };
		}
		return this._confirmConnected(binding);
	}

	/**
	 * Records a connection the user pointed at, so the next statement against this database uses
	 * it without asking.
	 *
	 * A candidate Positron made keeps its variant -- it knows which library made it. One the user
	 * made by hand carries none, and code generated against it assumes the driver's preferred
	 * library, which is what the Connect With dialog would have suggested to them.
	 */
	private async _adopt(
		summary: positron.DataConnectionSummary,
		languageId: string,
		sessionId: string,
		candidate: ConnectionCandidate,
	): Promise<positron.DataConnectionBinding> {
		const binding: positron.DataConnectionBinding = {
			profileId: summary.profileId,
			sessionId,
			languageId,
			variantId: candidate.binding?.variantId,
			variableName: candidate.variableName,
		};
		await this._api.registerSessionBinding(binding);
		this._log.info(`${summary.name} will be queried through '${candidate.variableName}'`
			+ ` in session ${sessionId}.`);
		return binding;
	}

	/**
	 * Waits for a just-submitted connection to finish, and reports whether it worked.
	 *
	 * Connecting is submitted to the console, not awaited by it, so without this the query would
	 * be queued straight behind a connection that may be about to fail -- and the user would get
	 * two errors, the real one and a bewildering "object 'con' not found" underneath it.
	 *
	 * The wait is a trivial expression queued behind the connection code rather than a poll: it
	 * runs when the connection code has finished, however long that takes, and not before. What it
	 * evaluates to does not matter. The variable is then either there or it is not.
	 */
	private async _confirmConnected(
		binding: positron.DataConnectionBinding,
	): Promise<BindOutcome> {
		try {
			// More than one round, because the two are only loosely ordered. Submitting the
			// connection code resolves once the console has taken it, which is not quite the same
			// moment the runtime starts running it -- so a wait that arrives in the gap finds the
			// runtime idle and returns before the connection has begun. A second round cannot land
			// in that gap, the first having already been queued behind the same work.
			for (let attempt = 0; attempt < CONNECTION_CHECKS; attempt += 1) {
				await this._api.settle(binding.languageId, binding.sessionId);
				const variables = await this._api.getSessionVariables(binding.sessionId);
				if (holdsVariable(variables, binding.variableName)) {
					return { kind: 'bound', binding };
				}
			}
			this._log.warn(`The connection code did not leave '${binding.variableName}' in`
				+ ` session ${binding.sessionId}, so the query was not run.`);
			return { kind: 'connect-failed', binding };
		} catch (error) {
			// A session that cannot be asked -- one whose runtime does not support evaluation, or
			// which has gone away -- is one this cannot vouch for either way. Running the query is
			// the better of the two guesses: the connection may well have worked, and if it did
			// not, the console already says why.
			this._log.warn(`Could not confirm the connection in session ${binding.sessionId}: ${error}`);
			return { kind: 'bound', binding };
		}
	}

	/** The console session to run in, if one is running for the language. */
	private async _sessionFor(languageId: string): Promise<string | undefined> {
		const [foreground, active] = await Promise.all([
			this._api.getForegroundSession(),
			this._api.getActiveSessions(),
		]);
		return consoleSessionFor(languageId, foreground, active);
	}

	/**
	 * What a session holds: its variables and the connections Positron recorded in it.
	 *
	 * Undefined when the session cannot be asked -- busy starting, or already gone. Everything that
	 * reads this treats that as "holds nothing", which costs a dialog that need not have appeared
	 * and never costs code written against a variable that is not there.
	 */
	private async _readSession(sessionId: string): Promise<SessionContents | undefined> {
		try {
			const [variables, bindings] = await Promise.all([
				this._api.getSessionVariables(sessionId),
				this._api.getSessionBindings(sessionId),
			]);
			return { sessionId, variables, bindings };
		} catch (error) {
			this._log.warn(`Could not read session ${sessionId}: ${error}`);
			return undefined;
		}
	}
}

/** What {@link StatementRunner._bind} settled on, or why it did not. */
type BindOutcome =
	| { readonly kind: 'bound'; readonly binding: positron.DataConnectionBinding }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'connect-failed'; readonly binding: positron.DataConnectionBinding };

/** A session's variables and the connections Positron recorded in it, read together. */
interface SessionContents {
	readonly sessionId: string;
	readonly variables: positron.RuntimeVariable[][];
	readonly bindings: positron.DataConnectionBinding[];
}

/**
 * Asks which of a session's connections to run a database's queries through.
 *
 * Shown once per database per session -- the answer is remembered, so the next statement runs
 * without a prompt. Each entry names the variable, because that is what will appear in the code
 * that runs, and says what it is: the database Positron made it for, or failing that the type the
 * session reports, which is how a variable that only looked like a connection gives itself away.
 */
export async function pickConnection(
	candidates: readonly ConnectionCandidate[],
	connectionName: string,
): Promise<ConnectionChoice | undefined> {
	const CREATE_NEW = Symbol('create-new');
	type Item = vscode.QuickPickItem & { readonly choice: ConnectionCandidate | typeof CREATE_NEW };

	const items: Item[] = candidates.map(candidate => ({
		label: candidate.variableName,
		description: candidate.binding
			? undefined
			// Only for one Positron did not make. For one it did, the description would repeat the
			// database named in the dialog's title.
			: candidate.displayType,
		detail: candidate.binding
			? vscode.l10n.t("Connected by Positron")
			: vscode.l10n.t("Already in your session"),
		choice: candidate,
	}));
	items.push({
		label: vscode.l10n.t("Create a New Connection..."),
		detail: vscode.l10n.t("Open the Connect With dialog for {0}", connectionName),
		choice: CREATE_NEW,
	});

	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t("Run SQL Against {0}", connectionName),
		placeHolder: vscode.l10n.t("Choose the connection to run the query through"),
	});
	if (!picked) {
		return undefined;
	}
	return picked.choice === CREATE_NEW
		? { kind: 'new' }
		: { kind: 'existing', candidate: picked.choice };
}

/**
 * Asks which language to run a connection's statements in.
 *
 * Only reached when the driver supports several and nothing open says which; see
 * {@link chooseLanguage}. Named by the connection, because that is what the answer is about -- the
 * user is choosing how to talk to this database, not what this file is.
 */
export async function pickLanguage(
	candidates: readonly string[],
	connectionName: string,
): Promise<string | undefined> {
	const items = candidates.map(languageId => ({
		label: languageName(languageId),
		languageId,
	}));
	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t("Run SQL Against {0}", connectionName),
		placeHolder: vscode.l10n.t("Choose the language to connect and run the query in"),
	});
	return picked?.languageId;
}

/**
 * The display name for a language a driver supports.
 *
 * A short table rather than a lookup: the languages a data connection driver can generate code for
 * are the languages Positron runs, and an id that is not one of them is better shown as itself
 * than as nothing.
 */
function languageName(languageId: string): string {
	switch (languageId) {
		case 'python':
			return 'Python';
		case 'r':
			return 'R';
		default:
			return languageId;
	}
}
