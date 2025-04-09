/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';

import { ExtensionContext } from 'vscode';
import { Command, ExecuteCommandRequest, InlineCompletionParams, LanguageClient, LanguageClientOptions, NotificationType, Range, RequestType, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { ModelConfig } from './config.js';
import { CopilotCompletion } from './completion.js';
import { randomUUID } from 'crypto';

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

/** A Copilot inline completion item; a special case of vscode-languageclient's InlineCompletionItem. */
interface CopilotInlineCompletionItem {
	insertText: string;
	range: Range;
	command: Command;
}

/** A Copilot inline completion list; a special case of vscode-languageclient's InlineCompletionList. */
interface CopilotCompletionList {
	items: CopilotInlineCompletionItem[];
}

/** Initiate Copilot authentication. */
namespace SignInRequest {
	export const type = new RequestType<SignInParams, SignInCommand | AlreadySignedInStatus, void>('signIn');
}

/** Sign out of Copilot. */
namespace SignOutRequest {
	export const type = new RequestType<SignOutParams, void, void>('signOut');
}

/** Emitted when the status of the client has changed. */
namespace DidChangeStatusNotification {
	export const type = new NotificationType<DidChangeStatusParams>('didChangeStatus');
}

/** Request inline completions; a special-case of vscode-languageclient's InlineCompletionRequest. */
namespace CopilotInlineCompletionRequest {
	export const type = new RequestType<InlineCompletionParams, CopilotCompletionList, void>('textDocument/inlineCompletion');
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

	/** The path to the bundled language server module. */
	private _serverModule: string;

	private _client?: CopilotLanguageClient;

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
	) {
		// Get the path to the language server module.
		this._serverModule = path.join(this._context.extensionPath, 'node_modules', '@github', 'copilot-language-server', 'dist', 'language-server.js');

		this.registerCommands();
	}

	/** Register Copilot commands. */
	private registerCommands() {
		this._disposables.push(
			vscode.commands.registerCommand('positron-assistant.copilot.signin', async () => {
				await this.signIn();
			}),
			vscode.commands.registerCommand('positron-assistant.copilot.signout', async () => {
				await this.signOut();
			})
		);
	}

	/** Get the Copilot language client. */
	private client(): CopilotLanguageClient {
		if (!this._client) {
			// The client does not exist, create it.
			const packageJSON = this._context.extension.packageJSON;
			const editorPluginInfo: EditorPluginInfo = {
				name: packageJSON.name,
				version: packageJSON.version,
			};
			this._client = new CopilotLanguageClient(this._serverModule, editorPluginInfo);
		}
		return this._client;
	}

	/**
	 * Prompt the user to sign in to Copilot if they aren't already signed in.
	 */
	private async signIn(): Promise<void> {
		// HACK: Register the Copilot completion item provider.
		// This is a temporary workaround until the configuration UI supports
		// Copilot completions. It should be safe for now since the sign in
		// command is only enabled when the hidden `positron.assistant.copilot.enable`
		// setting is enabled.
		this.registerInlineCompletionItemProvider();

		const client = this.client();
		const response = await client.sendRequest(SignInRequest.type, {});

		if ('status' in response && 'user' in response) {
			return;
		}

		await vscode.env.clipboard.writeText(response.userCode);
		const shouldLogin = await positron.methods.showQuestion(
			'GitHub Copilot Sign In',
			`You will need this code to sign in: <code>${response.userCode}</code>. It has been copied to your clipboard.`,
			'OK',
			'Cancel');

		if (shouldLogin) {
			await client.sendRequest(ExecuteCommandRequest.type, response.command);
		}
	}

	private registerInlineCompletionItemProvider(): void {
		const modelConfig: ModelConfig = {
			apiKey: '',
			id: randomUUID(),
			type: CopilotCompletion.source.type,
			model: CopilotCompletion.source.defaults.model,
			name: CopilotCompletion.source.defaults.name,
			provider: CopilotCompletion.source.provider.id,
		};
		const provider = new CopilotCompletion(modelConfig);
		this._disposables.push(
			vscode.languages.registerInlineCompletionItemProvider({ pattern: '**/*.*' }, provider)
		);
	}

	/** Sign out of Copilot. */
	private async signOut(): Promise<void> {
		const client = this.client();
		await client.sendRequest(SignOutRequest.type, {});
	}

	async provideInlineCompletionItems(
		textDocument: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionList> {
		const client = this.client();
		const request = client.code2ProtocolConverter.asInlineCompletionParams(textDocument, position, context);
		const result = await client.sendRequest(CopilotInlineCompletionRequest.type, request, token);
		return client.protocol2CodeConverter.asInlineCompletionResult(result);
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
	public sendRequest: typeof this._client.sendRequest;
	public start: typeof this._client.start;

	/**
	 * @param module The path to the language server module.
	 * @param editorPluginInfo The editor plugin information used to initialize the client.
	 */
	constructor(
		module: string,
		editorPluginInfo: EditorPluginInfo,
	) {
		const serverOptions: ServerOptions = {
			run: { module, transport: TransportKind.ipc },
			debug: { module, transport: TransportKind.ipc },
		};

		const outputChannel = vscode.window.createOutputChannel('GitHub Copilot Language Server', { log: true });
		this._disposables.push(outputChannel);

		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: '*' }],
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
		this.sendRequest = this._client.sendRequest.bind(this._client);
		this.start = this._client.start.bind(this._client);
	}

	dispose(): void {
		this._disposables.forEach((disposable) => disposable.dispose());
	}
}
