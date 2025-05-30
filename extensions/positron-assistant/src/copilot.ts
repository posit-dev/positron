/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';

import { ExtensionContext } from 'vscode';
import { Command, Executable, ExecuteCommandRequest, InlineCompletionItem, InlineCompletionRequest, LanguageClient, LanguageClientOptions, NotificationType, RequestType, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { platform } from 'os';
import { ALL_DOCUMENTS_SELECTOR } from './constants.js';
import { CancelledError } from './utils.js';

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
	const copilotService = CopilotService.create(context);
	context.subscriptions.push(copilotService);
}

export class CopilotService implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	/** The CopilotService singleton instance. */
	private static _instance?: CopilotService;

	private _client?: CopilotLanguageClient;

	/** The cancellation token for the current operation. */
	private _cancellationToken: vscode.CancellationTokenSource | null = null;

	/** Create the CopilotLanguageService singleton instance. */
	public static create(context: ExtensionContext) {
		if (CopilotService._instance) {
			throw new Error('CopilotService was already created.');
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
	private client(): CopilotLanguageClient {
		if (!this._client) {
			// The client does not exist, create it.
			const serverName = platform() === 'win32' ? 'copilot-language-server.exe' : 'copilot-language-server';
			const command = path.join(this._context.extensionPath, 'resources', 'copilot', serverName);
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
			this._client = new CopilotLanguageClient(executable, editorPluginInfo);
		}
		return this._client;
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
			if (cancelled) {
				throw new CancelledError(vscode.l10n.t('GitHub Copilot sign-in was cancelled.'));
			}

			throw error;
		} finally {
			this._cancellationToken?.dispose();
			this._cancellationToken = null;
		}

		if (cancelled) {
			throw new CancelledError(vscode.l10n.t('GitHub Copilot sign-in was cancelled.'));
		}
	}

	/** Sign out of Copilot. */
	async signOut(): Promise<boolean> {
		const client = this.client();

		try {
			await client.sendRequest(SignOutRequest.type, {});
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

	async inlineCompletion(
		textDocument: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
		const client = this.client();
		const params = client.code2ProtocolConverter.asInlineCompletionParams(textDocument, position, context);
		const result = await client.sendRequest(InlineCompletionRequest.type, params, token);
		return client.protocol2CodeConverter.asInlineCompletionResult(result);
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
	}
}

export class CopilotLanguageClient implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	/** The wrapped language client. */
	private readonly _client: LanguageClient;

	// Expose wrapped properties from the language client.
	public code2ProtocolConverter: typeof this._client.code2ProtocolConverter;
	public onNotification: typeof this._client.onNotification;
	public protocol2CodeConverter: typeof this._client.protocol2CodeConverter;
	public sendNotification: typeof this._client.sendNotification;
	public sendRequest: typeof this._client.sendRequest;
	public start: typeof this._client.start;

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
		};

		// Create the client.
		this._client = new LanguageClient(
			'githubCopilotLanguageServer',
			'GitHub Copilot Language Server',
			serverOptions,
			clientOptions,
		);
		this._disposables.push(this._client);

		// Log status changes for debugging.
		this._disposables.push(
			this._client.onNotification(DidChangeStatusNotification.type, (params: DidChangeStatusParams) => {
				outputChannel.debug(`DidChangeStatusNotification: ${JSON.stringify(params)}`);
			})
		);

		// Expose wrapped properties from the language client.
		this.code2ProtocolConverter = this._client.code2ProtocolConverter;
		this.onNotification = this._client.onNotification.bind(this._client);
		this.protocol2CodeConverter = this._client.protocol2CodeConverter;
		this.sendNotification = this._client.sendNotification.bind(this._client);
		this.sendRequest = this._client.sendRequest.bind(this._client);
		this.start = this._client.start.bind(this._client);
	}

	dispose(): void {
		this._disposables.forEach((disposable) => disposable.dispose());
	}
}
