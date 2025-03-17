/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';
import * as crypto from 'crypto';

import { ExtensionContext } from 'vscode';
import { ExecuteCommandRequest, InlineCompletionList, InlineCompletionRequest, InlineCompletionTriggerKind, integer, LanguageClient, LanguageClientOptions, NotificationType, ProtocolRequestType, ProtocolRequestType0, RequestType, RequestType0, ServerOptions, State, StateChangeEvent, TransportKind } from 'vscode-languageclient/node';

const copilotRunningContextKey = 'positron-assistant.copilot.status.running';

interface SignInParams { }

interface SignInCommand {
	command: { command: string; arguments: unknown[] };
	userCode: string;
}

interface AlreadySignedInStatus {
	status: 'AlreadySignedIn';
	user: string;
}

namespace SignInRequest {
	export const type = new RequestType<SignInParams, SignInCommand | AlreadySignedInStatus, void>('signIn');
}

interface SignOutParams { }

namespace SignOutRequest {
	export const type = new RequestType<SignOutParams, void, void>('signOut');
}

interface ConversationTurn {
	request: string;
	response?: string;
}

interface ConversationCapabilities {
	skills: string[];
}

interface ConversationCreateParams {
	model: string;
	workDoneToken: string;
	turns: ConversationTurn[];
	capabilities: ConversationCapabilities;
	source: string;
	computeSuggestions: boolean;
	references: string[];
}

namespace ConversationCreateRequest {
	export const type = new RequestType<ConversationCreateParams, void, void>('conversation/create');
}

interface CopilotModelsParams { }

export interface CopilotModel {
	id: string;
	modelFamily: string;
	modelName: string;
	preview: boolean;
	scopes: ('chat-panel' | 'inline' | 'completion')[];
}

namespace CopilotModelsRequest {
	export const type = new RequestType<CopilotModelsParams, CopilotModel[], void>('copilot/models');
}

export interface CopilotContextRequest {
	conversationId: string;
	turnId: string;
	skillId: string;
}

export interface CopilotProgress {
	token: string;
	value: CopilotProgressPart;
}

type CopilotProgressPart =
	| CopilotProgressBeginConversation
	| CopilotProgressReportSteps
	| CopilotProgressReportReply
	| CopilotProgressEndConversation;

type CopilotProgressBeginConversation = {
	conversationId: string;
	kind: 'begin';
	title: string;
	turnId: string;
};

type CopilotProgressEndConversation = {
	conversationId: string;
	error?: {
		message: string;
	};
	kind: 'end';
	turnId: string;
	followUp?: { message: string };
	suggestedTitle?: string;
};

type CopilotProgressReportSteps = {
	conversationId: string;
	kind: 'report';
	steps: {
		id: 'collect-context' | 'generate-response';
		status: 'running' | 'completed';
		title: string;
	}[];
	turnId: string;
};

type CopilotProgressReportReply = {
	conversationId: string;
	kind: 'report';
	reply: string;
	turnId: string;
};

export enum CopilotStatusKind {
	Normal = 'Normal',
	Error = 'Error',
	Warning = 'Warning',
	Inactive = 'Inactive',
}

export interface CopilotStatusMessage {
	message?: string;
	busy: boolean;
	kind: CopilotStatusKind;
}

export class CopilotLanguageClientService implements vscode.Disposable {
	private static _instance?: CopilotLanguageClientService;

	private readonly _disposables: vscode.Disposable[] = [];

	copilotClient: LanguageClient;

	private _statusBar: vscode.StatusBarItem;
	private _didTrySignIn: boolean = false;
	private _conversationRegistry = new Map<string, (part: CopilotProgressPart) => void>();
	private _followupRegistry = new Map<string, Promise<vscode.ChatFollowup>>();

	public static instance(context: ExtensionContext): CopilotLanguageClientService {
		if (!CopilotLanguageClientService._instance) {
			CopilotLanguageClientService._instance = new CopilotLanguageClientService(context);
			context.subscriptions.push(CopilotLanguageClientService._instance);
		}
		return CopilotLanguageClientService._instance;
	}

	public static async getFollowup(result: vscode.ChatResult): Promise<vscode.ChatFollowup[]> {
		const id = result.metadata?.requestId;
		if (!id) {
			return [];
		}

		try {
			const followup = await CopilotLanguageClientService._instance?._followupRegistry.get(id);
			return [followup!];
		} catch (e) {
			return [];
		}
	}

