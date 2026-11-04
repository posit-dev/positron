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
import { isExcludedFromAI } from './gate.js';

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

//#endregion

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

	constructor(
		context: vscode.ExtensionContext,
		auth: CopilotServerAuth,
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
			documentSelector: [
				{ scheme: 'file' },
				{ scheme: 'untitled' },
				{ scheme: 'vscode-notebook-cell' },
				{ scheme: 'vscode-remote' },
			],
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
				// Keep files matched by `aiExcludes` off the server entirely.
				didOpen: (document, next) => isExcludedFromAI(document.uri) ? Promise.resolve() : next(document),
				didChange: (event, next) => isExcludedFromAI(event.document.uri) ? Promise.resolve() : next(event),
				didClose: (document, next) => isExcludedFromAI(document.uri) ? Promise.resolve() : next(document),
				notebooks: this.createNotebookMiddleware(),
			},
		};

		this.client = new LanguageClient(
			'githubCopilotLanguageServer',
			'GitHub Copilot Language Server',
			serverOptions,
			clientOptions,
		);
		this._disposables.push(this.client, this._onDidChangeStatus);

		this._disposables.push(
			this.client.onNotification(DidChangeStatusNotification, params => {
				this._log.debug(`didChangeStatus: ${JSON.stringify(params)}`);
				this._onDidChangeStatus.fire(params);
			}),
			vscode.window.onDidChangeActiveTextEditor(editor => this.sendDidFocus(editor)),
		);
	}

	async start(): Promise<void> {
		await this.client.start();
		this.sendDidFocus(vscode.window.activeTextEditor);
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
		const params = document && !isExcludedFromAI(document.uri)
			? { textDocument: { uri: this.client.code2ProtocolConverter.asUri(document.uri) } }
			: {};
		void this.client.sendNotification(DidFocusNotification, params);
	}

	private createNotebookMiddleware(): NotebookDocumentMiddleware['notebooks'] {
		// The server advertises notebook support, which makes
		// vscode-languageclient send notebookDocument/did* notifications instead
		// of textDocument/did*. The server doesn't create the cell text
		// documents those reference, causing "document not found" errors
		// (https://github.com/posit-dev/positron/issues/8061). Send
		// textDocument/did* for each affected cell as well.
		const client = () => this.client;
		return {
			async didOpen(notebookDocument, cells, next) {
				if (isExcludedFromAI(notebookDocument.uri)) {
					return;
				}
				for (const cell of cells) {
					await client().sendNotification(DidOpenTextDocumentNotification.type,
						client().code2ProtocolConverter.asOpenTextDocumentParams(cell.document));
				}
				return next(notebookDocument, cells);
			},
			async didChange(event, next) {
				if (isExcludedFromAI(event.notebook.uri)) {
					return;
				}
				const c2p = client().code2ProtocolConverter;
				for (const cell of event.cells?.structure?.didOpen ?? []) {
					await client().sendNotification(DidOpenTextDocumentNotification.type, c2p.asOpenTextDocumentParams(cell.document));
				}
				for (const cell of event.cells?.structure?.didClose ?? []) {
					await client().sendNotification(DidCloseTextDocumentNotification.type, c2p.asCloseTextDocumentParams(cell.document));
				}
				for (const change of event.cells?.textContent ?? []) {
					const params: DidChangeTextDocumentParams = {
						textDocument: c2p.asVersionedTextDocumentIdentifier(change.document),
						contentChanges: change.contentChanges.map(c => ({ range: c2p.asRange(c.range), text: c.text })),
					};
					await client().sendNotification(DidChangeTextDocumentNotification.type, params);
				}
				return next(event);
			},
			async didClose(notebookDocument, cells, next) {
				if (isExcludedFromAI(notebookDocument.uri)) {
					return;
				}
				for (const cell of cells) {
					await client().sendNotification(DidCloseTextDocumentNotification.type,
						client().code2ProtocolConverter.asCloseTextDocumentParams(cell.document));
				}
				return next(notebookDocument, cells);
			},
		};
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}
