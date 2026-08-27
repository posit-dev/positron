/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Analysis, EMPTY_ANALYSIS, SqlAnalyzer } from './analyzer';
import { SqlCompletionItemProvider } from './completion';
import { collectDiagnostics } from './diagnostics';
import { dialectOfDriver } from './dialects';
import { hoverFor } from './hover';
import { collectLinks } from './links';
import { SqlLog } from './log';
import { EMPTY_SCHEMA, readConnectionSchema, schemaOfProfile, SqlSchema } from './schema';
import { SchemaIndex } from './schemaIndex';
import { ConnectionSelection, resolveSelection } from './selection';
import { SqlStatementRangeProvider } from './statementRange';
import { ConnectionStatusBar, describeSelection, DialectInUse, pickConnection } from './statusBar';

/** The configuration section every setting this extension reads lives under. */
const CONFIGURATION_SECTION = 'sql';

/** The command that re-reads the tables and columns of the user's data connections. */
const REFRESH_SCHEMA_COMMAND = 'sql.refreshDatabaseSchema';

/** The command behind the status bar item, which scopes a file to one data connection. */
const SELECT_CONNECTION_COMMAND = 'sql.selectDataConnection';

/** The compiled analyzer, built from `sql-analyzer/` and committed; see scripts/build-analyzer.mts. */
const ANALYZER_MODULE = path.join('resources', 'sql-analyzer.wasm');

/** What a file with no connection to draw on completes against, which is keywords only. */
const NO_SCHEMA = new SchemaIndex();

/** Documents this extension provides features for: every SQL document, whatever its scheme. */
const SQL_DOCUMENTS: vscode.DocumentSelector = { language: 'sql' };

/**
 * How long to wait after a keystroke before re-analyzing a document for diagnostics.
 *
 * Long enough that typing a word does not parse the document once per character, short enough
 * that a squiggle appears while the user is still looking at what caused it.
 */
const DIAGNOSTIC_DELAY_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('SQL', { log: true });
	context.subscriptions.push(log);

	const session = new SqlSession(context, log);
	context.subscriptions.push(session);
	session.start();
}

export function deactivate(): void { }

/**
 * The extension's state and the editor features that read it.
 *
 * All of it lives in this process: the parser is a WebAssembly module (see `analyzer.ts`) rather
 * than a language server, so there is nothing to launch, supervise or keep in step with the
 * user's settings -- a setting is simply read the next time a feature runs.
 */
class SqlSession implements vscode.Disposable {

	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _diagnostics: vscode.DiagnosticCollection;

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
	 * Indices over one connection each, built the first time a file scoped to it asks.
	 *
	 * Lazily, and thrown away whole on every read: a window usually has one connection open and a
	 * file open against it, and indexing every warehouse up front would be work for a question
	 * nobody asked.
	 */
	private readonly _scoped = new Map<string, SchemaIndex>();

	private readonly _selection: ConnectionSelection;

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

	/** The dialect setting already reported as unrecognized, so it is said once and not per parse. */
	private _reportedDialect: string | undefined;

	/** Pending re-analyses, one per document, so that typing does not parse on every keystroke. */
	private readonly _pending = new Map<string, NodeJS.Timeout>();

