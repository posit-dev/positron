/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';
import { PromiseHandles, timeout } from './util';
import { RStatementRangeProvider } from './statement-range';
import { RInputBoundaryProvider } from './input-boundaries';
import { LOGGER } from './extension';
import { RErrorHandler } from './error-handler';

import {
	LanguageClient,
	LanguageClientOptions,
	State,
	StreamInfo,
	RevealOutputChannelOn
} from 'vscode-languageclient/node';

import { Socket } from 'net';
import { RHelpTopicProvider } from './help';
import { R_DOCUMENT_SELECTORS } from './provider';
import { VirtualDocumentProvider } from './virtual-documents';
import { isQuartoInlineOutputEnabled } from './quarto';
import {
	QUARTO_CELLS_NOTEBOOK_TYPE,
	QUARTO_CELLS_SCHEME,
	claimQuartoCells,
	hasQuartoCellsOwner,
	onDidChangeQuartoCellsOwnership,
	quartoCellsNotebookPath,
	releaseQuartoCells,
} from './quarto-cells';

// Regex to match Quarto virtual document files: .vdoc.[uuid].[ext]
const VDOC_PATTERN = /^\.vdoc\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+$/i;

// Selector for Quarto virtual documents.
const VDOC_SELECTOR = { language: 'r', pattern: '**/.vdoc.*.{r,R}' };
const QUARTO_INPUT_BOUNDARY_SELECTOR = { language: 'r', scheme: 'inmemory', pattern: '**/quarto-input-boundaries/*' };

// Regex to match notebook console REPL URIs: /notebook-repl-<lang>-<uuid>
const NOTEBOOK_REPL_PATTERN = /^\/notebook-repl-/;

// Matches the path of a Quarto or R Markdown document.
const QUARTO_PATH_PATTERN = /\.(qmd|rmd)$/i;

// The language ids core treats as Quarto, from `QUARTO_LANGUAGE_IDS` in its own
// positronQuartoConfig.ts. An untitled Quarto document is known by its language
// id alone: _Quarto: New Document_ opens it with `openTextDocument({ language })`,
// which names it `untitled:Untitled-1`, with no extension to match on.
const QUARTO_LANGUAGE_IDS = ['quarto', 'rmd'];

// Matches the path of a real notebook, which a Quarto session never has.
const NOTEBOOK_PATH_PATTERN = /\.ipynb$/i;

// Selector for the cells of every Quarto virtual notebook, used by the console
// client.
//
// Ark declares no `notebookDocumentSync` capability, so the language client
// syncs these cells as ordinary text documents and the document selector is the
// only gate. Matching the notebook's type keeps the cells of real notebooks
// (.ipynb) out, since no other notebook carries this type. A Quarto session
// names its own document's notebook instead; see `ArkLsp._quartoCellsUri`.
const QUARTO_CELL_SELECTOR = {
	notebook: { notebookType: QUARTO_CELLS_NOTEBOOK_TYPE },
	language: 'r',
};

/**
 * The hidden Quarto notebook a URI is a cell of, if any.
 */
function quartoNotebookOf(uri: vscode.Uri): vscode.NotebookDocument | undefined {
	if (uri.scheme !== 'vscode-notebook-cell') {
		return undefined;
	}
	return vscode.workspace.notebookDocuments.find(
		notebook => notebook.notebookType === QUARTO_CELLS_NOTEBOOK_TYPE &&
			notebook.getCells().some(
				cell => cell.document.uri.toString() === uri.toString()));
}

/**
 * The ownership registry key for a hidden Quarto notebook.
 *
 * Core builds the hidden notebook with `sourceUri.with({ scheme: 'quarto-cells', ... })`,
 * which keeps the source's remote authority, and the RPC URI transformer rewrites only the
 * `file` and `vscode-remote` schemes, so that authority reaches us intact. A session derives
 * its own URI from `notebookUri`, which arrives here already transformed to a plain `file:`
 * URI with no authority. Dropping the authority on both sides is what makes the two agree in
 * a remote or web window; keying on the raw URI instead means ownership never matches there
 * and the console keeps answering for a document that has a session of its own.
 */
export function quartoCellsKey(notebookUri: vscode.Uri): string {
	return notebookUri.with({ authority: '' }).toString();
}

/**
 * Whether a URI is a Quarto cell that its document's own session serves, so
 * that the console client should decline it.
 */
