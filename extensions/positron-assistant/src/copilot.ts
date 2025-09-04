/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';

import { ExtensionContext } from 'vscode';
import { Command, DidChangeTextDocumentNotification, DidChangeTextDocumentParams, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, Executable, ExecuteCommandRequest, InlineCompletionItem, InlineCompletionRequest, LanguageClient, LanguageClientOptions, Middleware, NotebookDocumentMiddleware, NotificationType, RequestType, ServerOptions, TextDocumentItem, TransportKind } from 'vscode-languageclient/node';
import { arch, platform } from 'os';
import { ALL_DOCUMENTS_SELECTOR } from './constants.js';

interface EditorPluginInfo {
	name: string;
	version: string;
}

/** A command that opens the browser to the Copilot authentication page. */
interface SignInCommand {
	command: Command;
	userCode: string;
}

/** The status returned from a {@link SignInRequest} if a user is already signed in. */
interface AlreadySignedInStatus {
	status: 'AlreadySignedIn';
	user: string;
}

/** The kind of the status notification. */
enum StatusKind {
	Normal = 'Normal',
	Error = 'Error',
	Warning = 'Warning',
	Inactive = 'Inactive',
}

/** The parameters for a {@link SignInRequest}. */
interface SignInParams { }

/** The parameters for a {@link SignOutRequest}. */
interface SignOutParams { }

/** The parameters for a {@link DidChangeStatusNotification}. */
interface DidChangeStatusParams {
	message?: string;
	busy: boolean;
	kind: StatusKind;
}

/** The parameters for a {@link DidShowCompletionNotification}. */
interface DidShowCompletionParams {
	item: InlineCompletionItem;
}

/** The parameters for a {@link DidPartiallyAcceptCompletionNotification}. */
interface DidPartiallyAcceptCompletionParams {
	item: InlineCompletionItem;
	acceptedLength: number;
}

/** Initiate Copilot authentication. */
namespace SignInRequest {
	export const type = new RequestType<SignInParams, SignInCommand | AlreadySignedInStatus, void>('signIn');
}

/** Sign out of Copilot. */
namespace SignOutRequest {
	export const type = new RequestType<SignOutParams, void, void>('signOut');
}

/** Emitted by the server when its status has changed. */
namespace DidChangeStatusNotification {
	export const type = new NotificationType<DidChangeStatusParams>('didChangeStatus');
}

/** Emitted by the client when a completion item is shown to the user. */
namespace DidShowCompletionNotification {
	export const type = new NotificationType<DidShowCompletionParams>('textDocument/didShowCompletion');
}

/** Emitted by the client when a completion item is partially accepted by the user. */
namespace DidPartiallyAcceptCompletionNotification {
	export const type = new NotificationType<DidPartiallyAcceptCompletionParams>('textDocument/didPartiallyAcceptCompletion');
}

/** Register the Copilot service. */
export function registerCopilotService(context: ExtensionContext) {
	// Use the singleton pattern to ensure only one CopilotService instance exists
	const copilotService = CopilotService.create(context);
	context.subscriptions.push(copilotService);
}