	/**
	 * The last document parsed, and what came of it.
	 *
	 * Diagnostics and document links both want the whole document parsed, and the editor asks for
	 * links on the same version it has just been given diagnostics for. One entry is enough: the
	 * requests that matter are for the document the user is looking at, and they arrive together.
	 */
	private _cache: { key: string; analysis: Analysis } | undefined;

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _log: SqlLog,
	) {
		this._diagnostics = vscode.languages.createDiagnosticCollection('sql');
		this._selection = new ConnectionSelection(_context.workspaceState);
		this._statusBar = new ConnectionStatusBar(SELECT_CONNECTION_COMMAND);
		this._disposables.push(this._diagnostics, this._statusBar);
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
				// `.` is the one character that changes what a completion means rather than just
				// extending a prefix, so it is the only one worth an automatic request; the
				// editor triggers the rest itself as the user types an identifier.
				'.',
			),

			vscode.languages.registerDocumentLinkProvider(SQL_DOCUMENTS, {
				provideDocumentLinks: document =>
					collectLinks(document, this._analyze(document), this._schemaFor(document)),
			}),

			vscode.languages.registerHoverProvider(SQL_DOCUMENTS, {
				provideHover: (document, position) =>
					hoverFor(document, position, this._analyze(document), this._schemaFor(document)),
			}),

			vscode.commands.registerCommand(REFRESH_SCHEMA_COMMAND, () => {
				// Asked for by hand, so a connection that failed to open is worth trying again.
				this._attempted.clear();
				return this.refreshSchema();
			}),
			vscode.commands.registerCommand(SELECT_CONNECTION_COMMAND, () => this._selectConnection()),

			// The item speaks for the file in front of the user, so it changes with the editor.
			vscode.window.onDidChangeActiveTextEditor(() => this._updateStatusBar()),

			vscode.workspace.onDidOpenTextDocument(document => {
				this._refresh(document);
				// A file that says which database it is written against says what to open, so the
				// user does not have to open it by hand before the file works.
				void this._openConnectionFor(document);
			}),
			vscode.workspace.onDidChangeTextDocument(event => this._schedule(event.document)),
			vscode.workspace.onDidCloseTextDocument(document => {
				// Diagnostics outlive the document unless they are cleared, so a closed file would
				// keep its errors in the Problems panel with no editor to fix them in.
				this._cancel(document);
				this._diagnostics.delete(document.uri);
				this._selection.forgetIfTransient(document.uri);
			}),

			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration(CONFIGURATION_SECTION)) {
					// Both settings that matter here -- the dialect and whether unknown names
					// count -- decide what a diagnostic is, and every open document was analyzed
					// under the old value. The dialect is on the status bar hover too.
					this._refreshAll();
					this._updateStatusBar();
				}
			}),

			// The user connecting to or disconnecting from a database is what changes the answer,
			// and Positron says when that happens, so there is nothing to poll for.
			positron.dataConnections.onDidChangeConnections(() => void this.refreshSchema()),
		);

		this._refreshAll();
		this._updateStatusBar();
		// The files already open are asked about only once the first read has said what is open
		// already, so a connection that is up is not opened a second time.
		void this.refreshSchema().then(() => {
			for (const document of vscode.workspace.textDocuments) {
				void this._openConnectionFor(document);
			}
		});
	}

	public dispose(): void {
		for (const pending of this._pending.values()) {
			clearTimeout(pending);
		}
		this._pending.clear();
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
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
		if (this._payload.connections.some(open => open.profileId === chosen.profileId)) {
			return;
		}

		this._attempted.add(chosen.profileId);
		try {
			const opened = await positron.dataConnections.openConnection(chosen.profileId);
			// No refresh here: opening one fires onDidChangeConnections, which re-reads the schema
			// and brings the status bar and the diagnostics with it.
			this._log.info(opened
				? `Opened ${chosen.name} for ${document.uri.toString(true)}.`
				: `${chosen.name} could not be opened for ${document.uri.toString(true)}:`
				+ ' the connection no longer exists, or the Data Connections feature is off.');
		} catch (error) {
			// Expected rather than exceptional -- credentials expire, hosts go away -- so it is
			// reported where the user can read the reason rather than raised at them.
			this._log.warn(`Could not open ${chosen.name}, which`
				+ ` ${document.uri.toString(true)} is written against: ${error}`);
		}
	}

	/** Re-reads the user's data connections and re-analyzes every open document. */
	public async refreshSchema(): Promise<void> {
		try {
			this._payload = await readConnectionSchema(this._log);
		} catch (error) {
			// Completions still work without metadata: keywords are always available, and the
			// alternative to keeping the old schema is dropping tables the user can still see in
			// the Connections pane.
			this._log.warn(`Could not read the database schema: ${error}`);
			return;
		}
		this._scoped.clear();
		// The schema decides which names are unknown, so every open document's diagnostics are
		// stale. The status bar is stale too: a connection this file chose may have just closed.
		this._refreshAll();
		this._updateStatusBar();
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
		const selection = resolveSelection(this._selection.get(document.uri), this._payload.connections);
		if (selection.kind === 'none') {
			return NO_SCHEMA;
		}
		const profileId = selection.connection.profileId;
		let index = this._scoped.get(profileId);
		if (!index) {
			index = new SchemaIndex(schemaOfProfile(this._payload, profileId));
			this._scoped.set(profileId, index);
		}
		return index;
	}

	/** Asks which connection the active SQL file is written against, and applies the answer. */
	private async _selectConnection(): Promise<void> {
		const document = activeSqlDocument();
		if (!document) {
			// The command is enabled only for SQL editors, but a keybinding can still reach it.
			return;
		}
		const chosen = await pickConnection(this._payload.connections, this._selection.get(document.uri));
		if (!chosen) {
			return;
		}
		this._selection.set(document.uri, chosen);
		this._log.info(`${document.uri.toString(true)} is written against ${chosen.name}.`);
		// Both of these change with the choice: which names are unknown, and what the bar says.
		this._refresh(document);
		this._updateStatusBar();
	}

	private _updateStatusBar(): void {
		const document = activeSqlDocument();
		this._statusBar.update(document && describeSelection(
			resolveSelection(this._selection.get(document.uri), this._payload.connections),
			this._payload.connections,
			this._dialectInUse(document),
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
		const selection = resolveSelection(this._selection.get(document.uri), this._payload.connections);
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

	private _keywordList(): readonly string[] {
		// Fixed for the life of the module, so read once rather than marshalled per keystroke.
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
			this._analyzer = SqlAnalyzer.load(module, message => this._log.error(message));
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

		const dialect = this._dialectFor(document);
		const key = `${document.uri.toString()}@${document.version}:${dialect}`;
		if (this._cache?.key !== key) {
			const started = Date.now();
			const analysis = analyzer.analyze(document.getText(), dialect);
			this._cache = { key, analysis };
			this._log.trace(`Analyzed ${document.uri.toString(true)} v${document.version}`
				+ ` as ${dialect || 'generic'} in ${Date.now() - started}ms:`
				+ ` ${analysis.diagnostics.length} diagnostic(s),`
				+ ` ${analysis.tables.length} table(s), ${analysis.columns.length} column(s).`);
		}

		if (this._cache.analysis.unknownDialect && this._reportedDialect !== dialect) {
			// Said once per setting value rather than per parse: a dialect that is not recognized
			// stays unrecognized for every document, and a line per keystroke would bury it.
			this._reportedDialect = dialect;
			this._log.warn(`The SQL dialect "${dialect}" is not one Positron can parse, so SQL files`
				+ ' are being parsed without a dialect. Pick one from the sql.dialect setting.');
		}

		return this._cache.analysis;
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
		if (document.languageId !== 'sql') {
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

	private _refreshAll(): void {
		for (const document of vscode.workspace.textDocuments) {
			this._refresh(document);
		}
	}
}

/** The SQL document the user is looking at, if that is what they are looking at. */
function activeSqlDocument(): vscode.TextDocument | undefined {
	const document = vscode.window.activeTextEditor?.document;
	return document?.languageId === 'sql' ? document : undefined;
}