function isOwnedQuartoCellUri(uri: vscode.Uri): boolean {
	const notebook = quartoNotebookOf(uri);
	return notebook !== undefined && hasQuartoCellsOwner(quartoCellsKey(notebook.uri));
}

/**
 * Whether a session's document is a Quarto document rather than a real notebook.
 *
 * Mirrors `isQuartoDocument` in core's positronQuartoConfig.ts: the path first,
 * then the language id of the open document, which is the only thing that names
 * an untitled Quarto document. Core builds a hidden notebook on the same rule,
 * so a narrower one here means a session whose cells core did build but that the
 * session does not know are its own.
 *
 * The answer must not depend on timing, because the document selector is built
 * from it once, when the client is created. A restored session can reach us
 * before its document does, and an untitled document that is not open yet has
 * no language id to read. An untitled notebook is not shapeless though: core
 * names it `Untitled-N<ending>` and puts its type in the query, for example
 * `untitled:Untitled-1.ipynb?jupyter-notebook` (`notebookEditorModelResolverServiceImpl.ts`).
 * So an untitled URI that carries neither is a Quarto document. A wrong guess
 * here is caught later, when the claim finds no notebook of that name.
 */
function isQuartoDocumentUri(uri: vscode.Uri, openDocuments: readonly vscode.TextDocument[]): boolean {
	if (QUARTO_PATH_PATTERN.test(uri.path)) {
		return true;
	}
	if (NOTEBOOK_PATH_PATTERN.test(uri.path) || uri.query !== '') {
		return false;
	}
	const document = openDocuments.find(candidate => candidate.uri.toString() === uri.toString());
	return document === undefined || QUARTO_LANGUAGE_IDS.includes(document.languageId.toLowerCase());
}

/**
 * The hidden Quarto notebook for a session's document, or `undefined` when the
 * session is not a Quarto session.
 *
 * Both the session's document selector and its ownership key derive from this, so
 * a wrong answer here makes every one of its providers decline and puts the
 * document back on the console client, which is the bug this rule exists to fix.
 *
 * Callers still resolve this lazily, so that a document which opens after the
 * session does gives the precise language-id answer rather than the fallback.
 */
export function quartoCellsUriFor(
	notebookUri: vscode.Uri | undefined,
	openDocuments: readonly vscode.TextDocument[] = vscode.workspace.textDocuments,
): vscode.Uri | undefined {
	return notebookUri && isQuartoDocumentUri(notebookUri, openDocuments)
		? notebookUri.with({
			scheme: QUARTO_CELLS_SCHEME,
			path: quartoCellsNotebookPath(notebookUri.path),
		})
		: undefined;
}

/**
 * Global output channel for R LSP sessions
 *
 * Since we only have one LSP session active at any time, and since the start of
 * a new session is logged with a session ID, we use a single output channel for
 * all LSP sessions. Watch out for session start log messages to find the
 * relevant section of the log.
 */
let _lspOutputChannel: vscode.LogOutputChannel | undefined;
function getLspOutputChannel(): vscode.LogOutputChannel {
	if (!_lspOutputChannel) {
		_lspOutputChannel = positron.window.createRawLogOutputChannel('R Language Server');
	}
	return _lspOutputChannel;
}

/**
 * The state of the language server.
 */
export enum ArkLspState {
	Uninitialized = 'uninitialized',
	Starting = 'starting',
	Stopped = 'stopped',
	Running = 'running',
}

export interface ArkLspStateChangeEvent {
	oldState: ArkLspState;
	newState: ArkLspState;
}

/**
 * Wraps an instance of the client side of the ARK LSP.
 */
export class ArkLsp implements vscode.Disposable {
	/** The language client instance, if it has been created */
	private client?: LanguageClient;

	private _state: ArkLspState = ArkLspState.Uninitialized;
	private _stateEmitter = new vscode.EventEmitter<ArkLspStateChangeEvent>();
	onDidChangeState = this._stateEmitter.event;

	/** Promise that resolves after initialization is complete */
	private _initializing?: Promise<void>;

	/** Disposable for per-activation items */
	private activationDisposables: vscode.Disposable[] = [];

	private languageClientName: string;

	/** The resolved `_quartoCellsUri`, kept once it is known. */
	private _resolvedQuartoCellsUri: vscode.Uri | undefined;

	public constructor(
		private readonly _version: string,
		private readonly _metadata: positron.RuntimeSessionMetadata,
		private readonly _dynState: positron.LanguageRuntimeDynState,
	) {
		this.languageClientName = `Ark (R ${this._version} language client) for session ${_dynState.sessionName} - '${_metadata.sessionId}'`;
	}