export class CopilotService implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	/** The CopilotService singleton instance. */
	private static _instance?: CopilotService;

	private _clientManager?: CopilotLanguageClientManager;

	/** Current sign-in state. */
	private _signedIn = false;
	private readonly _onSignedInChanged = new vscode.EventEmitter<boolean>();
	public readonly onSignedInChanged = this._onSignedInChanged.event;

	/** The cancellation token for the current operation. */
	private _cancellationToken: vscode.CancellationTokenSource | null = null;

	/** Create the CopilotLanguageService singleton instance. */
	public static create(context: ExtensionContext) {
		if (CopilotService._instance) {
			return CopilotService._instance;
		}
		CopilotService._instance = new CopilotService(context);
		return CopilotService._instance;
	}

	/** Retrieve the CopilotLanguageService singleton instance. */
	public static instance(): CopilotService {
		if (!CopilotService._instance) {
			throw new Error('CopilotService was not created. Call create() first.');
		}
		return CopilotService._instance;
	}

	private constructor(
		private readonly _context: vscode.ExtensionContext,
	) { }

	/** Get the Copilot language client. */
	private client(): LanguageClient {
		if (!this._clientManager) {
			// The client manager does not exist, create it.
			const serverName = platform() === 'win32' ? 'copilot-language-server.exe' : 'copilot-language-server';
			let serverPath = path.join(this._context.extensionPath, 'resources', 'copilot');

			// On macOS, we include both x64 and arm64 architectures, so select
			// the correct one based on the current architecture.
			if (platform() === 'darwin') {
				serverPath = path.join(serverPath, arch());
			}

			const command = path.join(serverPath, serverName);
			const executable: Executable = {
				command,
				args: ['--stdio'],
				transport: TransportKind.stdio,
			};
			const packageJSON = this._context.extension.packageJSON;
			const editorPluginInfo: EditorPluginInfo = {
				name: packageJSON.name,
				version: packageJSON.version,
			};
			this._clientManager = new CopilotLanguageClientManager(executable, editorPluginInfo);

			// Observe status changes to infer sign-in state
			const client = this._clientManager.client;
			this._disposables.push(
				client.onNotification(DidChangeStatusNotification.type, (params: DidChangeStatusParams) => {
					// Heuristic: Normal => signed in; Inactive => signed out
					if (params.kind === StatusKind.Inactive) {
						this.setSignedIn(false);
					} else if (params.kind === StatusKind.Normal) {
						this.setSignedIn(true);
					}
				})
			);
		}
		return this._clientManager.client;
	}

	/**
	 * Cancel the current operation if it is in progress.
	 */
	cancelCurrentOperation(): void {
		this._cancellationToken?.cancel();
		this._cancellationToken?.dispose();
		this._cancellationToken = null;
	}

	/**
	 * Prompt the user to sign in to Copilot if they aren't already signed in.
	 */
	async signIn(): Promise<void> {
		const client = this.client();
		const response = await client.sendRequest(SignInRequest.type, {});

		if ('status' in response && 'user' in response) {
			vscode.window.showInformationMessage(vscode.l10n.t('Already signed in to GitHub Copilot as {0}.', response.user));
			return;
		}

		await vscode.env.clipboard.writeText(response.userCode);
		await positron.methods.showDialog(
			'GitHub Copilot Sign In',
			`You will need this code to sign in: <code>${response.userCode}</code>. It has been copied to your clipboard.`,
		);

		this._cancellationToken = new vscode.CancellationTokenSource();
		let cancelled = false;

		this._cancellationToken.token.onCancellationRequested(() => {
			if (this._cancellationToken) {
				cancelled = true;
				vscode.window.showInformationMessage(vscode.l10n.t('GitHub Copilot sign-in cancelled.'));
			}
		});

		try {
			await client.sendRequest(ExecuteCommandRequest.type, response.command, this._cancellationToken.token);
		} catch (error) {
			if (cancelled || error instanceof vscode.CancellationError) {
				vscode.window.showInformationMessage(vscode.l10n.t('GitHub Copilot sign-in cancelled.'));
				throw new vscode.CancellationError();
			}

			throw error;
		} finally {
			this._cancellationToken?.dispose();
			this._cancellationToken = null;
		}

		if (cancelled) {
			throw new vscode.CancellationError();
		}

		// Consider sign-in successful
		this.setSignedIn(true);
	}

	/** Sign out of Copilot. */
	async signOut(): Promise<boolean> {
		const client = this.client();

		try {
			await client.sendRequest(SignOutRequest.type, {});
			this.setSignedIn(false);
			return true;
		} catch (error) {
			if (error instanceof Error) {
				vscode.window.showErrorMessage(vscode.l10n.t('Failed to sign out of GitHub Copilot: {0}', error.message));
			} else {
				vscode.window.showErrorMessage(vscode.l10n.t('Failed to sign out of GitHub Copilot.'));
			}
			return false;
		}
	}

	private setSignedIn(value: boolean): void {
		if (this._signedIn !== value) {
			this._signedIn = value;
			this._onSignedInChanged.fire(value);
		}
	}

	public get isSignedIn(): boolean {
		return this._signedIn;
	}

	async inlineCompletion(
		textDocument: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
		const client = this.client();
		const params = client.code2ProtocolConverter.asInlineCompletionParams(textDocument, position, context);
		client.debug(`Sending inline completion request: ${JSON.stringify(params)}`);
		try {
			const result = await client.sendRequest(InlineCompletionRequest.type, params, token);
			return client.protocol2CodeConverter.asInlineCompletionResult(result);
		} catch (error) {
			client.debug(`Error getting inline completions: ${error}`);
			throw error;
		}
	}

	private asCopilotInlineCompletionItem(completionItem: vscode.InlineCompletionItem, updatedInsertText?: string): InlineCompletionItem {
		const client = this.client();
		return {
			insertText: updatedInsertText ?? (completionItem.insertText instanceof vscode.SnippetString ? completionItem.insertText.value : completionItem.insertText),
			range: completionItem.range && client.code2ProtocolConverter.asRange(completionItem.range),
			command: completionItem.command && client.code2ProtocolConverter.asCommand(completionItem.command),
		};
	}

	private asDidShowCompletionParams(completionItem: vscode.InlineCompletionItem, updatedInsertText: string): DidShowCompletionParams {
		return {
			item: this.asCopilotInlineCompletionItem(completionItem, updatedInsertText),
		};
	}

	private asDidShowPartiallyAcceptCompletionParams(completionItem: vscode.InlineCompletionItem, acceptedLength: number): DidPartiallyAcceptCompletionParams {
		return {
			item: this.asCopilotInlineCompletionItem(completionItem),
			acceptedLength,
		};
	}

	didShowCompletionItem(completionItem: vscode.InlineCompletionItem, updatedInsertText: string): void {
		const client = this.client();
		const params = this.asDidShowCompletionParams(completionItem, updatedInsertText);
		client.sendNotification(DidShowCompletionNotification.type, params);
	}

	didPartiallyAcceptCompletionItem(completionItem: vscode.InlineCompletionItem, acceptedLength: number): void {
		const client = this.client();
		const params = this.asDidShowPartiallyAcceptCompletionParams(completionItem, acceptedLength);
		client.sendNotification(DidPartiallyAcceptCompletionNotification.type, params);
	}

	dispose(): void {
		this._disposables.forEach((disposable) => disposable.dispose());
		this._onSignedInChanged.dispose();
		this._clientManager?.dispose();

		// Reset the singleton instance when disposing
		CopilotService._instance = undefined;
	}
}

