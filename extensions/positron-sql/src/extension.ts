/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Analysis, EMPTY_ANALYSIS, SqlAnalyzer } from './analyzer';
import { QUOTE_TRIGGERS, SqlCompletionItemProvider } from './completion';
import { collectDiagnostics } from './diagnostics';
import { defaultSchemaOf, dialectOfDriver } from './dialects';
import { hoverFor } from './hover';
import { collectLinks } from './links';
import { SqlLog } from './log';
import { ConnectionRef, EMPTY_SCHEMA, readConnectionSchema, schemaOfProfile, SqlSchema } from './schema';
import { SchemaIndex } from './schemaIndex';
import { ConnectionSelection, EffectiveSelection, resolveSelection } from './selection';
import { SqlStatementRangeProvider } from './statementRange';
import { ConnectionStatusBar, describeSelection, DialectInUse, pickConnection } from './statusBar';

/** The configuration section every setting this extension reads lives under. */
const CONFIGURATION_SECTION = 'sql';

/** The setting, under {@link CONFIGURATION_SECTION}, that turns every feature on. Off by default. */
const ENABLED_SETTING = 'enabled';

/** The command that re-reads the tables and columns of the user's data connections. */
const REFRESH_SCHEMA_COMMAND = 'sql.refreshDatabaseSchema';

/** The command behind the status bar item, which scopes a file to one data connection. */
const SELECT_CONNECTION_COMMAND = 'sql.selectDataConnection';

/** The compiled analyzer, built from `sql-analyzer/` and committed through Git LFS; see scripts/build-analyzer.mts. */
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

/**
 * Activation only watches `sql.enabled`. Everything else -- the output channel, the providers,
 * the analyzer -- is created when it is turned on and torn down when it is turned off, so with
 * the setting off the extension loads nothing. No reload is needed either way.
 */