	/**
	 * The hidden notebook holding the cells of this session's Quarto document,
	 * when this is a Quarto session. Undefined for console sessions and for
	 * real notebook (.ipynb) sessions.
	 *
	 * Resolved on first use rather than in the constructor, because an untitled
	 * Quarto document is known by the language id of its open text document and
	 * a restored session can reach us before that document does. The answer is
	 * kept once it is known, so a claim and the release that follows it always
	 * name the same notebook.
	 */
	private get _quartoCellsUri(): vscode.Uri | undefined {
		if (!this._resolvedQuartoCellsUri) {
			this._resolvedQuartoCellsUri = quartoCellsUriFor(this._metadata.notebookUri);
		}
		return this._resolvedQuartoCellsUri;
	}

	/**
	 * Take ownership of this session's own Quarto cells, once they exist.
	 *
	 * A claim is what makes the console client stand down, so claiming a
	 * notebook core never built would leave those cells with no server at all:
	 * this client's selector names a notebook that is not there, and the
	 * console client has already declined. Waiting for the notebook to appear
	 * keeps a wrong derivation down to "the console keeps answering", which is
	 * how things worked before a session could own anything.
	 */
	private _claimOwnQuartoCells(): void {
		const quartoCellsUri = this._quartoCellsUri;
		if (!quartoCellsUri) {
			return;
		}
		const key = quartoCellsKey(quartoCellsUri);
		const claim = () => claimQuartoCells(key, this._metadata.sessionId);

		if (vscode.workspace.notebookDocuments.some(notebook => quartoCellsKey(notebook.uri) === key)) {
			claim();
			return;
		}

		const waiting = vscode.workspace.onDidOpenNotebookDocument(notebook => {
			if (quartoCellsKey(notebook.uri) !== key) {
				return;
			}
			waiting.dispose();
			// The client may have stopped while we waited, and a stopped client
			// cannot serve the cells it was about to claim.
			if (this._state === ArkLspState.Running) {
				claim();
			}
		});
		this.activationDisposables.push(waiting);
	}

	private setState(state: ArkLspState) {
		const old = this._state;
		this._state = state;
		this._stateEmitter.fire({ oldState: old, newState: state });
	}