export class CopilotLanguageClientManager implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	/** The wrapped language client. */
	public readonly client: LanguageClient;

	/**
	 * @param executable The language server executable.
	 * @param editorPluginInfo The editor plugin information used to initialize the client.
	 */
	constructor(
		executable: Executable,
		editorPluginInfo: EditorPluginInfo,
	) {
		const serverOptions: ServerOptions = {
			run: executable,
			debug: executable,
		};

		const outputChannel = vscode.window.createOutputChannel('GitHub Copilot Language Server', { log: true });
		this._disposables.push(outputChannel);

		const clientOptions: LanguageClientOptions = {
			documentSelector: ALL_DOCUMENTS_SELECTOR,
			progressOnInitialization: true,
			outputChannel,
			initializationOptions: {
				editorInfo: {
					name: 'Positron',
					version: positron.version,
				},
				editorPluginInfo,
			},
			middleware: {
				notebooks: this.createNotebookMiddleware(),
			},
		};

		// Create the client.
		this.client = new LanguageClient(
			'githubCopilotLanguageServer',
			'GitHub Copilot Language Server',
			serverOptions,
			clientOptions,
		);
		this._disposables.push(this.client);

		// Log status changes for debugging.
		this._disposables.push(
			this.client.onNotification(DidChangeStatusNotification.type, (params: DidChangeStatusParams) => {
				this.client.debug(`DidChangeStatusNotification: ${JSON.stringify(params)}`);
			})
		);
	}

	private createNotebookMiddleware(): NotebookDocumentMiddleware['notebooks'] {
		// The Copilot language server advertises that it supports notebooks
		// (in the initialize result) which causes vscode-languageclient to
		// send notebookDocument/did* notifications instead of textDocument/did*
		// notifications. Servers are expected to create the text documents
		// referenced in the notebook document, however, the Copilot server
		// doesn't seem to do that, causing "document not found" errors.
		// See: https://github.com/posit-dev/positron/issues/8061.
		//
		// This middleware intercepts notebookDocument/did* notifications and sends
		// textDocument/did* notifications for each affected cell.
		//
		// TODO: The current implementation treats each cell independently,
		// so the server will be aware of all cells in a notebook, but not
		// their structure, kind, outputs, etc.

		const manager = this;
		return {
			async didOpen(notebookDocument, cells, next) {
				for (const cell of cells) {
					const params = manager.client.code2ProtocolConverter.asOpenTextDocumentParams(cell.document);
					await manager.client.sendNotification(DidOpenTextDocumentNotification.type, params);
				}
				return next(notebookDocument, cells);
			},
			async didChange(event, next) {
				for (const cell of event.cells?.structure?.didOpen ?? []) {
					const params = manager.client.code2ProtocolConverter.asOpenTextDocumentParams(cell.document);
					await manager.client.sendNotification(DidOpenTextDocumentNotification.type, params);
				}

				for (const cell of event.cells?.structure?.didClose ?? []) {
					const params = manager.client.code2ProtocolConverter.asCloseTextDocumentParams(cell.document);
					await manager.client.sendNotification(DidCloseTextDocumentNotification.type, params);
				}

				for (const change of event.cells?.textContent ?? []) {
					const params: DidChangeTextDocumentParams = {
						textDocument: manager.client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(change.document),
						contentChanges: change.contentChanges.map(change => ({
							range: manager.client.code2ProtocolConverter.asRange(change.range),
							text: change.text,
						})),
					};
					await manager.client.sendNotification(DidChangeTextDocumentNotification.type, params);
				}
				return await next(event);
			},
			async didClose(notebookDocument, cells, next) {
				for (const cell of cells) {
					const params = manager.client.code2ProtocolConverter.asCloseTextDocumentParams(cell.document);
					await manager.client.sendNotification(DidCloseTextDocumentNotification.type, params);
				}
				return await next(notebookDocument, cells);
			},
		};
	}

	dispose(): void {
		this._disposables.forEach((disposable) => disposable.dispose());
	}
}
