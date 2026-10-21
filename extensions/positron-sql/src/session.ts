/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Analysis, EMPTY_ANALYSIS, SqlAnalyzer, StatementSpan } from './analyzer';
import { QUOTE_TRIGGERS, SqlCompletionItemProvider } from './completion';
import { collectDiagnostics } from './diagnostics';
import { defaultSchemaOf, dialectOfDriver } from './dialects';
import { ExecutionOutcome, GGSQL_EXTENSION_ID, positronExecutionApi, StatementRunner } from './execution';
import { hoverFor } from './hover';
import { collectLinks } from './links';
import { SqlLog } from './log';
import { ConnectionRef, DataConnectionsApi, EMPTY_SCHEMA, SchemaReader, schemaOfProfile, SqlSchema } from './schema';
import { SchemaIndex } from './schemaIndex';
import { ConnectionSelection, Donor, EffectiveSelection, resolveSelection } from './selection';
import { SqlStatementRangeProvider, statementAt } from './statementRange';
import { AUTOMATIC, ConnectionStatusBar, describeSelection, DialectInUse, explainDataConnectionsOff, pickConnection } from './statusBar';

/** The configuration section every setting this extension reads lives under. */
export const CONFIGURATION_SECTION = 'sql';

/** The setting, under {@link CONFIGURATION_SECTION}, that turns every feature on. Off by default. */
export const ENABLED_SETTING = 'enabled';

/** The command that re-reads the tables and columns of the user's data connections. */
const REFRESH_SCHEMA_COMMAND = 'sql.refreshDatabaseSchema';

/** The setting that switches Data Connections, and so every connection this reads, on and off. */
const DATA_CONNECTIONS_ENABLED_SETTING = 'dataConnections.enabled';

/** The command behind the status bar item, which scopes a file to one data connection. */
const SELECT_CONNECTION_COMMAND = 'sql.selectDataConnection';

/**
 * The command bound to cmd/ctrl+enter in a SQL editor, which runs one statement.
 *
 * It takes the binding over the Console's own Execute Code, which cannot serve a SQL file: that
 * command resolves a console from the document's language id, and there is no runtime for `sql`.
 * The statement runs in a ggsql console instead; see `execution.ts`.
 */
const RUN_STATEMENT_COMMAND = 'sql.runStatement';

/** Set when the user asks not to be offered ggsql again; see the `no-runtime` case of a run. */
const HIDE_GGSQL_INSTALL_KEY = 'sql.hideGgsqlInstallPrompt';

/** The compiled analyzer, built from `sql-analyzer/` and committed through Git LFS; see scripts/build-analyzer.mts. */
const ANALYZER_MODULE = path.join('resources', 'sql-analyzer.wasm');

/** What a file with no connection to draw on completes against, which is keywords only. */
const NO_SCHEMA = new SchemaIndex();

/** Documents this extension provides features for: every SQL document, whatever its scheme. */
const SQL_DOCUMENTS: vscode.DocumentSelector = { language: 'sql' };

/**
 * Schemes whose documents are another view of a file rather than one to fix: the left side of a
 * diff, a Live Share guest's copy, a pull request's version. They still get completions and hovers,
 * but no diagnostics, which would otherwise list every problem in the file a second time under a
 * document that cannot be edited. The same set the TypeScript extension leaves out.
 */
const NO_DIAGNOSTICS_SCHEMES: ReadonlySet<string> = new Set(['git', 'vsls', 'github', 'azurerepos']);

/**
 * How long to wait after a keystroke before re-analyzing a document for diagnostics.
 *
 * Long enough that typing a word does not parse the document once per character, short enough
 * that a squiggle appears while the user is still looking at what caused it.
 */
const DIAGNOSTIC_DELAY_MS = 300;

/**
 * How long to wait after Positron says the connections changed before reading them.
 *
 * Opening one connection can be several changes in a row -- the instance, then its state -- and
 * each would otherwise start a read of its own.
 */
const CONNECTION_CHANGE_DELAY_MS = 250;

/**
 * How many documents' analyses to keep.
 *
 * Enough for every SQL file a person has open at once, so that a schema read -- which asks every
 * open file for its diagnostics and its links -- parses each once rather than twice.
 */
const MAX_CACHED_ANALYSES = 32;

/**
 * How recently a file must have been written to be one Save As just wrote.
 *
 * Save As writes the file and then opens it, so this is generous; a file the user merely opens was
 * written whenever it was last saved.
 */
const JUST_WRITTEN_MS = 10_000;

/**
 * The part of `positron.dataConnections` a session uses: the reads, plus what it is told when
 * connections change and how it opens one. Injected so a session can be tested without a live
 * database behind it.
 */
export interface SessionApi extends DataConnectionsApi {
	readonly onDidChangeConnections: vscode.Event<void>;
	openConnection(profileId: string): Thenable<boolean>;
}

/** What a session needs of the extension context. */
export type SessionContext = Pick<vscode.ExtensionContext, 'extensionPath' | 'workspaceState' | 'globalState'>;

/**
 * The extension's state and the editor features that read it.
 *
 * All of it lives in this process: the parser is a WebAssembly module (see `analyzer.ts`) rather
 * than a language server, so there is nothing to launch, supervise or keep in step with the
 * user's settings -- a setting is simply read the next time a feature runs.
 */
export class SqlSession implements vscode.Disposable {

	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _diagnostics: vscode.DiagnosticCollection;