	/**
	 * Activate the language server; returns a promise that resolves when the LSP is
	 * activated.
	 *
	 * @param port The port on which the language server is listening.
	 * @param host The host on which the language server is listening. Must match
	 *   the bind address passed to `startPositronLsp`, otherwise the connect can
	 *   resolve to a different address family than the server bound to (e.g.
	 *   `::1` when the server is bound to `127.0.0.1` and IPv4 is disabled).
	 */
	public async activate(port: number, host: string): Promise<void> {

		// Clean up disposables from any previous activation
		this.activationDisposables.forEach(d => d.dispose());
		this.activationDisposables = [];

		// Define server options for the language server. Connects to `host:port`.
		const serverOptions = async (): Promise<StreamInfo> => {
			const out = new PromiseHandles<StreamInfo>();
			const socket = new Socket();

			socket.on('ready', () => {
				const streams: StreamInfo = {
					reader: socket,
					writer: socket
				};
				out.resolve(streams);
			});
			socket.on('error', (error) => {
				out.reject(error);
			});
			socket.connect(port, host);

			return out.promise;
		};

		const { notebookUri } = this._metadata;

		// Matches the cells of this client's own notebook.
		//
		// For a Quarto session that is the hidden notebook core builds for its
		// document, named by type and path so that no other Quarto document's
		// cells match: a session must only sync, and answer for, the document
		// it belongs to. `pattern` is matched against the notebook's fsPath
		// because the filter carries `notebookType`. For a real notebook
		// (.ipynb) a cell URI carries the notebook's own path.
		const ownNotebookCellSelectors = this._quartoCellsUri
			? [{
				notebook: { notebookType: QUARTO_CELLS_NOTEBOOK_TYPE, pattern: this._quartoCellsUri.fsPath },
				language: 'r',
			}]
			: notebookUri
				? [{ language: 'r', pattern: notebookUri.fsPath }]
				: [];

		// Filter requests so each LSP only handles its own documents. Both
		// clients are registered on the console's `inmemory` documents, so
		// without this a notebook or Quarto session answers for the main
		// console as well, from a runtime that never ran what the console ran.
		const shouldSkipDocument = (document: vscode.TextDocument): boolean => {
			if (!notebookUri) {
				// Console LSP: skip vdoc files when inline output
				// is enabled, because a notebook LSP handles them.
				// When inline output is disabled, no notebook LSP
				// exists, so the console LSP must handle vdocs.
				if (document.uri.scheme === 'file') {
					const baseName = path.basename(document.uri.fsPath);
					if (VDOC_PATTERN.test(baseName) && isQuartoInlineOutputEnabled()) {
						return true;
					}
				}
				// Console LSP: skip notebook console inputs
				if (document.uri.scheme === 'inmemory' &&
					NOTEBOOK_REPL_PATTERN.test(document.uri.path)) {
					return true;
				}
				// Console LSP: skip Quarto cells served by their own session
				if (isOwnedQuartoCellUri(document.uri)) {
					return true;
				}
			} else {
				// Notebook LSP: skip regular (non-notebook) console inputs
				if (document.uri.scheme === 'inmemory' &&
					!NOTEBOOK_REPL_PATTERN.test(document.uri.path)) {
					return true;
				}
			}
			return false;
		};

		const clientOptions: LanguageClientOptions = {
			// If this client belongs to a notebook, set the document selector to only include that notebook,
			// Quarto virtual documents (vdocs), and notebook console inputs (inmemory scheme).
			// Otherwise, this is the main client for this language, so set the document selector to include
			// untitled R files, in-memory R files (e.g. the console), and R / Quarto / R Markdown files on disk.
			documentSelector: notebookUri ?
				[
					...ownNotebookCellSelectors,
					// Match Quarto virtual documents (vdocs). Vdocs are
					// temporary .r files created for LSP features in
					// embedded code blocks (e.g. completions, hover).
					// They may be in the document's directory or in a
					// system temp directory, so use a global pattern.
					VDOC_SELECTOR,
					// Match notebook console inputs. These use the
					// inmemory scheme with a notebook-repl path prefix
					// to distinguish them from regular console inputs.
					{ language: 'r', scheme: 'inmemory' },
				] :
				[
					...R_DOCUMENT_SELECTORS,
					// Match Quarto virtual notebook cells. The console client
					// syncs these for every open Quarto document and serves the
					// ones whose document has no session of its own. Cells with
					// a session are declined at request time, see
					// `isOwnedQuartoCellUri`.
					QUARTO_CELL_SELECTOR,
				],
			synchronize: notebookUri ?
				undefined :
				{
					fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R')
				},
			errorHandler: new RErrorHandler(this._version, port),
			outputChannel: getLspOutputChannel(),
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			middleware: {
				handleDiagnostics(uri, diagnostics, next) {
					// Disable diagnostics for Assistant code confirmation widgets:
					// https://github.com/posit-dev/positron/issues/7750
					if (uri.scheme === 'assistant-code-confirmation-widget') {
						return undefined;
					}
					// Disable diagnostics for Quarto virtual documents:
					// https://github.com/quarto-dev/quarto/issues/855
					// Only check file URIs because vdocs are files on disk
					if (uri.scheme === 'file') {
						const baseName = path.basename(uri.fsPath);
						if (VDOC_PATTERN.test(baseName)) {
							return undefined;
						}
					}
					// Console LSP: a Quarto cell with a session of its own gets
					// its squiggles from that session only, which has run the
					// chunks and knows what they defined. Publishing an empty
					// set rather than dropping the publish clears what this
					// client showed before the session started.
					if (!notebookUri && isOwnedQuartoCellUri(uri)) {
						return next(uri, []);
					}
					return next(uri, diagnostics);
				},
				provideCompletionItem(document, position, context, token, next) {
					if (shouldSkipDocument(document)) {
						return undefined;
					}
					return next(document, position, context, token);
				},
				provideHover(document, position, token, next) {
					if (shouldSkipDocument(document)) {
						return undefined;
					}
					return next(document, position, token);
				},
				provideSignatureHelp(document, position, context, token, next) {
					if (shouldSkipDocument(document)) {
						return undefined;
					}
					return next(document, position, context, token);
				},
				provideDefinition(document, position, token, next) {
					if (shouldSkipDocument(document)) {
						return undefined;
					}
					return next(document, position, token);
				},
			}
		};

		// With a `.` rather than a `-` so vscode-languageserver can look up related options correctly
		const id = 'positron.r';

		const message = `Creating language client ${this._dynState.sessionName} for session ${this._metadata.sessionId} on port ${port}`;

		LOGGER.info(message);
		getLspOutputChannel().appendLine(message);

		this.client = new LanguageClient(id, this.languageClientName, serverOptions, clientOptions);

		if (!notebookUri) {
			// Console LSP: when a session claims a document's cells, drop the
			// squiggles this client published for them. The server republishes
			// only on the next edit, so without this the console's diagnostics,
			// computed without the session's state, would sit beside the
			// session's until then. We return early on release rather than
			// asking this client to republish immediately: the cells briefly
			// show no squiggles at all until the next edit, which is
			// intentional, since a stale diagnostic from either side is worse
			// than a momentary gap.
			this.activationDisposables.push(onDidChangeQuartoCellsOwnership((quartoCellsUri, owned) => {
				if (!owned) {
					return;
				}
				const notebook = vscode.workspace.notebookDocuments.find(
					candidate => quartoCellsKey(candidate.uri) === quartoCellsUri);
				for (const cell of notebook?.getCells() ?? []) {
					this.client?.diagnostics?.delete(cell.document.uri);
				}
			}));
		}

		const out = new PromiseHandles<void>();
		this._initializing = out.promise;

		this.activationDisposables.push(this.client.onDidChangeState(event => {
			const oldState = this._state;
			// Convert the state to our own enum
			switch (event.newState) {
				case State.Starting:
					this.setState(ArkLspState.Starting);
					break;
				case State.Running:
					if (this._initializing) {
						LOGGER.info(`${this.languageClientName} init successful`);
						this._initializing = undefined;
						if (this.client) {
							// Register Positron-specific LSP extension methods
							this.registerPositronLspExtensions(this.client);
						}
						out.resolve();
					}
					// A Quarto session serves its own document's cells from here
					// on. Claimed at Running rather than at construction so the
					// console keeps answering while this server has no cells yet.
					this._claimOwnQuartoCells();
					this.setState(ArkLspState.Running);
					break;
				case State.Stopped:
					if (this._initializing) {
						LOGGER.info(`${this.languageClientName} init failed`);
						out.reject('Ark LSP client stopped before initialization');
					}
					// A stopped client cannot serve anything, so the console
					// takes the cells back until this client runs again.
					if (this._quartoCellsUri) {
						releaseQuartoCells(quartoCellsKey(this._quartoCellsUri), this._metadata.sessionId);
					}
					this.setState(ArkLspState.Stopped);
					break;
			}
			LOGGER.info(`${this.languageClientName} state changed ${oldState} => ${this._state}`);
		}));

		this.client.start();
		await out.promise;
	}