export function activate(context: vscode.ExtensionContext): void {
	let log: vscode.LogOutputChannel | undefined;
	let session: SqlSession | undefined;

	const update = () => {
		const enabled = vscode.workspace.getConfiguration(CONFIGURATION_SECTION)
			.get<boolean>(ENABLED_SETTING) === true;
		if (enabled && !session) {
			if (!log) {
				log = vscode.window.createOutputChannel('SQL', { log: true });
				context.subscriptions.push(log);
			}
			session = new SqlSession(context, log);
			session.start();
		} else if (!enabled && session) {
			session.dispose();
			session = undefined;
		}
	};

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.${ENABLED_SETTING}`)) {
				update();
			}
		}),
		{ dispose: () => session?.dispose() },
	);
	update();
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

	/** The document link provider's registration; see {@link _relink}. */
	private _links: vscode.Disposable | undefined;

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
				// Asked for by hand, so a connection that failed to open is worth trying again.
				this._attempted.clear();
				return this.refreshSchema();
			}),
			vscode.commands.registerCommand(SELECT_CONNECTION_COMMAND, () => this._selectConnection()),

			// The item speaks for the file in front of the user, so it changes with the editor.
			vscode.window.onDidChangeActiveTextEditor(() => this._updateStatusBar()),

			vscode.workspace.onDidOpenTextDocument(document => {
				if (document.languageId === 'sql') {
					// This same buffer reopened in a new language keeps its choice, and a buffer just
					// saved as this file hands its choice over.
					if (this._selection.reopen(document.uri, document.getText())) {
						this._log.debug(`Kept the connection of ${document.uri.toString(true)} as it reopened.`);
					} else {
						this._adopt(document);
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
					this._adopt(event.document);
				}
				this._schedule(event.document);
			}),
			vscode.workspace.onDidSaveTextDocument(document => this._adopt(document)),
			vscode.workspace.onDidCloseTextDocument(document => {
				// Diagnostics outlive the document unless they are cleared, so a closed file would
				// keep its errors in the Problems panel with no editor to fix them in.
				this._cancel(document);
				this._diagnostics.delete(document.uri);
				const chosen = this._selection.get(document.uri);
				this._selection.forgetIfTransient(document.uri, document.getText());
				if (chosen && document.uri.scheme === 'untitled') {
					this._log.debug(`${document.uri.toString(true)} closed; its connection, ${chosen.name},`
						+ ' is kept for a document that replaces it.');
					// The file a buffer is saved as may already hold its text by the time the
					// buffer closes.
					for (const open of vscode.workspace.textDocuments) {
						if (open !== document && !open.isClosed) {
							this._adopt(open);
						}
					}
				}
				this._updateStatusBar();
			}),

			// A choice is kept by file, so it moves when the file does.
			vscode.workspace.onDidRenameFiles(event => {
				for (const { oldUri, newUri } of event.files) {
					this._selection.rename(oldUri, newUri);
				}
			}),

			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration(CONFIGURATION_SECTION)) {
					// Both settings that matter here -- the dialect and whether unknown names
					// count -- decide what a diagnostic is, and every open document was analyzed
					// under the old value. The dialect is on the status bar hover too, and decides
					// which names parse as tables, so the links.
					this._relink();
					this._refreshAll();
					this._updateStatusBar();
				}
			}),

			// The user connecting to or disconnecting from a database is what changes the answer,
			// and Positron says when that happens, so there is nothing to poll for.
			positron.dataConnections.onDidChangeConnections(() => void this.refreshSchema()),
		);

		this._relink();
		this._refreshAll();
		this._updateStatusBar();
		// The files already open are asked about only once the first read has said what is open
		// already, so a connection that is up is not opened a second time.
		void this.refreshSchema().then(() => {
			if (this._disposed) {
				return;
			}
			for (const document of vscode.workspace.textDocuments) {
				void this._openConnectionFor(document);
			}
		});
	}

	public dispose(): void {
		this._disposed = true;
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
		if (this._payload.connections.some(open => open.profileId === chosen.profileId)) {
			return;
		}

		this._attempted.add(chosen.profileId);
		await this._open(chosen, document);
	}

	/** Opens a file's connection, reporting the outcome in the log rather than to the user. */
	private async _open(chosen: ConnectionRef, document: vscode.TextDocument): Promise<void> {
		try {
			const opened = await positron.dataConnections.openConnection(chosen.profileId);
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

	/** Re-reads the user's data connections and re-analyzes every open document. */
	public async refreshSchema(): Promise<void> {
		const generation = ++this._generation;
		let payload: SqlSchema;
		try {
			payload = await readConnectionSchema(this._log);
		} catch (error) {
			// Completions still work without metadata: keywords are always available, and the
			// alternative to keeping the old schema is dropping tables the user can still see in
			// the Data Connections pane.
			this._log.warn(`Could not read the database schema: ${error}`);
			return;
		}
		if (this._disposed || generation !== this._generation) {
			// Switched off, or overtaken by a read that began after this one and knows better.
			return;
		}
		this._payload = payload;
		this._read = true;
		this._scoped.clear();
		// The schema decides which names are unknown, so every open document's diagnostics are
		// stale, and which names are tables, so its links are. The status bar is stale too: a
		// connection this file chose may have just closed.
		this._relink();
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
			this._read ? this._payload.configured : undefined,
		);
	}

	/**
	 * Gives a document the choice of a buffer just closed with the same text, if it has none of its
	 * own, and brings everything that depends on the choice along with it.
	 */
	private _adopt(document: vscode.TextDocument): void {
		if (document.languageId !== 'sql' || !this._selection.hasTransient) {
			return;
		}
		const donors = vscode.workspace.textDocuments
			.filter(open => open !== document && !open.isClosed && open.uri.scheme === 'untitled'
				&& this._selection.get(open.uri) !== undefined)
			.map(open => ({ uri: open.uri, text: open.getText() }));
		if (!this._selection.adopt(document.uri, document.getText(), donors)) {
			return;
		}
		this._log.debug(`${document.uri.toString(true)} took over the connection`
			+ ` ${this._selection.get(document.uri)?.name} of the buffer it was saved from.`);
		this._relink();
		this._refresh(document);
		this._updateStatusBar();
		void this._openConnectionFor(document);
	}

		/** Asks which connection the active SQL file is written against, and applies the answer. */
	private async _selectConnection(): Promise<void> {
		const document = activeSqlDocument();
		if (!document) {
			// The command is enabled only for SQL editors, but a keybinding can still reach it.
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
			this._payload.configured,
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
	const document = vscode.window.activeTextEditor?.document;
	return document?.languageId === 'sql' ? document : undefined;
}