	/**
	 * Set when `sql.enabled` is turned off. A schema read or a connection pick can still be in
	 * flight then, and must not write to the diagnostics or status bar it has just lost.
	 */
	private _disposed = false;

	/** Compiled on first use: it takes a moment, and activation should not wait for it. */
	private _analyzer: SqlAnalyzer | undefined;

	/**
	 * Set once the module has failed to load, so the failure is reported once rather than on
	 * every keystroke, and not retried on every request either.
	 */
	private _analyzerUnavailable = false;

	/** Everything read from the user's connections, kept whole so a file can be scoped to part. */
	private _payload: SqlSchema = EMPTY_SCHEMA;

	/**
	 * Whether {@link _payload} has been read at least once. Before then the connections the user
	 * has configured are not known, and a file's choice cannot be told apart from one since removed.
	 */
	private _read = false;

	/**
	 * Whether a schema read has finished without being overtaken, whether or not it succeeded.
	 * Until then the status bar says it is reading rather than reporting connections it has not
	 * looked for.
	 */
	private _settled = false;

	/**
	 * Settles with {@link _settled}, which choosing a connection waits for so that it offers them
	 * all.
	 *
	 * Not the first read itself: a read overtaken by a later one -- a connection opening while the
	 * first is in flight -- finishes without setting anything, and whoever waited on it would take
	 * the empty schema for the answer.
	 */
	private readonly _firstRead: Promise<void>;
	private _resolveFirstRead!: () => void;

	/**
	 * Counts schema reads, so that one overtaken by a later read is dropped when it finishes.
	 *
	 * Reads are started by connection changes and can overlap: one begun while a connection was
	 * open can finish after one begun once it closed, and would otherwise put the closed
	 * connection's tables back.
	 */
	private _generation = 0;

	/**
	 * Indices over one connection each, built the first time a file scoped to it asks.
	 *
	 * Lazily, and thrown away whole on every read: a window usually has one connection open and a
	 * file open against it, and indexing every warehouse up front would be work for a question
	 * nobody asked.
	 */
	private readonly _scoped = new Map<string, SchemaIndex>();

	private readonly _selection: ConnectionSelection;

	/** Runs a statement in a ggsql session; see `execution.ts`. */
	private readonly _runner: StatementRunner;

	/**
	 * Whether a run is already in flight, so that a held-down cmd+enter does not start another.
	 *
	 * Starting and connecting a ggsql session takes a moment, and the cursor only moves on once
	 * that is done -- so without this, a second keypress would see the same cursor position and
	 * start a second session for the same database. Only that part is guarded: the statement
	 * itself is queued in the console and not waited for, so nothing the user leaves unanswered
	 * or a long query holds up the next run.
	 */
	private _running = false;

	/**
	 * Profiles already tried this session, so a connection that cannot be opened is attempted once
	 * rather than on every file that names it.
	 *
	 * Also what stops a fight with the user: someone who deliberately disconnects and then opens
	 * another file against the same database is not reconnected behind their back. The refresh
	 * command clears it, which is the way back to trying again.
	 */
	private readonly _attempted = new Set<string>();
	private readonly _statusBar: ConnectionStatusBar;

	private _keywords: readonly string[] | undefined;

	/** Dialects already reported as unrecognized, so each is said once and not per parse. */
	private readonly _reportedDialects = new Set<string>();

	/**
	 * The SQL documents most recently in front of the user, newest last: the one Save As was run
	 * from is one of these while the file it saved opens.
	 */
	private _recentlyActive: string[] = [];

	/**
	 * The connections configured as of the last read, so that one that has gone since is known to
	 * have been removed rather than not yet listed.
	 */
	private _configuredIds: ReadonlySet<string> | undefined;

	/** Reads the schema, walking only the connections that have something new to find. */
	private readonly _reader: SchemaReader;

	/** A read asked for by a connection change, waiting out {@link CONNECTION_CHANGE_DELAY_MS}. */
	private _pendingRead: NodeJS.Timeout | undefined;

	/** Pending re-analyses, one per document, so that typing does not parse on every keystroke. */
	private readonly _pending = new Map<string, NodeJS.Timeout>();

	/**
	 * Each open document's latest parse, by URI, least recently used first.
	 *
	 * Diagnostics, document links and hovers all want the whole document parsed, and the editor
	 * asks for links on the same version it has just been given diagnostics for. Kept per document
	 * because a schema read asks that of every open file at once.
	 */
	private readonly _cache = new Map<string, { key: string; analysis: Analysis }>();

	/** The document link provider's registration; see {@link _relink}. */
	private _links: vscode.Disposable | undefined;

	constructor(
		private readonly _context: SessionContext,
		private readonly _log: SqlLog,
		private readonly _api: SessionApi = positron.dataConnections,
		private readonly _changeDelayMs = CONNECTION_CHANGE_DELAY_MS,
	) {
		this._reader = new SchemaReader(_log, _api, undefined, () =>
			vscode.workspace.getConfiguration().get<boolean>(DATA_CONNECTIONS_ENABLED_SETTING) !== false);
		this._diagnostics = vscode.languages.createDiagnosticCollection('sql');
		this._selection = new ConnectionSelection(_context.workspaceState);
		this._statusBar = new ConnectionStatusBar(SELECT_CONNECTION_COMMAND);
		this._runner = new StatementRunner(positronExecutionApi(), _log);
		// The reader too, so that switching SQL off stops any schema walk still querying a database.
		this._disposables.push(this._diagnostics, this._statusBar, this._reader);
		this._firstRead = new Promise(resolve => { this._resolveFirstRead = resolve; });
	}