	/**
	 * Stops the client instance.
	 *
	 * @returns A promise that resolves when the client has been stopped.
	 */
	public async deactivate() {
		if (!this.client) {
			// No client to stop, so just resolve
			return;
		}

		// If we don't need to stop the client, just resolve
		if (!this.client.needsStop()) {
			return;
		}

		LOGGER.info(`${this.languageClientName} is stopping`);

		// First wait for initialization to complete.
		// `stop()` should not be called on a
		// partially initialized client.
		await this._initializing;

		// Suppress the "Connection to server got closed" toast that
		// vscode-languageclient force-shows when the connection close races
		// with `stop()`: if the socket close handler fires while `$state ===
		// Stopping` (between `connection.dispose()` and the `finally` block
		// in `shutdown()`), our `RErrorHandler.closed()` is bypassed and the
		// notification is forced. See posit-dev/positron#7593.
		const origError = this.client.error.bind(this.client);
		this.client.error = (message, data, showNotification) => {
			if (typeof message === 'string' && /Connection to server got closed/.test(message)) {
				origError(message, data, false);
				return;
			}
			origError(message, data, showNotification);
		};

		// Ideally we'd just wait for `this._client!.stop()`. In practice, the
		// promise returned by `stop()` never resolves if the server side is
		// disconnected, so rather than awaiting it when the runtime has exited,
		// we wait for the client to change state to `stopped`, which does
		// happen reliably.
		const stopped = new Promise<void>((resolve) => {
			const disposable = this.client!.onDidChangeState((event) => {
				if (event.newState === State.Stopped) {
					LOGGER.info(`${this.languageClientName} is stopped`);
					resolve();
					disposable.dispose();
				}
			});
		});

		this.client!.stop();

		// Don't wait more than a couple of seconds for the client to stop
		await Promise.race([stopped, timeout(2000, 'waiting for client to stop')]);
	}

