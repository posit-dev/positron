/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import {
	Command,
	DidChangeTextDocumentNotification,
	DidChangeTextDocumentParams,
	DidCloseNotebookDocumentNotification,
	DidCloseTextDocumentNotification,
	DidOpenTextDocumentNotification,
	ExecuteCommandRequest,
	LanguageClient,
	LanguageClientOptions,
	NotebookDocumentMiddleware,
	NotificationType,
	Range,
	RequestType,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';
import { AIExclusions } from './gate.js';

//#region Protocol

/** Server status kinds, from the `didChangeStatus` notification. */
export enum StatusKind {
	Normal = 'Normal',
	Error = 'Error',
	Warning = 'Warning',
	Inactive = 'Inactive',
}

export interface DidChangeStatusParams {
	busy: boolean;
	kind: StatusKind;
	message?: string;
	command?: Command;
}

/** Why a suggestion was requested; decides which providers the server asks. */
export type SuggestReason = 'typing' | 'manual' | 'cycling' | 'caretMove' | 'postAccept';

interface SuggestParams {
	textDocument: { uri: string; version: number };
	position: { line: number; character: number };
	reason: SuggestReason;
	formattingOptions: { tabSize: number; insertSpaces: boolean };
	context?: { selectedCompletionInfo?: { text: string; range: Range } };
}

export interface SuggestItem {
	text: string;
	range: Range;
	command?: Command;
}

export interface Suggestion {
	id: string;
	kind: 'completion' | 'edit' | 'jump' | string;
	presentation: 'ghostText' | 'diff' | 'jump' | string;
	target: { uri: string; version: number };
	items: SuggestItem[];
	targetLine?: number;
}

interface SuggestResult {
	suggestion?: Suggestion;
}

const DidChangeStatusNotification = new NotificationType<DidChangeStatusParams>('didChangeStatus');
const DidFocusNotification = new NotificationType<{ textDocument?: { uri: string } }>('textDocument/didFocus');
const DidShowCompletionNotification = new NotificationType<{ item: { insertText: string; range: Range; command?: Command } }>('textDocument/didShowCompletion');
const DidPartiallyAcceptCompletionNotification = new NotificationType<{ item: { insertText: string; range: Range; command?: Command }; acceptedLength: number }>('textDocument/didPartiallyAcceptCompletion');
const DidShowInlineEditNotification = new NotificationType<{ item: { command?: Command } }>('textDocument/didShowInlineEdit');
const SuggestRequest = new RequestType<SuggestParams, SuggestResult | null, void>('textDocument/copilotSuggest');

/** Sign-in state, from `checkStatus`, `signOut` and a finished device flow. */
export interface AuthStatus {
	status: 'OK' | 'NotSignedIn' | 'NotAuthorized' | string;
	user?: string;
}

/** Result of `signIn`: either already signed in, or a device flow to complete. */
export type SignInResult =
	| { status: 'AlreadySignedIn'; user: string }
	| {
		status: 'PromptUserDeviceFlow';
		userCode: string;
		verificationUri: string;
		expiresIn: number;
		interval: number;
		command: Command;
	};

const CheckStatusRequest = new RequestType<{ options?: { localChecksOnly?: boolean; forceRefresh?: boolean } }, AuthStatus, void>('checkStatus');
const SignInRequest = new RequestType<{}, SignInResult, void>('signIn');
const SignOutRequest = new RequestType<{}, AuthStatus, void>('signOut');

/** A quota bucket in the `checkQuota` result. */
interface CheckQuotaSnapshot {
	percentRemaining: number;
	unlimited: boolean;
	overagePermitted: boolean;
	/** Only sent with token-based billing. */
	entitlement?: number;
	/** Only sent with token-based billing. */
	creditsUsed?: number;
}

/** Result of `checkQuota`, which fetches the user's quota from GitHub. */
interface CheckQuotaResult {
	chat?: CheckQuotaSnapshot;
	completions?: CheckQuotaSnapshot;
	premiumInteractions?: CheckQuotaSnapshot;
	resetDate?: string;
	copilotPlan?: string;
	tokenBasedBillingEnabled?: boolean;
}

/** A quota bucket in the `copilot/quotaChange` notification. */
interface QuotaChangeSnapshot {
	/** The entitlement; negative when unlimited. */
	quota: number;
	used: number;
	percentRemaining: number;
	overageEnabled: boolean;
	creditsUsed?: number;
	resetDate: string;
	unlimited: boolean;
}

/**
 * Sent when the server sees new quota data: with the user info on each
 * Copilot token refresh, and from the headers of chat responses (not of
 * completion responses).
 */
interface QuotaChangeParams {
	chat?: QuotaChangeSnapshot;
	completions?: QuotaChangeSnapshot;
	premium_interactions?: QuotaChangeSnapshot;
	copilotPlan?: string;
}

const CheckQuotaRequest = new RequestType<{}, CheckQuotaResult, void>('checkQuota');
const QuotaChangeNotification = new NotificationType<QuotaChangeParams>('copilot/quotaChange');

/** One quota bucket, normalized from `checkQuota` or `copilot/quotaChange`. */
export interface QuotaSnapshot {
	unlimited: boolean;
	percentRemaining: number;
	/** The included amount, when the server reports one. */
	entitlement?: number;
	/** How much of the entitlement is used (credits with token-based billing). */
	used?: number;
	/** Whether paid usage beyond the entitlement is allowed. */
	overageEnabled: boolean;
}

/** The user's Copilot plan and quotas. Fields the server didn't report are undefined. */
export interface CopilotQuota {
	/** The plan id, such as `free`, `individual` or `business`. */
	plan?: string;
	tokenBasedBilling?: boolean;
	resetDate?: string;
	chat?: QuotaSnapshot;
	completions?: QuotaSnapshot;
	premiumInteractions?: QuotaSnapshot;
}

function positiveOrUndefined(value: number | undefined): number | undefined {
	return value !== undefined && value > 0 ? value : undefined;
}

function fromCheckQuotaSnapshot(snapshot: CheckQuotaSnapshot | undefined): QuotaSnapshot | undefined {
	if (!snapshot) {
		return undefined;
	}
	const entitlement = positiveOrUndefined(snapshot.entitlement);
	return {
		unlimited: snapshot.unlimited,
		percentRemaining: snapshot.percentRemaining,
		entitlement,
		used: snapshot.creditsUsed ?? (entitlement !== undefined ? entitlement * (1 - snapshot.percentRemaining / 100) : undefined),
		overageEnabled: snapshot.overagePermitted,
	};
}

function fromQuotaChangeSnapshot(snapshot: QuotaChangeSnapshot | undefined): QuotaSnapshot | undefined {
	if (!snapshot) {
		return undefined;
	}
	const entitlement = positiveOrUndefined(snapshot.quota);
	return {
		unlimited: snapshot.unlimited,
		percentRemaining: snapshot.percentRemaining,
		entitlement,
		used: snapshot.creditsUsed ?? (entitlement !== undefined ? snapshot.used : undefined),
		overageEnabled: snapshot.overageEnabled,
	};
}

//#endregion

/**
 * The documents the client syncs to the server. Inline completions are only
 * requested for these, since the server knows no other documents.
 */
export const COPILOT_DOCUMENT_SELECTOR: { scheme: string }[] = [
	{ scheme: 'file' },
	{ scheme: 'untitled' },
	{ scheme: 'vscode-notebook-cell' },
	{ scheme: 'vscode-remote' },
];

/**
 * How far a notebook tracked by vscode-languageclient is synced to the server:
 * - `full`: the notebook and its cells were opened.
 * - `cells`: only the cells were opened, because the notebook stopped being
 *   excluded after it was opened.
 * - `withheld`: excluded from AI, so nothing was sent.
 */
type NotebookSyncState = 'full' | 'cells' | 'withheld';

/** Identity of the GitHub account the server should use. */
export interface CopilotCredentials {
	token: string;
	user: string;
}

/** How the server gets its GitHub identity. */
export type CopilotServerAuth =
	/** A token from Positron's Accounts session, passed in memory. */
	| { kind: 'accounts'; credentials: CopilotCredentials }
	/**
	 * The server's own device flow (`signIn`), with Copilot's OAuth app.
	 * The server persists the token in `<configDirectory>/github-copilot`,
	 * defaulting to `$XDG_CONFIG_HOME` or `~/.config`.
	 */
	| { kind: 'languageServer'; configDirectory?: string };

/**
 * A client for the GitHub Copilot Language Server.
 *
 * The server runs on Positron's own Node runtime over IPC, so no
 * platform-specific binaries are needed.
 *
 * With `accounts` auth, the GitHub token from Positron's Accounts session is
 * passed through the server's `GH_COPILOT_TOKEN` environment variable rather
 * than the `signInWithGithubToken` request: that request persists the token
 * in plaintext under `~/.config/github-copilot`, while the environment
 * variable keeps it in memory. A changed session therefore means restarting
 * the server.
 *
 * With `languageServer` auth, the server signs in itself through `signIn`
 * and stores the token in plaintext in its `auth.db`, shared with other
 * editors' Copilot plugins that use the same config directory.
 */
export class CopilotLanguageClient implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	readonly client: LanguageClient;

	private readonly _onDidChangeStatus = new vscode.EventEmitter<DidChangeStatusParams>();
	readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private readonly _onDidChangeQuota = new vscode.EventEmitter<CopilotQuota>();
	/**
	 * Quota pushed by the server. It doesn't say whether token-based billing
	 * is on, and may leave out buckets or the reset date.
	 */
	readonly onDidChangeQuota = this._onDidChangeQuota.event;

	/**
	 * Text documents vscode-languageclient has open, by URI, and whether each
	 * was sent to the server (false while excluded from AI).
	 */
	private readonly _textDocuments = new Map<string, { document: vscode.TextDocument; sent: boolean }>();
	/** Notebooks vscode-languageclient has open, by URI. */
	private readonly _notebooks = new Map<string, { notebook: vscode.NotebookDocument; state: NotebookSyncState }>();
	/** URIs of the notebook cells open on the server. */
	private readonly _sentCells = new Set<string>();

	constructor(
		context: vscode.ExtensionContext,
		auth: CopilotServerAuth,
		private readonly _exclusions: AIExclusions,
		private readonly _log: vscode.LogOutputChannel,
	) {
		const serverModule = context.asAbsolutePath(
			path.join('node_modules', '@github', 'copilot-language-server', 'dist', 'language-server.js'));
		// vscode-languageclient merges these over process.env. Node drops
		// undefined values, so a token in the user's environment can't
		// override the device flow sign-in.
		const env: Record<string, string | undefined> = auth.kind === 'accounts'
			? { GH_COPILOT_TOKEN: auth.credentials.token, GH_COPILOT_USER: auth.credentials.user }
			: {
				GH_COPILOT_TOKEN: undefined,
				GITHUB_COPILOT_TOKEN: undefined,
				...(auth.configDirectory ? { XDG_CONFIG_HOME: auth.configDirectory } : {}),
			};
		const serverOptions: ServerOptions = {
			run: { module: serverModule, transport: TransportKind.ipc, options: { env } },
			debug: { module: serverModule, transport: TransportKind.ipc, options: { env } },
		};

		const packageJSON = context.extension.packageJSON;
		const clientOptions: LanguageClientOptions = {
			documentSelector: COPILOT_DOCUMENT_SELECTOR,
			outputChannel: _log,
			initializationOptions: {
				editorInfo: { name: 'Positron', version: positron.version },
				editorPluginInfo: { name: packageJSON.name, version: packageJSON.version },
			},
			synchronize: {
				// Proxy (`http.proxy`, `http.proxyStrictSSL`, `http.proxyAuthorization`),
				// GHE (`github-enterprise.uri`) and telemetry level, in the shape
				// the server reads from `workspace/didChangeConfiguration`.
				configurationSection: ['http', 'github-enterprise', 'telemetry'],
			},
			middleware: {
				// Keep files matched by `aiExcludes` off the server entirely. Track
				// what was sent so a change to the exclusions can open or close
				// exactly the documents whose state flipped.
				didOpen: (document, next) => {
					const sent = !this._exclusions.isExcluded(document.uri);
					this._textDocuments.set(document.uri.toString(), { document, sent });
					return sent ? next(document) : Promise.resolve();
				},
				didChange: (event, next) =>
					this._textDocuments.get(event.document.uri.toString())?.sent ? next(event) : Promise.resolve(),
				didClose: (document, next) => {
					const key = document.uri.toString();
					const sent = this._textDocuments.get(key)?.sent;
					this._textDocuments.delete(key);
					return sent ? next(document) : Promise.resolve();
				},
				notebooks: this.createNotebookMiddleware(),
			},
		};

		this.client = new LanguageClient(
			'githubCopilotLanguageServer',
			'GitHub Copilot Language Server',
			serverOptions,
			clientOptions,
		);
		this._disposables.push(this.client, this._onDidChangeStatus, this._onDidChangeQuota);

		this._disposables.push(
			this.client.onNotification(DidChangeStatusNotification, params => {
				this._log.debug(`didChangeStatus: ${JSON.stringify(params)}`);
				this._onDidChangeStatus.fire(params);
			}),
			this.client.onNotification(QuotaChangeNotification, params => {
				this._log.debug(`copilot/quotaChange: ${JSON.stringify(params)}`);
				this._onDidChangeQuota.fire({
					plan: params.copilotPlan,
					resetDate: params.premium_interactions?.resetDate || params.completions?.resetDate || params.chat?.resetDate || undefined,
					chat: fromQuotaChangeSnapshot(params.chat),
					completions: fromQuotaChangeSnapshot(params.completions),
					premiumInteractions: fromQuotaChangeSnapshot(params.premium_interactions),
				});
			}),
			vscode.window.onDidChangeActiveTextEditor(editor => this.sendDidFocus(editor)),
			this._exclusions.onDidChange(() => this.applyExclusions().catch(err => {
				this._log.error(`Failed to apply changed AI exclusions: ${err}`);
			})),
		);
	}

	async start(): Promise<void> {
		await this.client.start();
		this.sendDidFocus(vscode.window.activeTextEditor);
	}

	/** Whether the server has this document (or notebook cell) open. */
	isSynced(document: vscode.TextDocument): boolean {
		const key = document.uri.toString();
		return this._textDocuments.get(key)?.sent === true || this._sentCells.has(key);
	}

	/** Ask for a ghost-text completion or a next edit at the given position. */
	async suggest(
		document: vscode.TextDocument,
		position: vscode.Position,
		reason: SuggestReason,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken,
	): Promise<Suggestion | undefined> {
		const c2p = this.client.code2ProtocolConverter;
		const result = await this.client.sendRequest(SuggestRequest, {
			textDocument: { uri: c2p.asUri(document.uri), version: document.version },
			position: c2p.asPosition(position),
			reason,
			formattingOptions: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
		}, token);
		return result?.suggestion;
	}

	/** The server's current sign-in state. */
	checkStatus(): Promise<AuthStatus> {
		return this.client.sendRequest(CheckStatusRequest, { options: { localChecksOnly: false } });
	}

	/** Fetch the signed-in user's current plan and quotas from GitHub. */
	async checkQuota(): Promise<CopilotQuota> {
		const result = await this.client.sendRequest(CheckQuotaRequest, {});
		this._log.debug(`checkQuota: ${JSON.stringify(result)}`);
		return {
			plan: result.copilotPlan,
			tokenBasedBilling: result.tokenBasedBillingEnabled,
			resetDate: result.resetDate || undefined,
			chat: fromCheckQuotaSnapshot(result.chat),
			completions: fromCheckQuotaSnapshot(result.completions),
			premiumInteractions: fromCheckQuotaSnapshot(result.premiumInteractions),
		};
	}

	/** Start the server's device flow, or report the account already signed in. */
	signIn(): Promise<SignInResult> {
		return this.client.sendRequest(SignInRequest, {});
	}

	/**
	 * Run the command returned by `signIn`. The server opens the verification
	 * page (through `window/showDocument`) and resolves once the user has
	 * authorized the device, or rejects when the code expires.
	 */
	finishSignIn(command: Command): Promise<AuthStatus> {
		return this.executeCommand(command);
	}

	/** Run a command the server handed out, such as one in `didChangeStatus`. */
	executeCommand<T>(command: Command): Promise<T> {
		return this.client.sendRequest(ExecuteCommandRequest.type, {
			command: command.command,
			arguments: command.arguments,
		});
	}

	/** Remove the server's stored token. */
	signOut(): Promise<AuthStatus> {
		return this.client.sendRequest(SignOutRequest, {});
	}

	didShowCompletion(item: SuggestItem, shownText: string): void {
		void this.client.sendNotification(DidShowCompletionNotification, {
			item: { insertText: shownText, range: item.range, command: item.command },
		});
	}

	didPartiallyAcceptCompletion(item: SuggestItem, acceptedLength: number): void {
		void this.client.sendNotification(DidPartiallyAcceptCompletionNotification, {
			item: { insertText: item.text, range: item.range, command: item.command },
			acceptedLength,
		});
	}

	didShowInlineEdit(item: SuggestItem): void {
		void this.client.sendNotification(DidShowInlineEditNotification, { item: { command: item.command } });
	}

	private sendDidFocus(editor: vscode.TextEditor | undefined): void {
		if (!this.client.isRunning()) {
			return;
		}
		const document = editor?.document;
		const params = document && this.isSynced(document)
			? { textDocument: { uri: this.client.code2ProtocolConverter.asUri(document.uri) } }
			: {};
		void this.client.sendNotification(DidFocusNotification, params);
	}

	/**
	 * Bring the server in line with changed exclusions: close what is now
	 * excluded and open what no longer is. Only documents vscode-languageclient
	 * tracks are touched, so their later changes keep flowing to the server.
	 */
	private async applyExclusions(): Promise<void> {
		if (!this.client.isRunning()) {
			return;
		}
		const c2p = this.client.code2ProtocolConverter;
		for (const entry of this._textDocuments.values()) {
			const excluded = this._exclusions.isExcluded(entry.document.uri);
			if (entry.sent === !excluded) {
				continue;
			}
			entry.sent = !excluded;
			this._log.debug(`${excluded ? 'Closing newly excluded' : 'Opening newly included'} ${entry.document.uri.toString()}`);
			await (excluded
				? this.client.sendNotification(DidCloseTextDocumentNotification.type, c2p.asCloseTextDocumentParams(entry.document))
				: this.client.sendNotification(DidOpenTextDocumentNotification.type, c2p.asOpenTextDocumentParams(entry.document)));
		}
		for (const entry of this._notebooks.values()) {
			const excluded = this._exclusions.isExcluded(entry.notebook.uri);
			if (excluded === (entry.state === 'withheld')) {
				continue;
			}
			this._log.debug(`${excluded ? 'Closing newly excluded' : 'Opening newly included'} ${entry.notebook.uri.toString()}`);
			if (excluded) {
				const wasFull = entry.state === 'full';
				entry.state = 'withheld';
				const cells = entry.notebook.getCells().map(cell => cell.document);
				await this.closeCells(cells);
				if (wasFull) {
					await this.client.sendNotification(DidCloseNotebookDocumentNotification.type, {
						notebookDocument: { uri: c2p.asUri(entry.notebook.uri) },
						cellTextDocuments: cells.map(document => ({ uri: c2p.asUri(document.uri) })),
					});
				}
			} else {
				// Opening the notebook itself would need its full structure; the
				// server only uses the cells' text documents (see below).
				entry.state = 'cells';
				await this.openCells(entry.notebook.getCells().map(cell => cell.document));
			}
		}
	}

	private async openCells(documents: readonly vscode.TextDocument[]): Promise<void> {
		const c2p = this.client.code2ProtocolConverter;
		for (const document of documents) {
			this._sentCells.add(document.uri.toString());
			await this.client.sendNotification(DidOpenTextDocumentNotification.type, c2p.asOpenTextDocumentParams(document));
		}
	}

	private async closeCells(documents: readonly vscode.TextDocument[]): Promise<void> {
		const c2p = this.client.code2ProtocolConverter;
		for (const document of documents) {
			if (this._sentCells.delete(document.uri.toString())) {
				await this.client.sendNotification(DidCloseTextDocumentNotification.type, c2p.asCloseTextDocumentParams(document));
			}
		}
	}

	private createNotebookMiddleware(): NotebookDocumentMiddleware['notebooks'] {
		// The server advertises notebook support, which makes
		// vscode-languageclient send notebookDocument/did* notifications instead
		// of textDocument/did*. The server doesn't create the cell text
		// documents those reference, causing "document not found" errors
		// (https://github.com/posit-dev/positron/issues/8061). Send
		// textDocument/did* for each affected cell as well.
		return {
			didOpen: async (notebookDocument, cells, next) => {
				const excluded = this._exclusions.isExcluded(notebookDocument.uri);
				this._notebooks.set(notebookDocument.uri.toString(), { notebook: notebookDocument, state: excluded ? 'withheld' : 'full' });
				if (excluded) {
					return;
				}
				await this.openCells(cells.map(cell => cell.document));
				return next(notebookDocument, cells);
			},
			didChange: async (event, next) => {
				const state = this._notebooks.get(event.notebook.uri.toString())?.state;
				if (!state || state === 'withheld') {
					return;
				}
				await this.openCells((event.cells?.structure?.didOpen ?? []).map(cell => cell.document));
				await this.closeCells((event.cells?.structure?.didClose ?? []).map(cell => cell.document));
				const c2p = this.client.code2ProtocolConverter;
				for (const change of event.cells?.textContent ?? []) {
					if (!this._sentCells.has(change.document.uri.toString())) {
						continue;
					}
					const params: DidChangeTextDocumentParams = {
						textDocument: c2p.asVersionedTextDocumentIdentifier(change.document),
						contentChanges: change.contentChanges.map(c => ({ range: c2p.asRange(c.range), text: c.text })),
					};
					await this.client.sendNotification(DidChangeTextDocumentNotification.type, params);
				}
				if (state === 'full') {
					return next(event);
				}
			},
			didClose: async (notebookDocument, cells, next) => {
				const key = notebookDocument.uri.toString();
				const state = this._notebooks.get(key)?.state;
				this._notebooks.delete(key);
				if (!state || state === 'withheld') {
					return;
				}
				await this.closeCells(cells.map(cell => cell.document));
				if (state === 'full') {
					return next(notebookDocument, cells);
				}
			},
		};
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}