	public start(): void {
		this._disposables.push(
			// Registered for every SQL document, whatever its scheme, so that statements can be
			// sent to the Console from a file, an untitled buffer or a notebook cell.
			positron.languages.registerStatementRangeProvider(
				SQL_DOCUMENTS,
				new SqlStatementRangeProvider(
					() => this._require(),
					document => this._dialectFor(document),
				),
			),

			vscode.languages.registerCompletionItemProvider(
				SQL_DOCUMENTS,
				new SqlCompletionItemProvider(document => ({
					analyzer: this._require(),
					schema: this._schemaFor(document),
					dialect: this._dialectFor(document),
					keywords: this._keywordList(),
					log: this._log,
				})),
				// `.` changes what a completion means rather than just extending a prefix; the
				// editor triggers the rest itself as the user types an identifier, except inside a
				// quoted one, which the grammar calls a string and the editor leaves alone.
				'.',
				...QUOTE_TRIGGERS,
			),

			vscode.languages.registerHoverProvider(SQL_DOCUMENTS, {
				provideHover: (document, position) =>
					hoverFor(document, position, this._analyze(document), this._schemaFor(document)),
			}),

			vscode.commands.registerCommand(REFRESH_SCHEMA_COMMAND, () => {
				// Asked for by hand, so a connection that failed to open is worth trying again, and
				// one that stayed open may have new tables in it.
				this._attempted.clear();
				return this.refreshSchema(true);
			}),
			vscode.commands.registerCommand(SELECT_CONNECTION_COMMAND, () => this._selectConnection()),
			vscode.commands.registerCommand(RUN_STATEMENT_COMMAND, () => this._runStatement()),

			// The item speaks for the file in front of the user, so it changes with the editor.
			vscode.window.onDidChangeActiveTextEditor(() => {
				this._noteActive();
				this._updateStatusBar();
			}),

			vscode.workspace.onDidOpenTextDocument(document => {
				if (document.languageId === 'sql') {
					// This same buffer reopened in a new language keeps its choice, and a buffer just
					// saved as this file hands its choice over.
					if (this._selection.reopen(document.uri, document.getText())) {
						this._log.debug(`Kept the connection of ${document.uri.toString(true)} as it reopened.`);
					} else {
						void this._adopt(document);
					}
				}
				this._refresh(document);
				// A file that says which database it is written against says what to open, so the
				// user does not have to open it by hand before the file works.
				void this._openConnectionFor(document);
				// Changing a buffer's language closes and reopens it under the same editor, which
				// does not change the active editor, so the item is not otherwise told.
				this._updateStatusBar();
			}),
			vscode.workspace.onDidChangeTextDocument(event => {
				// A file saved from an untitled buffer opens empty and receives the buffer's text
				// as its first change, so that is when it can be matched to the buffer's choice.
				// Only then: later edits are the user's, not the save's.
				if (event.document.version <= 2) {
					void this._adopt(event.document);
				}
				this._schedule(event.document);
			}),
			vscode.workspace.onDidCloseTextDocument(document => {
				// Diagnostics outlive the document unless they are cleared, so a closed file would
				// keep its errors in the Problems panel with no editor to fix them in.
				this._cancel(document);
				this._diagnostics.delete(document.uri);
				this._cache.delete(document.uri.toString());
				const chosen = this._selection.get(document.uri);
				this._selection.forgetIfTransient(document.uri, document.getText());
				if (chosen && document.uri.scheme === 'untitled') {
					this._log.debug(`${document.uri.toString(true)} closed; its connection, ${chosen.name},`
						+ ' is kept for a document that replaces it.');
					// The file a buffer is saved as may already hold its text by the time the
					// buffer closes.
					for (const open of vscode.workspace.textDocuments) {
						if (open !== document && !open.isClosed) {
							void this._adopt(open);
						}
					}
				}
				this._updateStatusBar();
			}),

			// A choice is kept by file, so it moves when the file does.
			vscode.workspace.onDidRenameFiles(event => {
				let moved = false;
				for (const { oldUri, newUri } of event.files) {
					moved = this._selection.rename(oldUri, newUri) || moved;
				}
				if (!moved) {
					return;
				}
				// The editor opens a renamed file under its new name before saying it was renamed, so
				// by now it has been analyzed, linked and shown on the status bar with no connection.
				this._relink();
				this._refreshAll();
				this._updateStatusBar();
				for (const document of vscode.workspace.textDocuments) {
					void this._openConnectionFor(document);
				}
			}),

			vscode.workspace.onDidChangeConfiguration(event => {
				// Positron does not say the connections changed when the feature is switched on or
				// off, and every connection appears or disappears with it.
				if (event.affectsConfiguration(DATA_CONNECTIONS_ENABLED_SETTING)) {
					void this.refreshSchema(true);
				}
				if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.dialect`)
					|| event.affectsConfiguration(`${CONFIGURATION_SECTION}.diagnostics`)) {
					// The dialect and the diagnostics settings decide what a diagnostic is, and
					// every open document was analyzed under the old value. The dialect is on the
					// status bar hover too, and decides which names parse as tables, so the links.
					// Not connectOnOpen, which is read when a file opens.
					this._relink();
					this._refreshAll();
					this._updateStatusBar();
				}
			}),

			// The user connecting to or disconnecting from a database is what changes the answer,
			// and Positron says when that happens, so there is nothing to poll for.
			this._api.onDidChangeConnections(() => {
				clearTimeout(this._pendingRead);
				this._pendingRead = setTimeout(() => {
					this._pendingRead = undefined;
					void this.refreshSchema();
				}, this._changeDelayMs);
			}),
		);

		this._noteActive();
		this._relink();
		this._refreshAll();
		this._updateStatusBar();
		void this.refreshSchema();
	}

	/** Settles once a schema read has said what is known about the user's connections. */
	public whenRead(): Promise<void> {
		return this._firstRead;
	}

	/** What a document's choice comes to, given what is open and what is configured. */
	public selectionFor(document: vscode.TextDocument): EffectiveSelection {
		return this._resolve(document);
	}

	/** Everything the last schema read found. */
	public get schema(): SqlSchema {
		return this._payload;
	}

	public dispose(): void {
		this._disposed = true;
		// Nothing more will be read, and a pick waiting on the first read gives up on seeing it.
		this._resolveFirstRead();
		clearTimeout(this._pendingRead);
		for (const pending of this._pending.values()) {
			clearTimeout(pending);
		}
		this._pending.clear();
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._links?.dispose();
	}

	/**
	 * Opens the connection a file is written against, if it is not open already.
	 *
	 * Only for a file the user chose a connection for: the implicit "the only one open" case has
	 * nothing to open by definition, and a file with no choice has not said what it would mean.
	 * Opening is not free -- a driver may prompt for credentials and a warehouse may bill for
	 * waking up -- which is why it is confined to what the user has already said, and why the
	 * setting exists to switch it off.
	 */
	private async _openConnectionFor(document: vscode.TextDocument): Promise<void> {
		if (document.languageId !== 'sql') {
			return;
		}
		const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
		if (configuration.get<boolean>('connectOnOpen') === false) {
			return;
		}
		const chosen = this._selection.get(document.uri);
		if (!chosen || this._attempted.has(chosen.profileId)) {
			return;
		}
		if (!this._read || this._payload.dataConnectionsOff) {
			// Nothing is known to be open yet, so this would open a connection that may well be up
			// already. The first read asks again for every open file once it lands. Or nothing can
			// be opened, until the user switches Data Connections back on.
			return;
		}
		if (this._payload.connections.some(open => open.profileId === chosen.profileId)) {
			// Seen open is as good as opened here: if the user closes it later, that is on purpose,
			// and the next file against it must not open it again.
			this._attempted.add(chosen.profileId);
			return;
		}

		this._attempted.add(chosen.profileId);
		await this._open(chosen, document);
	}

	/** Opens a file's connection, reporting the outcome in the log rather than to the user. */
	private async _open(chosen: ConnectionRef, document: vscode.TextDocument): Promise<void> {
		try {
			const opened = await this._api.openConnection(chosen.profileId);
			// No refresh here: opening one fires onDidChangeConnections, which re-reads the schema
			// and brings the status bar and the diagnostics with it.
			this._log.info(opened
				? `Opened ${chosen.name} for ${document.uri.toString(true)}.`
				: `${chosen.name} could not be opened for ${document.uri.toString(true)}:`
				+ ' the connection no longer exists.');
		} catch (error) {
			// Expected rather than exceptional -- credentials expire, hosts go away, the user
			// switched Data Connections off -- so it is reported where the user can read the
			// reason rather than raised at them.
			this._log.warn(`Could not open ${chosen.name}, which`
				+ ` ${document.uri.toString(true)} is written against: ${error}`);
		}
	}

	/**
	 * Re-reads the user's data connections and re-analyzes every open document.
	 *
	 * @param fresh Walk every open connection again, rather than only those that just opened.
	 */
	public async refreshSchema(fresh = false): Promise<void> {
		const generation = ++this._generation;
		let payload: SqlSchema;
		try {
			payload = await this._reader.read(fresh);
		} catch (error) {
			// Completions still work without metadata: keywords are always available, and the
			// alternative to keeping the old schema is dropping tables the user can still see in
			// the Data Connections pane.
			this._log.warn(`Could not read the database schema: ${error}`);
			if (!this._disposed && generation === this._generation) {
				this._settle();
			}
			return;
		}
		if (this._disposed || generation !== this._generation) {
			// Switched off, or overtaken by a read that began after this one and knows better.
			return;
		}
		this._payload = payload;
		this._read = true;
		this._scoped.clear();
		this._forgetRemovedConnections(payload);
		// The schema decides which names are unknown, so every open document's diagnostics are
		// stale, and which names are tables, so its links are. The status bar is stale too: a
		// connection this file chose may have just closed.
		this._relink();
		this._refreshAll();
		this._updateStatusBar();
		this._settle();
	}

	/**
	 * Drops the files' choices of connections removed since the last read.
	 *
	 * Only ones seen in one read and gone in the next: a listing that comes back empty or short --
	 * Data Connections switched off, or the API failing -- is not the user removing anything, and
	 * a choice once dropped cannot be got back.
	 */
	private _forgetRemovedConnections(payload: SqlSchema): void {
		if (payload.dataConnectionsOff || payload.configured.length === 0) {
			return;
		}
		const current = new Set(payload.configured.map(connection => connection.profileId));
		const removed = new Set([...this._configuredIds ?? []].filter(profileId => !current.has(profileId)));
		this._configuredIds = current;
		if (removed.size > 0) {
			this._selection.forgetConnections(removed);
		}
	}

	/** Marks the first schema read that was not overtaken as done, the first time one is. */
	private _settle(): void {
		if (this._settled) {
			return;
		}
		this._settled = true;
		this._resolveFirstRead();
		this._updateStatusBar();
		// The files already open are asked about only once a read has said what is open already,
		// so a connection that is up is not opened a second time.
		for (const document of vscode.workspace.textDocuments) {
			void this._openConnectionFor(document);
		}
	}

	/**
	 * The tables a document completes and is checked against: one connection's, or none.
	 *
	 * A document whose connection is not open sees nothing rather than the connections that are.
	 * The tables of a database it was not written against would be worse than no tables at all --
	 * they would complete names that do not exist where the statement will run, and flag names
	 * that do.
	 */
	private _schemaFor(document: vscode.TextDocument): SchemaIndex {
		const selection = this._resolve(document);
		if (selection.kind === 'none') {
			return NO_SCHEMA;
		}
		const { profileId, driverId } = selection.connection;
		let index = this._scoped.get(profileId);
		if (!index) {
			// The engine's default schema, from the driver rather than from the dialect setting:
			// which schema an unqualified name reads is the database's behaviour, whatever the file
			// is being parsed as.
			index = new SchemaIndex(
				schemaOfProfile(this._payload, profileId),
				defaultSchemaOf(dialectOfDriver(driverId)),
			);
			this._scoped.set(profileId, index);
		}
		return index;
	}

	/** What a document's choice comes to, given what is open and what is configured. */
	private _resolve(document: vscode.TextDocument): EffectiveSelection {
		return resolveSelection(
			this._selection.get(document.uri),
			this._payload.connections,
			// With Data Connections off nothing is configured, but a file's choice is not one the
			// user removed and is kept for when it is back on.
			this._read && !this._payload.dataConnectionsOff ? this._payload.configured : undefined,
		);
	}

	/**
	 * Gives a document the choice of the document it was saved from, if it has none of its own,
	 * and brings everything that depends on the choice along with it.
	 */
	private async _adopt(document: vscode.TextDocument): Promise<void> {
		if (!this._mayAdopt(document) || !this._donorFor(document)) {
			return;
		}
		// Only a file Save As has just written. Otherwise opening a file that holds the same text as
		// the one in front of the user -- a copy of a query -- would look exactly like Save As, and
		// would hand it a connection it was never written against, and open that connection.
		if (!await this._justWritten(document.uri) || this._disposed || !this._mayAdopt(document)) {
			return;
		}
		const donor = this._donorFor(document);
		if (!donor || !this._selection.adopt(document.uri, document.getText(), donor)) {
			return;
		}
		this._log.debug(`${document.uri.toString(true)} took over the connection`
			+ ` ${this._selection.get(document.uri)?.name} of the buffer it was saved from.`);
		this._relink();
		this._refresh(document);
		this._updateStatusBar();
		void this._openConnectionFor(document);
	}

	/** Whether a document could take over another's choice at all. */
	private _mayAdopt(document: vscode.TextDocument): boolean {
		// Not another view of a file, such as a diff's left side: it holds the same text as the
		// file, but is not a file saved from it.
		return document.languageId === 'sql' && !document.isClosed && !this._selection.get(document.uri)
			&& !NO_DIAGNOSTICS_SCHEMES.has(document.uri.scheme);
	}

	/**
	 * The document a document may have been saved from: the SQL document the user was last in
	 * before it, which is where Save As is run from, with its text if it is still open.
	 *
	 * An open file on disk can be the one, not only an untitled buffer: Save As from a file leaves it
	 * open beside the new one, with the same text. An untitled buffer may have closed already.
	 */
	private _donorFor(document: vscode.TextDocument): Donor | undefined {
		const self = document.uri.toString();
		const previous = this._recentlyActive.filter(uri => uri !== self).at(-1);
		if (!previous) {
			return undefined;
		}
		const open = vscode.workspace.textDocuments.find(candidate =>
			!candidate.isClosed && candidate.uri.toString() === previous);
		return { uri: open?.uri ?? vscode.Uri.parse(previous), text: open?.getText() };
	}

	/** Whether a file was written in the last {@link JUST_WRITTEN_MS}, as one Save As wrote is. */
	private async _justWritten(uri: vscode.Uri): Promise<boolean> {
		try {
			const { mtime } = await vscode.workspace.fs.stat(uri);
			return Date.now() - mtime < JUST_WRITTEN_MS;
		} catch {
			// Not a file, or gone: nothing was saved as it.
			return false;
		}
	}

	/** Remembers the SQL document now in front of the user, if it is one; see {@link _recentlyActive}. */
	private _noteActive(): void {
		const active = activeSqlDocument()?.uri.toString();
		if (active && this._recentlyActive.at(-1) !== active) {
			this._recentlyActive = [...this._recentlyActive.filter(uri => uri !== active), active].slice(-2);
		}
	}

	/**
	 * Runs the statement under the cursor, or the selection, against the file's data connection.
	 *
	 * The work itself is in `execution.ts`; this is the editor's half of it -- finding what to
	 * run, making sure the file has said what to run it against, moving the cursor on afterwards,
	 * and saying what happened when nothing did.
	 */
	private async _runStatement(): Promise<void> {
		const editor = activeSqlEditor();
		if (!editor || this._running) {
			// The keybinding is scoped to SQL editors, but the command is still reachable by hand.
			return;
		}

		const target = this._statementToRun(editor);
		if (!target) {
			// An empty file, or a cursor past the last statement. Nothing to run and nothing to
			// explain: the user can see there is no statement there.
			return;
		}

		this._running = true;
		try {
			const connection = await this._connectionToRunAgainst(editor.document);
			if (!connection || this._disposed) {
				return;
			}
			const outcome = await this._runner.run(editor.document, connection, target.query);
			if (outcome.kind === 'executed') {
				// Only for a statement the cursor was in. A selection is what the user chose to
				// run, and moving off it would take their selection away.
				if (target.advance) {
					advance(editor, target.statements, target.statement);
				}
			} else {
				this._reportNotRun(outcome, connection);
			}
		} finally {
			this._running = false;
		}
	}

	/**
	 * Says why a statement was not run. Never awaited: a notification the user leaves alone must
	 * not hold up the next run.
	 */
	private _reportNotRun(
		outcome: Exclude<ExecutionOutcome, { kind: 'executed' }>,
		connection: ConnectionRef,
	): void {
		switch (outcome.kind) {
			case 'no-connection':
				void vscode.window.showWarningMessage(
					vscode.l10n.t("{0} is no longer one of your data connections.", connection.name),
					vscode.l10n.t("Choose a Connection"),
				).then(chosen => {
					if (chosen) {
						void this._selectConnection();
					}
				});
				break;

			case 'unsupported':
				void vscode.window.showWarningMessage(vscode.l10n.t(
					"Statements run in ggsql, which cannot connect to {0} yet. Only DuckDB and SQLite connections are supported.",
					connection.name,
				));
				break;

			case 'unavailable':
				void vscode.window.showWarningMessage(vscode.l10n.t(
					"The statement was not run against {0}: {1}",
					connection.name,
					outcome.reason,
				));
				break;

			case 'no-runtime': {
				// Offered rather than done: installing an extension is the user's call. The
				// extension's page shows what it is and has the Install button; `extension.open`
				// finds it in the gallery when it is not installed.
				//
				// A user who has said they do not want ggsql is not asked again on every Cmd+Enter.
				// Nothing can run without it, so the press does nothing beyond a line in the log.
				// Kept for the user rather than the workspace: not wanting ggsql is not about a
				// project.
				if (this._context.globalState.get<boolean>(HIDE_GGSQL_INSTALL_KEY) === true) {
					return;
				}
				const install = vscode.l10n.t("Install ggsql");
				const dontShowAgain = vscode.l10n.t("Don't Show Again");
				void vscode.window.showWarningMessage(
					vscode.l10n.t("Statements run in a ggsql console, and ggsql is not installed."),
					install,
					dontShowAgain,
				).then(chosen => {
					if (chosen === install) {
						void vscode.commands.executeCommand('extension.open', GGSQL_EXTENSION_ID);
					} else if (chosen === dontShowAgain) {
						void this._context.globalState.update(HIDE_GGSQL_INSTALL_KEY, true);
					}
				});
				break;
			}

			case 'not-started':
				void vscode.window.showWarningMessage(vscode.l10n.t(
					"ggsql could not start, so the statement was not run: {0}",
					outcome.reason,
				));
				break;

			case 'connect-failed':
				// The console shows ggsql's own error, which says far more about why than anything
				// here could. This says only that the statement was not run, so that error is not
				// mistaken for the statement's.
				void vscode.window.showWarningMessage(vscode.l10n.t(
					"ggsql could not connect to {0}, so the statement was not run. The Console shows why.",
					connection.name,
				));
				break;

			case 'exited':
				void vscode.window.showWarningMessage(vscode.l10n.t(
					"The ggsql session exited before it connected to {0}, so the statement was not run.",
					connection.name,
				));
				break;
		}
	}

	/**
	 * What cmd+enter runs: the selection if there is one, otherwise the statement at the cursor.
	 *
	 * A selection wins for the same reason it does everywhere else in Positron -- the user has
	 * said exactly what they mean, including when what they mean is half a statement.
	 */
	private _statementToRun(editor: vscode.TextEditor): StatementToRun | undefined {
		if (!editor.selection.isEmpty) {
			return { query: editor.document.getText(editor.selection), advance: false };
		}

		const analyzer = this._require();
		if (!analyzer) {
			return undefined;
		}
		const text = editor.document.getText();
		const statements = analyzer.statements(text, this._dialectFor(editor.document));
		const statement = statementAt(statements, editor.document.offsetAt(editor.selection.active));
		if (!statement) {
			return undefined;
		}
		return {
			query: text.slice(statement.start, statement.end),
			advance: true,
			statements,
			statement,
		};
	}

	/**
	 * The connection to run against, asking for one if the file has not said.
	 *
	 * A connection that is closed is still an answer: ggsql opens the database itself, which has
	 * nothing to do with whether the pane's connection is open.
	 */
	private async _connectionToRunAgainst(
		document: vscode.TextDocument,
	): Promise<ConnectionRef | undefined> {
		// Resolved as everything else is, so a connection the user has since removed is asked
		// about again rather than run against.
		const selection = this._resolve(document);
		if (selection.kind !== 'none') {
			return selection.connection;
		}

		// Nothing chosen and nothing to infer. Asked here rather than refused, because the user
		// pressed a key meaning "run this" and the only thing in the way is one pick -- or, with no
		// connection to pick from, a notification saying so.
		await this._selectConnection();
		return this._selection.get(document.uri);
	}

	/** Asks which connection the active SQL file is written against, and applies the answer. */
	private async _selectConnection(): Promise<void> {
		const document = activeSqlDocument();
		if (!document) {
			// The command is enabled only for SQL editors, but a keybinding can still reach it.
			return;
		}
		// Before the first read the connections set up are not known, and the picker would say
		// there are none. Shown as waiting, since a slow database can hold that up for a while and
		// the click would otherwise seem to do nothing.
		if (!this._settled) {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Window,
				title: vscode.l10n.t("Reading data connections"),
			}, () => this._firstRead);
		}
		if (this._disposed) {
			return;
		}
		if (this._payload.dataConnectionsOff) {
			explainDataConnectionsOff();
			return;
		}
		const chosen = await pickConnection(
			this._payload.configured,
			this._payload.connections,
			this._selection.get(document.uri),
		);
		if (!chosen || this._disposed) {
			return;
		}
		if (chosen === AUTOMATIC) {
			if (this._selection.unset(document.uri)) {
				this._log.info(`${document.uri.toString(true)} follows the only open data connection again.`);
				this._relink();
				this._refresh(document);
				this._updateStatusBar();
			}
			return;
		}
		this._selection.set(document.uri, chosen);
		this._log.info(`${document.uri.toString(true)} is written against ${chosen.name}.`);
		// All of these change with the choice: which names are unknown, which are tables to link,
		// and what the bar says.
		this._relink();
		this._refresh(document);
		this._updateStatusBar();
		if (!this._payload.connections.some(open => open.profileId === chosen.profileId)) {
			// Chosen while closed, which is an explicit ask to use it, so it is opened whatever
			// connectOnOpen says and even if opening it failed before. The schema read that the
			// opening triggers fills in the completions and the status bar.
			this._attempted.add(chosen.profileId);
			await this._open(chosen, document);
		}
	}

	private _updateStatusBar(): void {
		const document = activeSqlDocument();
		this._statusBar.update(document && describeSelection(
			this._resolve(document),
			this._settled ? this._payload.configured : undefined,
			this._dialectInUse(document),
			this._payload.dataConnectionsOff,
		));
	}

	/**
	 * How to read the SQL in a document, and what decided that.
	 *
	 * The setting wins when it is set: a user who picked a dialect meant it, including for a file
	 * whose connection says otherwise. Left at its default, the dialect follows the connection the
	 * file is written against, which is the answer the user would have had to type in by hand --
	 * and the only one that can differ per file, which one setting cannot.
	 *
	 * Which of the two it was travels with the dialect, because the status bar hover shows it and
	 * a dialect that looks wrong is fixed in a different place depending on where it came from.
	 */
	private _dialectInUse(document: vscode.TextDocument): DialectInUse {
		const configured = vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<string>('dialect');
		if (configured) {
			return { dialect: configured, fromSetting: true };
		}
		const selection = this._resolve(document);
		// Including a connection that is closed: the file is still written against that database,
		// and its syntax did not change when the connection did.
		const dialect = selection.kind === 'none'
			? ''
			: dialectOfDriver(selection.connection.driverId);
		return { dialect, fromSetting: false };
	}

	private _dialectFor(document: vscode.TextDocument): string {
		return this._dialectInUse(document).dialect;
	}

	/** The whole vocabulary, which completion falls back on when a prefix matches nothing. */
	private _keywordList(): readonly string[] {
		// Fixed for the life of the module, so read once rather than marshalled per keystroke. What
		// a given cursor offers is a separate, per-request call; see `contextualKeywords`.
		this._keywords ??= this._require()?.keywords() ?? [];
		return this._keywords;
	}

	/**
	 * The analyzer, or undefined if it could not be loaded.
	 *
	 * Every feature this extension provides needs it, so a failure here is the whole extension
	 * being unavailable. It still must not throw: these run on the user's keystrokes, and an
	 * exception out of a provider would be a notification per character typed rather than one
	 * message saying what is wrong.
	 */
	private _require(): SqlAnalyzer | undefined {
		if (this._analyzer || this._analyzerUnavailable) {
			return this._analyzer;
		}
		const module = path.join(this._context.extensionPath, ANALYZER_MODULE);
		try {
			this._analyzer = SqlAnalyzer.load(module, this._log);
		} catch (error) {
			// Once: the module is read from disk at a fixed path, so a second attempt would fail
			// the same way and say so again on every keystroke.
			this._analyzerUnavailable = true;
			this._log.error(`Could not load the SQL analyzer from ${module}, so SQL completions and`
				+ ` diagnostics are unavailable: ${error}`);
		}
		return this._analyzer;
	}

	private _analyze(document: vscode.TextDocument): Analysis {
		const analyzer = this._require();
		if (!analyzer) {
			return EMPTY_ANALYSIS;
		}

		const { dialect, fromSetting } = this._dialectInUse(document);
		const uri = document.uri.toString();
		const key = `${document.version}:${dialect}`;
		let cached = this._cache.get(uri);
		// Taken out and put back, so the map's order is the order documents were last used in.
		this._cache.delete(uri);
		if (cached?.key !== key) {
			const started = Date.now();
			const analysis = analyzer.analyze(document.getText(), dialect);
			cached = { key, analysis };
			this._log.trace(`Analyzed ${document.uri.toString(true)} v${document.version}`
				+ ` as ${dialect || 'generic'} in ${Date.now() - started}ms:`
				+ ` ${analysis.diagnostics.length} diagnostic(s),`
				+ ` ${analysis.tables.length} table(s), ${analysis.columns.length} column(s).`);
		}
		this._cache.set(uri, cached);
		while (this._cache.size > MAX_CACHED_ANALYSES) {
			this._cache.delete(this._cache.keys().next().value!);
		}

		if (cached.analysis.unknownDialect && !this._reportedDialects.has(dialect)) {
			// Said once per dialect rather than per parse: a dialect that is not recognized stays
			// unrecognized for every document, and a line per keystroke would bury it. Fixed where
			// it came from, which is not always the setting.
			this._reportedDialects.add(dialect);
			this._log.warn(fromSetting
				? `The SQL dialect "${dialect}" is not one Positron can parse, so SQL files are being`
				+ ' parsed without a dialect. Pick one from the sql.dialect setting.'
				: `The SQL dialect "${dialect}", which a data connection's driver uses, is not one`
				+ ' Positron can parse, so files written against that connection are being parsed'
				+ ' without a dialect. Set sql.dialect to read them as another one.');
		}

		return cached.analysis;
	}

	private _schedule(document: vscode.TextDocument): void {
		if (document.languageId !== 'sql') {
			return;
		}
		this._cancel(document);
		const key = document.uri.toString();
		this._pending.set(key, setTimeout(() => {
			this._pending.delete(key);
			this._refresh(document);
		}, DIAGNOSTIC_DELAY_MS));
	}

	private _cancel(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		const pending = this._pending.get(key);
		if (pending) {
			clearTimeout(pending);
			this._pending.delete(key);
		}
	}

	private _refresh(document: vscode.TextDocument): void {
		if (document.languageId !== 'sql' || NO_DIAGNOSTICS_SCHEMES.has(document.uri.scheme)) {
			return;
		}
		const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
		if (configuration.get<boolean>('diagnostics.enabled') === false) {
			// Cleared rather than left alone: what is on screen was reported under the old
			// setting, and turning diagnostics off should take the squiggles with it.
			this._diagnostics.delete(document.uri);
			return;
		}
		const reportUnknownNames = configuration.get<boolean>('diagnostics.unknownNames') !== false;
		this._diagnostics.set(
			document.uri,
			collectDiagnostics(document, this._analyze(document), this._schemaFor(document), reportUnknownNames),
		);
	}

	/**
	 * Registers the document link provider afresh, so the editor asks every open SQL document for
	 * its links again.
	 *
	 * Diagnostics are pushed, and hover and completion are asked for as they are needed, but the
	 * editor computes links once and then only again when the text changes or a link provider is
	 * added or removed. There is no event a provider can fire to say its answer has changed. So
	 * without this, a file opened before its connection's schema was read never gets links until
	 * the user edits it -- and a file switched to another connection keeps the old one's.
	 */
	private _relink(): void {
		this._links?.dispose();
		this._links = vscode.languages.registerDocumentLinkProvider(SQL_DOCUMENTS, {
			provideDocumentLinks: document =>
				collectLinks(document, this._analyze(document), this._schemaFor(document)),
		});
	}

	private _refreshAll(): void {
		for (const document of vscode.workspace.textDocuments) {
			this._refresh(document);
		}
	}
}

/** The SQL document the user is looking at, if that is what they are looking at. */
function activeSqlDocument(): vscode.TextDocument | undefined {
	return activeSqlEditor()?.document;
}

/** The SQL editor the user is looking at, if that is what they are looking at. */
function activeSqlEditor(): vscode.TextEditor | undefined {
	const editor = vscode.window.activeTextEditor;
	return editor?.document.languageId === 'sql' ? editor : undefined;
}

/**
 * What one cmd+enter runs, and whether the cursor should move on afterwards.
 *
 * The statements around it travel with it so that advancing does not have to parse the document a
 * second time -- and so that it advances by the same reading of it, which matters for a document
 * the user is still editing.
 */
type StatementToRun =
	| { readonly query: string; readonly advance: false }
	| {
		readonly query: string;
		readonly advance: true;
		readonly statements: readonly StatementSpan[];
		readonly statement: StatementSpan;
	};

/**
 * Moves the cursor to the next statement after the one that just ran.
 *
 * To the start of the next one, rather than past the end of this one: what lies between them is
 * blank lines and comments, and leaving the cursor in them would mean the next cmd+enter runs the
 * statement below anyway, one keystroke later. At the last statement the cursor goes to its end,
 * where a further cmd+enter runs it again -- which is what a user pressing it there is asking for.
 */
function advance(
	editor: vscode.TextEditor,
	statements: readonly StatementSpan[],
	statement: StatementSpan,
): void {
	const next = statements.find(candidate => candidate.start > statement.start);
	const position = editor.document.positionAt(next ? next.start : statement.end);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position));
}