	/**
	 * Gets the current state of the client.
	 */
	get state(): ArkLspState {
		return this._state;
	}

	/**
	 * Wait for the LSP to be connected.
	 *
	 * Resolves to `true` once the LSP is connected. Resolves to `false` if the
	 * LSP has been stopped. Rejects if the LSP fails to start.
	 */
	async wait(): Promise<boolean> {
		switch (this.state) {
			case ArkLspState.Running: return true;
			case ArkLspState.Stopped: return false;

			case ArkLspState.Starting: {
				// Inherit init promise. This can reject if init fails.
				await this._initializing;
				return true;
			}

			case ArkLspState.Uninitialized: {
				const handles = new PromiseHandles<boolean>();

				const cleanup = this.onDidChangeState(_state => {
					let out: boolean;
					switch (this.state) {
						case ArkLspState.Running: out = true; break;
						case ArkLspState.Stopped: out = false; break;
						case ArkLspState.Uninitialized: return;
						case ArkLspState.Starting: {
							// Inherit init promise
							if (this._initializing) {
								cleanup.dispose();
								this._initializing.
									then(() => handles.resolve(true)).
									catch((err) => handles.reject(err));
							}
							return;
						}
					}

					cleanup.dispose();
					handles.resolve(out);
				});

				return await handles.promise;
			}
		}
	}

	/**
	 * Registers additional Positron-specific LSP methods. These programmatic
	 * language features are not part of the LSP specification, and are
	 * consequently not covered by vscode-languageserver, but are used by
	 * Positron to provide additional functionality.
	 *
	 * @param client The language client instance
	 */
	private registerPositronLspExtensions(client: LanguageClient) {
		// Provide virtual documents.
		const vdocDisposable = vscode.workspace.registerTextDocumentContentProvider('ark',
			new VirtualDocumentProvider(client));
		this.activationDisposables.push(vdocDisposable);

		// Which documents this client's providers answer for. A session must
		// not answer for documents it never synced: Ark rejects those with
		// "Can't find document", which is what posit-dev/positron#15974 looked
		// like from Cmd+Enter.
		// - Console sessions: every R document. Quarto cells served by their
		//   own session are declined at request time.
		// - Quarto sessions: vdocs and the cells of their own document only.
		// - Notebook sessions: vdocs and the cells of their own notebook only,
		//   which a cell URI names through its notebook's path.
		const { notebookUri } = this._metadata;
		const ownCells: vscode.DocumentFilter | undefined = this._quartoCellsUri
			? { language: 'r', notebookType: QUARTO_CELLS_NOTEBOOK_TYPE, pattern: this._quartoCellsUri.fsPath }
			: notebookUri
				? { language: 'r', pattern: notebookUri.fsPath }
				: undefined;
		const selector: vscode.DocumentSelector = ownCells ? [VDOC_SELECTOR, ownCells] : 'r';
		// Input boundary requests arrive on throwaway inmemory models that carry
		// text only, so ownership cannot apply to them and any running server
		// may answer. The Quarto selector is what lets a session answer those.
		const inputBoundarySelector: vscode.DocumentSelector = ownCells
			? [VDOC_SELECTOR, ownCells, QUARTO_INPUT_BOUNDARY_SELECTOR]
			: selector;
		const shouldDecline = notebookUri
			? undefined
			: (document: vscode.TextDocument) => isOwnedQuartoCellUri(document.uri);

		const rangeDisposable = positron.languages.registerStatementRangeProvider(selector,
			new RStatementRangeProvider(client, shouldDecline));
		this.activationDisposables.push(rangeDisposable);

		const inputBoundaryDisposable = positron.languages.registerInputBoundaryProvider(inputBoundarySelector,
			new RInputBoundaryProvider(client));
		this.activationDisposables.push(inputBoundaryDisposable);

		const helpDisposable = positron.languages.registerHelpTopicProvider(selector,
			new RHelpTopicProvider(client, shouldDecline));
		this.activationDisposables.push(helpDisposable);
	}

	/**
	 * Dispose of the client instance.
	 */
	async dispose() {
		if (this._quartoCellsUri) {
			releaseQuartoCells(quartoCellsKey(this._quartoCellsUri), this._metadata.sessionId);
		}
		this.activationDisposables.forEach(d => d.dispose());
		await this.deactivate();
	}

	public showOutput() {
		getLspOutputChannel().show();
	}
}