	private constructor(context: vscode.ExtensionContext) {
		// Path setup for GitHub Copilot language server
		const serverModule = path.join(context.extensionPath, 'node_modules', '@github', 'copilot-language-server', 'dist', 'language-server.js');
		const serverOptions: ServerOptions = {
			run: { module: serverModule, transport: TransportKind.ipc },
			debug: { module: serverModule, transport: TransportKind.ipc },
		};

		const outputChannel = vscode.window.createOutputChannel('GitHub Copilot Language Server');
		this._disposables.push(outputChannel);

		// Setup for language client and initialization options
		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: '*' }],
			progressOnInitialization: true,
			outputChannel,

			initializationOptions: {
				editorInfo: {
					name: 'vscode',
					version: `${vscode.version}+positron.${positron.version}`,
				},
				editorPluginInfo: {
					name: 'positron-assistant',
					version: '0.0.1',
				}
			},
		};

		this.copilotClient = new LanguageClient(
			'copilotLanguageServer',
			'Copilot Language Server',
			serverOptions,
			clientOptions,
		);

		// Register commands and LSP listeners
		this.registerCommands();
		this.registerStateListeners();
		this.registerResponseStreamHandler();
		this.registerContextProviders();

		// Enable status bar
		this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
		this._statusBar.text = 'GitHub Copilot: Starting';
		this._statusBar.command = {
			title: 'Show Copilot Status Menu',
			command: 'workbench.action.quickOpen',
			arguments: [
				'>Positron Assistant: GitHub Copilot'
			]
		};
		this._statusBar.show();

		// Start Language client
		this.copilotClient.start();
	}

	async registerResponseStreamHandler() {
		this._disposables.push(
			this.copilotClient.onNotification('$/progress', (progress: CopilotProgress) => {
				const id = progress.token;
				if (id && this._conversationRegistry.has(id)) {
					const push = this._conversationRegistry.get(id)!;
					push(progress.value);
				}
			})
		);
	}

	async registerStateListeners() {
		this._disposables.push(
			this.copilotClient.onDidChangeState((event) => this.onDidChangeState(event))
		);

		this._disposables.push(
			this.copilotClient.onNotification('didChangeStatus', (...args) => {
				const message = args[0] as CopilotStatusMessage;
				this.onDidChangeStatus(message);
			})
		);
	}

	async registerContextProviders() {
		// Listen for and respond to `current-editor` "skill"/context provider requests
		this._disposables.push(
			this.copilotClient.onRequest('conversation/context', async (
				params: CopilotContextRequest,
				token: vscode.CancellationToken
			) => {
				switch (params.skillId) {
					case 'current-editor': {
						const editor = vscode.window.activeTextEditor;
						const visibleRange = editor?.visibleRanges[0];
						const selection = editor?.selection;
						return [{
							uri: editor?.document.uri.toString(),
							visibleRange: {
								start: visibleRange?.start,
								end: visibleRange?.end,
							},
							selection: {
								start: selection?.start,
								end: selection?.end,
							},
						}, null];
					}
					default:
						throw new Error(`Unknown skill ID: ${params.skillId}`);
				}
			})
		);
	}

	async registerCommands() {
		// Login flow
		this._disposables.push(
			vscode.commands.registerCommand('positron-assistant.copilot.signin', async () => {
				await this.copilotSignIn();
			})
		);

		// Sign out
		this._disposables.push(
			vscode.commands.registerCommand('positron-assistant.copilot.signout', async () => {
				this.copilotSignOut();
			})
		);
	}

	onDidChangeState(event: StateChangeEvent) {
		vscode.commands.executeCommand('setContext', copilotRunningContextKey, event.newState === State.Running);
	}

	onDidChangeStatus(message: CopilotStatusMessage) {
		if (message.busy) {
			this._statusBar.text = 'GitHub Copilot: Busy';
		} else if (message.message) {
			this._statusBar.text = `GitHub Copilot: ${message.kind}`;
			this._statusBar.tooltip = message.message;
		} else if (message.kind === CopilotStatusKind.Normal) {
			this._statusBar.text = 'GitHub Copilot';
		} else {
			this._statusBar.text = `GitHub Copilot: ${message.kind}`;
		}

		// If there's an error, try signing in to GitHub
		this.copilotSignIn();

	}

	async copilotSignOut() {
		const result = this.copilotClient.sendRequest(SignOutRequest.type, {});
		return result;
	}

	async copilotSignIn() {
		// TODO: We should have a better way to limit the number of times we try to sign in
		if (this._didTrySignIn) {
			return;
		}
		this._didTrySignIn = true;

		const response = await this.copilotClient.sendRequest(SignInRequest.type, {});

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
			this._statusBar.text = 'GitHub Copilot: Sign In';
			await this.copilotClient.sendRequest(ExecuteCommandRequest.type, response.command);
		}
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionList> {
		const request = this.copilotClient.code2ProtocolConverter.asInlineCompletionParams(document, position, context);

		// TODO: Why doesn't the copilot LSP like the triggerKind from asInlineCompletionParams when
		// we invoke manually? Let's just always set it to automatic for now.
		request.context.triggerKind = InlineCompletionTriggerKind.Automatic;

		const result = await this.copilotClient.sendRequest('textDocument/inlineCompletion', request, token) as InlineCompletionList;
		// const result = await this.copilotClient.sendRequest(InlineCompletionRequest.type, request);
		return this.copilotClient.protocol2CodeConverter.asInlineCompletionResult(result, token);
	}

	async provideLanguageModelResponse(
		model: string,
		messages: vscode.LanguageModelChatMessage[],
		options: vscode.LanguageModelChatRequestOptions,
		extensionId: string,
		progress: vscode.Progress<vscode.ChatResponseFragment2>,
		token: vscode.CancellationToken
	) {

		/*
		EXPERIMENTATION
		await this.copilotClient.sendRequest('context/registerProviders', {
			providers: [
				{
					id: 'testing-provider',
					selector: ['*'],
				}
			],
		}).then((...args) => console.log(args));

		await this.copilotClient.sendRequest('conversation/templates', {})
			.then((...args) => console.log(args));
		*/

		const workDoneToken = options.modelOptions?.requestId ?? crypto.randomUUID();

		const turns: { request: string; response?: string }[] = [];
		messages.forEach((message) => {
			if (message.role === vscode.LanguageModelChatMessageRole.User) {
				turns.push({
					request: message.content.reduce((acc, part) => {
						if (part instanceof vscode.LanguageModelTextPart) {
							acc += part.value;
						}
						return acc;
					}, '')
				});
			} else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
				turns.slice(-1)[0].response = message.content.reduce((acc, part) => {
					if (part instanceof vscode.LanguageModelTextPart) {
						acc += part.value;
					}
					return acc;
				}, '');
			}
		});

		// Deferred promise for followup response
		let resolve: (value: vscode.ChatFollowup) => void;
		let reject: (reason?: any) => void;
		const followup = new Promise<vscode.ChatFollowup>((_resolve, _reject) => {
			resolve = _resolve;
			reject = _reject;
		});

		this._followupRegistry.set(workDoneToken, followup);
		this._conversationRegistry.set(workDoneToken, (part: CopilotProgressPart) => {
			if (part.kind === 'report' && 'steps' in part) {
				part.steps.forEach((step) => {
					if (step.id === 'collect-context' && step.status === 'running') {
						if (options.modelOptions?.toolInvocationToken) {
							positron.ai.responseProgress(
								options.modelOptions?.toolInvocationToken,
								new vscode.ChatResponseProgressPart(step.title)
							);
						}
					}
				});
			} else if (part.kind === 'report' && 'reply' in part) {
				progress.report({
					index: 0,
					part: new vscode.LanguageModelTextPart(part.reply)
				});
			} else if (part.kind === 'end') {
				if (part.error) {
					progress.report({
						index: 0,
						part: new vscode.LanguageModelTextPart(part.error.message)
					});
				}

				if (part.followUp) {
					resolve({ prompt: part.followUp.message });
				} else {
					reject('No follow-up provided.');
				}
			}
		});

		// TODO: I think passing the token to sendRequest is already doing this internally?
		// Send cancellation request when token is cancelled
		// const disposable = token.onCancellationRequested(async () => {
		// 	// TODO: Does this work?
		// 	await this.copilotClient.sendNotification(CancelNotification.type, { id: workDoneToken });
		// 	disposable.dispose();
		// });

		const source = (() => {
			switch (options.modelOptions?.location) {
				case vscode.ChatLocation.Editor:
				case vscode.ChatLocation.Terminal:
				case vscode.ChatLocation.Notebook:
					return 'inline';
				default:
					return 'panel';
			}
		})();

		try {
			const result = await this.copilotClient.sendRequest(ConversationCreateRequest.type, {
				model: 'gpt-4o',
				workDoneToken,
				turns,
				capabilities: {
					skills: ['current-editor', 'testing-provider'],
				},
				source,
				computeSuggestions: true,
				references: [],
			}, token);
		} finally {
			this._conversationRegistry.delete(workDoneToken);
		}
	}

	async getModels(): Promise<CopilotModel[]> {
		await this.copilotSignIn();
		const models = await this.copilotClient.sendRequest(CopilotModelsRequest.type, {});
		return models;
	}

	dispose(): void {
		this._disposables.forEach((disposable) => disposable.dispose());
		this.copilotClient.dispose();
		this._statusBar.dispose();
		this._conversationRegistry.clear();
		this._followupRegistry.clear();
	}
}
