/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xml from './xml.js';

import { MARKDOWN_DIR, TOOL_TAG_REQUIRES_ACTIVE_SESSION, TOOL_TAG_REQUIRES_WORKSPACE } from './constants';
import { isChatImageMimeType, isTextEditRequest, isWorkspaceOpen, languageModelCacheBreakpointPart, toLanguageModelChatMessage, uriToString } from './utils';
import { ContextInfo, PositronAssistantToolName } from './types.js';
import { PromptRenderer, UnifiedPrompt, AttachmentsContent, SessionsContent, FollowupsContent, EditorStreamingContent, SelectionStreamingContent, SelectionContent, DefaultContent, EditorContent, FilepathsContent, type AttachmentData, type SessionData, type IHistorySummaryEntry } from './prompts';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { ReplaceStringProcessor } from './replaceStringProcessor.js';
import { ReplaceSelectionProcessor } from './replaceSelectionProcessor.js';
import { log, getRequestTokenUsage } from './extension.js';
import { IChatRequestHandler } from './commands/index.js';
import { getCommitChanges } from './git.js';
import { getEnabledTools } from './api.js';

export enum ParticipantID {
	/** The participant used in the chat pane in Ask mode. */
	Chat = 'positron.assistant.chat',

	/** The participant used in the chat pane in Edit mode. */
	Edit = 'positron.assistant.editingSessionEditor',

	/** The participant used in the chat pane in Agent mode. */
	Agent = 'positron.assistant.agent',

	/** The participant used in editor inline chats. */
	Editor = 'positron.assistant.editor',

	/** The participant used in terminal inline chats. */
	Terminal = 'positron.assistant.terminal',

	/** The participant used in notebook inline chats. */
	Notebook = 'positron.assistant.notebook',
}

export interface ChatRequestData {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	response: vscode.ChatResponseStream;
}

export interface IPositronAssistantParticipant extends vscode.ChatParticipant {
	id: ParticipantID;
	getRequestData(chatRequestId: string): ChatRequestData | undefined;
}

export class ParticipantService implements vscode.Disposable {
	private readonly _participants = new Map<ParticipantID, IPositronAssistantParticipant>();
	private readonly _sessionModels = new Map<string, string>(); // sessionId -> modelId

	registerParticipant(participant: IPositronAssistantParticipant): void {
		this._participants.set(participant.id, participant);

		// Register agent implementation with the vscode API
		const vscodeParticipant = vscode.chat.createChatParticipant(
			participant.id,
			participant.requestHandler.bind(participant),
		);
		vscodeParticipant.iconPath = participant.iconPath;

		// Only register followup provider if enabled
		const followupsEnabled = vscode.workspace.getConfiguration('positron.assistant.followups').get('enable', true);
		if (followupsEnabled) {
			vscodeParticipant.followupProvider = participant.followupProvider;
		}
	}

	getRequestData(chatRequestId: string): ChatRequestData | undefined {
		for (const participant of this._participants.values()) {
			const data = participant.getRequestData(chatRequestId);
			if (data) {
				return data;
			}
		}
		return undefined;
	}

	/**
	 * Track the model used for a chat session.
	 *
	 * @param sessionId The chat session ID
	 * @param modelId The language model ID used for this session
	 */
	trackSessionModel(sessionId: string, modelId: string): void {
		this._sessionModels.set(sessionId, modelId);
	}

	/**
	 * Get the model ID for a chat session.
	 *
	 * @param sessionId The chat session ID
	 * @returns The model ID if found, undefined otherwise
	 */
	getSessionModel(sessionId: string): string | undefined {
		return this._sessionModels.get(sessionId);
	}

	dispose() {
		this._participants.forEach((participant) => participant.dispose());
		this._sessionModels.clear();
	}
}

/** Options about the participant modifiable by the chat request handler. */
export interface PositronAssistantChatContext extends vscode.ChatContext {
	/** The ID of the participant. */
	participantId: ParticipantID;

	/** The system prompt to use for the participant. */
	systemPrompt: string;

	/** The tools allowed for the participant. */
	toolAvailability: Map<PositronAssistantToolName, boolean>;

	/** The context from Positron core. */
	readonly positronContext: Readonly<positron.ai.ChatContext>;

	/** The context information that was attached to the request, if any. */
	contextInfo?: Readonly<ContextInfo>;

	/** Manually attach context information for the chat request. */
	attachContextInfo: (messages: vscode.LanguageModelChatMessage2[]) => Promise<Readonly<ContextInfo> | undefined>;
}

/** Base class for Positron Assistant chat participants. */
abstract class PositronAssistantParticipant implements IPositronAssistantParticipant {
	abstract id: ParticipantID;
	private readonly _requests = new Map<string, ChatRequestData>();
	private static readonly _commands = new WeakMap<typeof PositronAssistantParticipant, Record<string, IChatRequestHandler>>();

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _participantService: ParticipantService,
	) { }
	readonly iconPath = new vscode.ThemeIcon('positron-assistant');

	readonly _receiveFeedbackEventEmitter = new vscode.EventEmitter<vscode.ChatResultFeedback>();
	onDidReceiveFeedback: vscode.Event<vscode.ChatResultFeedback> = this._receiveFeedbackEventEmitter.event;

	readonly _performActionEventEmitter = new vscode.EventEmitter<vscode.ChatUserActionEvent>();
	onDidPerformAction: vscode.Event<vscode.ChatUserActionEvent> = this._performActionEventEmitter.event;

	readonly _pauseStateEventEmitter = new vscode.EventEmitter<vscode.ChatParticipantPauseStateEvent>();
	onDidChangePauseState: vscode.Event<vscode.ChatParticipantPauseStateEvent> = this._pauseStateEventEmitter.event;

	readonly followupProvider: vscode.ChatFollowupProvider = {
		async provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken): Promise<vscode.ChatFollowup[]> {
			// Check if followups are enabled
			const followupsEnabled = vscode.workspace.getConfiguration('positron.assistant.followups').get('enable', true);
			if (!followupsEnabled) {
				return [];
			}

			const models = await vscode.lm.selectChatModels({ id: result.metadata?.modelId });
			if (models.length === 0) {
				throw new Error(vscode.l10n.t('Selected model not available.'));
			}

			const system: string = await PromptRenderer.renderSystemPrompt(FollowupsContent, {}, models[0]);
			const messages = toLanguageModelChatMessage(context.history);
			messages.push(vscode.LanguageModelChatMessage.User('Summarise and suggest follow-ups.'));

			const response = await models[0].sendRequest(messages, { modelOptions: { system } }, token);

			let json = '';
			for await (const fragment of response.text) {
				json += fragment;
				if (token.isCancellationRequested) {
					break;
				}
			}

			try {
				return (JSON.parse(json) as 'string'[]).map((p) => ({ prompt: p }));
			} catch (e) {
				return [];
			}
		}
	};

	async requestHandler(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	) {
		this._requests.set(request.id, { request, context, response });

		try {
			// Get an extended Assistant-specific chat context
			const assistantContext = await this.getAssistantContext(request, context, response);

			// Select request handler based on the command issued by the user for this request
			if (request.command) {
				if (request.command in this.commandRegistry) {
					const handler = this.commandRegistry[request.command];
					const handleDefault = () => this.defaultRequestHandler(request, assistantContext, response, token);
					return await handler(request, assistantContext, response, token, handleDefault);
				} else {
					log.warn(`[participant] No command handler registered in participant ${this.id} for command: ${request.command}`);
				}
			}
			return await this.defaultRequestHandler(request, assistantContext, response, token);
		} finally {
			this._requests.delete(request.id);
		}
	}

	protected get commandRegistry(): Record<string, IChatRequestHandler> {
		const constructor = this.constructor as typeof PositronAssistantParticipant;
		if (!PositronAssistantParticipant._commands.has(constructor)) {
			PositronAssistantParticipant._commands.set(constructor, {});
		}
		return PositronAssistantParticipant._commands.get(constructor)!;
	}

	public static registerCommand(command: string, handler: IChatRequestHandler) {
		if (!PositronAssistantParticipant._commands.has(this)) {
			PositronAssistantParticipant._commands.set(this, {});
		}
		PositronAssistantParticipant._commands.get(this)![command] = handler;
	}

	public getRequestData(chatRequestId: string): ChatRequestData | undefined {
		return this._requests.get(chatRequestId);
	}

	private async getAssistantContext(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<PositronAssistantChatContext> {
		// Render system prompt inline based on participant type
		const systemMessages = await this.renderSystemPromptForParticipant(request);

		// Get the IDE context for the request.
		const positronContext = await positron.ai.getPositronChatContext(request);

		// List of tools for use by the language model.
		const enabledTools = getEnabledTools(request, vscode.lm.tools, this.id);
		const toolAvailability = new Map(
			vscode.lm.tools.map(
				tool => {
					const available = (value: boolean) => [tool.name as PositronAssistantToolName, value] as [PositronAssistantToolName, boolean];

					return available(enabledTools.includes(tool.name));
				}));

		const participant = this;
		const assistantContext: PositronAssistantChatContext = {
			...incomingContext,
			participantId: this.id,
			positronContext,
			systemPrompt,
			toolAvailability,
			contextInfo: undefined,
			async attachContextInfo(messages: vscode.LanguageModelChatMessage2[]) {
				if (assistantContext.contextInfo) {
					return assistantContext.contextInfo;
				}

				const info = assistantContext.contextInfo = await participant.getContextInfo(request, incomingContext, response, positronContext);
				if (info) {
					messages.push(info.message);
				}
				return info;
			}
		};

		return assistantContext;
	}

	private async defaultRequestHandler(
		request: vscode.ChatRequest,
		context: PositronAssistantChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	) {
		const { systemPrompt, positronContext, toolAvailability, attachContextInfo } = context;

		log.debug(`[context] Positron context for request ${request.id}:\n${JSON.stringify(positronContext, null, 2)}`);

		// List of tools for use by the language model.
		const tools: vscode.LanguageModelChatTool[] = vscode.lm.tools.filter(
			tool => toolAvailability.get(tool.name as PositronAssistantToolName) === true
		);

		log.debug(`[tools] Available tools for participant ${this.id}:\n${tools.length > 0 ? tools.map((tool, i) => `${i + 1}. ${tool.name}`).join('\n') : 'No tools available'}`);

		// Construct the transient message thread sent to the language model.
		// Note that this is not the same as the chat history shown in the UI.

		// Start with the system messages
		const messages: (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[] = [...systemMessages];

		// Add the chat history.
		// Note that context.history excludes tool calls and results.
		messages.push(...toLanguageModelChatMessage(context.history));

		// Add the user's prompt.
		const userPromptPart = new vscode.LanguageModelTextPart(request.prompt);
		messages.push(vscode.LanguageModelChatMessage.User([userPromptPart]));

		// Add cache breakpoints to at-most the last 2 user messages.
		addCacheControlBreakpointPartsToLastUserMessages(messages, 2);

		// Add a user message containing context about the request, workspace, running sessions, etc.
		// NOTE: We add the context message after the user prompt so that the context message is
		// not cached. Since the context message is transiently added to each request, caching it
		// will write a prompt prefix to the cache that will never be read. We will want to keep
		// an eye on whether the order of user prompt and context message affects model responses.
		const contextInfo = await attachContextInfo(messages);

		// Send the request to the language model.
		const tokenUsage = await this.sendLanguageModelRequest(request, response, token, messages, tools);

		return {
			metadata: {
				// Attach the model ID as metadata so that we can use the same model in the followup provider.
				modelId: request.model.id,
				// Include token usage if available
				tokenUsage: tokenUsage,
				// Include the tools available for this request
				availableTools: tools.length > 0 ? tools.map(t => t.name) : undefined,
				// Include the context message if available
				positronContext: contextInfo ? { prompts: contextInfo.prompts, attachedDataTypes: contextInfo.attachedDataTypes } : undefined,
			},
		};
	}

	private async renderSystemPromptForParticipant(request: vscode.ChatRequest): Promise<vscode.LanguageModelChatMessage[]> {
		// Determine participant-specific props
		const participantType = this.getParticipantType();
		const props = await this.getUnifiedPromptProps(request, participantType);

		try {
			return await PromptRenderer.renderToMessages(
				UnifiedPrompt,
				props,
				request.model,
				this.getCacheKey(request, participantType)
			);
		} catch (error) {
			console.error('Error rendering system prompt:', error);
			return [];
		}
	}

	private getParticipantType(): 'chat' | 'agent' | 'terminal' | 'editor' | 'edit' {
		switch (this.id) {
			case ParticipantID.Chat:
				return 'chat';
			case ParticipantID.Agent:
				return 'agent';
			case ParticipantID.Terminal:
				return 'terminal';
			case ParticipantID.Editor:
			case ParticipantID.Notebook:
				return 'editor';
			case ParticipantID.Edit:
				return 'edit';
			default:
				return 'chat'; // fallback
		}
	}

	private async getUnifiedPromptProps(request: vscode.ChatRequest, participantType: 'chat' | 'agent' | 'terminal' | 'editor' | 'edit') {
		const baseProps = {
			participantType,
			priority: 100,
			role: 'system'
		};

		switch (participantType) {
			case 'chat':
			case 'agent':
			case 'edit':
				const activeSessions = await this.getActiveSessionLanguages();
				const languageInstructions = await this.getActiveSessionLanguageInstructions();
				return {
					...baseProps,
					includeFilepaths: participantType === 'chat' || participantType === 'edit',
					activeSessions,
					languageInstructions,
				};

			case 'editor':
				if (!isTextEditRequest(request)) {
					throw new Error(`Editor participant only supports editor requests. Got: ${typeof request.location2}`);
				}
				const document = request.location2.document;
				const selection = request.location2.selection;
				const fileExtension = path.extname(document.uri.fsPath).substring(1);
				const isTextEdit = !selection.isEmpty;
				return {
					...baseProps,
					isTextEdit,
					fileExtension,
				};

			case 'terminal':
			default:
				return baseProps;
		}
	}

	private getCacheKey(request: vscode.ChatRequest, participantType: string): string {
		switch (participantType) {
			case 'chat':
			case 'agent':
			case 'edit':
				// Include session info in cache key for these types
				return `${participantType}-prompt-${Date.now()}`; // Simple cache key for now
			case 'editor':
				if (isTextEditRequest(request)) {
					const document = request.location2.document;
					const selection = request.location2.selection;
					const fileExtension = path.extname(document.uri.fsPath).substring(1);
					const isTextEdit = !selection.isEmpty;
					return `editor-prompt-${isTextEdit ? 'selection' : 'document'}-${fileExtension}`;
				}
				return 'editor-prompt';
			case 'terminal':
			default:
				return `${participantType}-prompt`;
		}
	}

	protected mapDiagnostics(diagnostics: vscode.Diagnostic[], selection?: vscode.Position | vscode.Range | vscode.Selection): string {
		const severityMap = {
			[vscode.DiagnosticSeverity.Error]: 'Error',
			[vscode.DiagnosticSeverity.Warning]: 'Warning',
			[vscode.DiagnosticSeverity.Information]: 'Information',
			[vscode.DiagnosticSeverity.Hint]: 'Hint',
		};
		if (selection) {
			if (selection instanceof vscode.Position) {
				diagnostics = diagnostics.filter(d => d.range.contains(selection));
			} else {
				diagnostics = diagnostics.filter(d => {
					const intersection = d.range.intersection(selection);
					return intersection !== undefined && !intersection.isEmpty;
				});
			}
		}
		return diagnostics.map(d => `${d.range.start.line + 1}:${d.range.start.character + 1} - ${severityMap[d.severity]} - ${d.message}`).join('\n');
	}

	private async getContextInfo(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		positronContext: positron.ai.ChatContext,
	): Promise<ContextInfo | undefined> {
		// This function returns a single user message containing all context
		// relevant to a request, including:
		// 1. A text prompt.
		const prompts: string[] = [];
		// 2. Binary data (e.g. image attachments).
		const userDataParts: vscode.LanguageModelDataPart[] = [];

		// If the workspace has an llms.txt document, add it's current value to the prompt.
		const llmsDocument = await openLlmsTextDocument();
		if (llmsDocument) {
			const llmsText = llmsDocument.getText();
			if (llmsText.trim() !== '') {
				// Add the file as a reference in the response.
				response.reference(llmsDocument.uri);

				// Add the contents of the file to the prompt
				const instructionsNode = xml.node('instructions', llmsText);
				prompts.push(instructionsNode);
				log.debug(`[context] adding llms.txt context: ${llmsText.length} characters`);
			}
		}

		// If the user has explicitly attached a tool reference, add it to the prompt.
		if (request.toolReferences.length > 0) {
			const referencePrompts: string[] = [];
			for (const reference of request.toolReferences) {
				referencePrompts.push(xml.node('tool', reference.name));
			}
			const toolReferencesText = 'Attached tool references:';
			prompts.push(xml.node('tool-references', `${toolReferencesText}\n${referencePrompts.join('\n')}`));
		}


		// If the user has explicitly attached files as context, add them to the prompt.
		if (request.references.length > 0) {
			const attachmentData: AttachmentData[] = [];
			const sessionData: SessionData[] = [];
			for (const reference of request.references) {
				const value = reference.value as any;
				if (value.activeSession) {
					// The user attached a runtime session - usually the active session in the IDE.
					const sessionSummary = JSON.stringify(value.activeSession, null, 2);
					let sessionContent = sessionSummary;
					if (value.variables) {
						// Include the session variables in the session content.
						const variablesSummary = JSON.stringify(value.variables, null, 2);
						sessionContent += '\n' + xml.node('variables', variablesSummary);
					}
					log.debug(`[context] adding session context for session ${value.activeSession.identifier}: ${sessionContent.length} characters`);
				} else if (value instanceof vscode.Location) {
					// The user attached a range of a file -
					// usually the automatically attached visible region of the active file.

					const document = await vscode.workspace.openTextDocument(value.uri);
					const path = uriToString(value.uri);
					const documentText = document.getText();
					const visibleText = document.getText(value.range);

					// Add the file as a reference in the response.
					// Although the reference includes a range, we provide the full document text as context
					// and can't distinguish which part the model uses, so we don't include the range in the
					// response reference.
					response.reference(value.uri);

					// Add the visible region attachment.
					attachmentData.push({
						content: visibleText,
						filePath: path,
						description: 'Visible region of the active file',
						language: document.languageId,
						startLine: value.range.start.line + 1,
						endLine: value.range.end.line + 1,
						type: 'range'
					});

					// Add the full document attachment.
					attachmentData.push({
						content: documentText,
						filePath: path,
						description: 'Full contents of the active file',
						language: document.languageId,
						type: 'file'
					});
					log.debug(`[context] adding file range attachment context: ${visibleText.length} characters`);
					log.debug(`[context] adding file attachment context: ${documentText.length} characters`);
				} else if (value instanceof vscode.Uri && value.scheme === 'file') {
					const fileStat = await vscode.workspace.fs.stat(value);
					if (fileStat.type === vscode.FileType.Directory) {
						// The user attached a directory - usually a manually attached directory in the workspace.
						// Format the directory contents for the prompt.
						const entries = await vscode.workspace.fs.readDirectory(value);
						const entriesText = entries.map(([name, type]) => {
							if (type === vscode.FileType.Directory) {
								return `${name}/`;
							}
							return name;
						}).join('\n');
						const path = uriToString(value);

						// TODO: Adding a URI as a response reference shows it in the "Used N references" block.
						//       Files render with the correct icons and when clicked open in the editor.
						//       Folders currently render with the wrong icon and when clicked try to open in the editor,
						//       and opening folders in the editor displays a warning message.
						// response.reference(value);

						// Attach the folder's contents.
						attachmentData.push({
							content: entriesText,
							filePath: path,
							description: 'Contents of the directory',
							type: 'directory'
						});
						log.debug(`[context] adding directory attachment context: ${entriesText.length} characters`);
					} else {
						// The user attached a file - usually a manually attached file in the workspace.
						const document = await vscode.workspace.openTextDocument(value);
						const path = uriToString(value);
						const documentText = document.getText();

						// Add the file as a reference in the response.
						response.reference(value);

						// Attach the full document text.
						attachmentData.push({
							content: documentText,
							filePath: path,
							description: 'Full contents of the file',
							language: document.languageId,
							type: 'file'
						});
						log.debug(`[context] adding file attachment context: ${documentText.length} characters`);
					}
				} else if (value instanceof vscode.Uri && value.scheme === 'scm-history-item') {
					// The user attached a specific git commit
					const details = JSON.parse(value.query) as { historyItemId: string; historyItemParentId: string };
					const diff = await getCommitChanges(value, details.historyItemId, details.historyItemParentId);

					// Add as a reference to the response.
					response.reference(value);

					// Attach the git commit details.
					attachmentData.push({
						content: diff,
						historyItemId: details.historyItemId,
						historyItemParentId: details.historyItemParentId,
						description: 'Git commit details',
						type: 'commit'
					});
					log.debug(`[context] adding git commit details context: ${diff.length} characters`);
				} else if (value instanceof vscode.ChatReferenceBinaryData) {
					if (isChatImageMimeType(value.mimeType)) {
						// The user attached an image - usually a pasted image or screenshot of the IDE.
						const data = await value.data();

						// If the binary data is associated with a file, add it as a reference in the response.
						if (value.reference) {
							response.reference(value.reference);
						}

						// Attach the image.
						attachmentData.push({
							content: '',
							src: reference.name,
							type: 'image'
						});
						log.debug(`[context] adding image attachment context: ${data.length} bytes`);

						userDataParts.push(
							vscode.LanguageModelDataPart.image(data, value.mimeType),
						);
					} else {
						log.warn(`Unsupported chat reference binary data type: ${typeof value}`);
					}
				} else {
					log.warn(`Unsupported reference type: ${typeof value}`);
				}
			}

			if (attachmentData.length > 0) {
				// Add the attachments to the prompt using TSX component
				const attachmentsText = await PromptRenderer.renderToContent(AttachmentsContent, { attachments: attachmentData });
				prompts.push(xml.node('attachments', attachmentsText));
			}

			if (sessionData.length > 0) {
				// Add the session prompts to the context using TSX component
				const sessionText = await PromptRenderer.renderToContent(SessionsContent, { sessions: sessionData });
				prompts.push(xml.node('sessions', sessionText));
			}
		}

		// Add Positron IDE context to the prompt.
		const positronContextPrompts: string[] = [];

		// Note: Runtime session information (active session, variables, execution history)
		// is now provided through IChatRequestRuntimeSessionEntry mechanism rather than
		// being included in the global positronContext. The chat system will automatically
		// include this information when available.
		if (positronContext.shell) {
			const shellNode = xml.node('shell', positronContext.shell, {
				description: 'Current active shell',
			});
			positronContextPrompts.push(shellNode);
			log.debug(`[context] adding shell context: ${shellNode.length} characters`);
		}
		if (positronContext.plots && positronContext.plots.hasPlots) {
			const plotsNode = xml.node('plots', 'A plot is visible.');
			positronContextPrompts.push(plotsNode);
			log.debug(`[context] adding plots context: ${plotsNode.length} characters`);
		}
		if (positronContext.positronVersion) {
			const versionNode = xml.node('version', `Positron version: ${positronContext.positronVersion}`);
			positronContextPrompts.push(versionNode);
			log.debug(`[context] adding positron version context: ${versionNode.length} characters`);
		}
		if (positronContext.currentDate) {
			const dateNode = xml.node('date', `Today's date is: ${positronContext.currentDate}`);
			positronContextPrompts.push(dateNode);
			log.debug(`[context] adding date context: ${dateNode.length} characters`);
		}
		if (positronContextPrompts.length > 0) {
			prompts.push(xml.node('context', positronContextPrompts.join('\n\n')));
		}

		// Subclasses can override `getCustomPrompt` to append to the context message prompt.
		const customPrompt = await this.getCustomPrompt(request);
		if (customPrompt.length > 0) {
			prompts.push(customPrompt);
		}

		const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
		if (prompts.length > 0) {
			const prompt = prompts.join('\n\n');
			parts.push(new vscode.LanguageModelTextPart(prompt));
		}

		parts.push(...userDataParts);

		if (parts.length > 0) {
			return {
				message: vscode.LanguageModelChatMessage2.User(parts),
				prompts,
				attachedDataTypes: userDataParts.map(part => part.mimeType),
			};
		}

		return undefined;
	}

	/** Custom prompt for this participant, added before the user prompt. */
	protected async getCustomPrompt(request: vscode.ChatRequest): Promise<string> {
		return '';
	}

	private async sendLanguageModelRequest(
		request: vscode.ChatRequest,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		messages: (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
		tools: vscode.LanguageModelChatTool[],
		system?: string,
	): Promise<{ inputTokens?: number; outputTokens?: number } | undefined> {
		if (token.isCancellationRequested) {
			return;
		}

		// Track the model being used for this session
		const toolContext = request.toolInvocationToken as any;
		if (toolContext?.sessionId && request.model?.id) {
			this._participantService.trackSessionModel(toolContext.sessionId, request.model.id);
		}

		const modelResponse = await request.model.sendRequest(messages, {
			tools,
			modelOptions: {
				toolInvocationToken: request.toolInvocationToken,
				system,
				// Pass the request ID through modelOptions for token usage tracking
				requestId: request.id,
			},
		}, token);

		const textResponses: vscode.LanguageModelTextPart[] = [];
		const toolRequests: vscode.LanguageModelToolCallPart[] = [];
		const toolResponses: Record<string, vscode.LanguageModelToolResult> = {};

		// Create a streaming text processor to allow the model to stream to the chat
		// response e.g. using a loose XML format.
		// This will be undefined if the current context does not require a text processor.
		const textProcessor = this.createTextProcessor(request, response);

		for await (const chunk of modelResponse.stream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (chunk instanceof vscode.LanguageModelTextPart) {
				textResponses.push(chunk);

				if (textProcessor) {
					// If there is a text processor, let it process the chunk
					// and write to the chat response stream.
					await textProcessor.process(chunk.value);
				} else {
					// If there is no text processor, treat the chunk as markdown.
					response.markdown(chunk.value);
				}
			} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
				toolRequests.push(chunk);
			}
		}

		// Flush the text processor, if needed.
		if (textProcessor) {
			await textProcessor.flush();
		}

		// Get actual token usage from the registry
		const tokenUsage = getRequestTokenUsage(request.id);

		// If we do have tool requests to follow up on, use vscode.lm.invokeTool recursively
		if (toolRequests.length > 0) {
			for (const req of toolRequests) {
				if (token.isCancellationRequested) {
					break;
				}

				log.debug(`[tool] Invoking tool ${req.name} with input: ${JSON.stringify(req.input, null, 2)}`);
				const result = await vscode.lm.invokeTool(req.name, {
					input: req.input,
					toolInvocationToken: request.toolInvocationToken,
					model: request.model,
					chatRequestId: request.id,
				}, token);
				log.debug(`[tool] Tool ${req.name} returned result: ${JSON.stringify(result.content, null, 2)}`);
				toolResponses[req.callId] = result;
			}

			const newMessages = [
				...messages,
				vscode.LanguageModelChatMessage.Assistant(textResponses),
				vscode.LanguageModelChatMessage.Assistant(toolRequests),
				vscode.LanguageModelChatMessage.User(
					Object.entries(toolResponses).map(([id, resp]) => {
						return new vscode.LanguageModelToolResultPart(id, resp.content);
					})
				),
			];
			return this.sendLanguageModelRequest(request, response, token, newMessages, tools);
		}

		// Return token usage information
		return tokenUsage;
	}

	/**
	 * Create a streaming text processor for a given request.
	 *
	 * The text processor will be given chunks of text from the language model
	 * and is expected to write to the chat response stream.
	 *
	 * @param request The current chat request.
	 * @param response The chat response stream to write to.
	 * @returns A text processor that handles the request, or undefined if no
	 *  streaming is needed for the request.
	 */
	private createTextProcessor(request: vscode.ChatRequest, response: vscode.ChatResponseStream): TextProcessor | undefined {
		// Currently, we only use streaming text processing in the experimental streaming edit mode.
		if (!isStreamingEditsEnabled() || !isTextEditRequest(request)) {
			return undefined;
		}

		// If the selection is empty, stream string replacements to the document.
		if (request.location2.selection.isEmpty) {
			const replaceStringProcessor = new ReplaceStringProcessor(request.location2.document, response);
			return new StreamingTagLexer({
				tagNames: ReplaceStringProcessor.TagNames,
				contentHandler(chunk) {
					replaceStringProcessor.process(chunk);
				},
			});
		}

		// If the selection is not empty, stream edits to the selection.
		const replaceSelectionProcessor = new ReplaceSelectionProcessor(
			request.location2.document.uri,
			request.location2.selection,
			response,
		);
		return new StreamingTagLexer({
			tagNames: ReplaceSelectionProcessor.TagNames,
			contentHandler(chunk) {
				replaceSelectionProcessor.process(chunk);
			}
		});
	}

	/** Load language-specific instructions for active sessions, returning them as a map */
	protected async getActiveSessionLanguageInstructions(): Promise<Map<string, string>> {
		const sessions = await positron.runtime.getActiveSessions();
		const languages = [...new Set(sessions.map((session) => session.runtimeMetadata.languageId))];

		const instructionsMap = new Map<string, string>();

		await Promise.all(languages.map(async (id) => {
			try {
				const instructions = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', `instructions-${id}.md`), 'utf8');
				instructionsMap.set(id, instructions);
			} catch {
				// There are no additional instructions for this language ID
				// Don't add anything to the map for this language
			}
		}));

		return instructionsMap;
	}

	/** Get active session languages */
	protected async getActiveSessionLanguages(): Promise<string[]> {
		// Extract language names from active sessions
		const sessions = await positron.runtime.getActiveSessions();
		const languages = sessions.map((session) => session.runtimeMetadata.languageId);
		return [...new Set(languages)]; // Remove duplicates
	}

	dispose(): void { }
}

/** The participant used in the chat pane in Ask mode. */
export class PositronAssistantChatParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Chat;


}

/** The participant used in the chat pane in Agent mode. */
export class PositronAssistantAgentParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Agent;


}

/** The participant used in terminal inline chats. */
class PositronAssistantTerminalParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Terminal;


}

/** The participant used in editor inline chats. */
export class PositronAssistantEditorParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Editor;



	async getCustomPrompt(request: vscode.ChatRequest): Promise<string> {
		if (!isTextEditRequest(request)) {
			throw new Error(`Editor participant only supports editor requests. Got: ${typeof request.location2}`);
		}

		// Note: in this case, the current visible region of the document is not
		// included as an attachment in the request.

		// When invoked from the editor, add document and selection context
		const document = request.location2.document;
		const selection = request.location2.selection;
		const selectedText = document.getText(selection);
		const documentText = document.getText();
		const filePath = uriToString(document.uri);

		const editorNodes = [
			xml.node('document', documentText, {
				description: 'Full contents of the active file',
			}),
			xml.node('selection', selectedText, {
				description: 'Selected text in the active file',
			})
		];

		// If there are diagnostics for the file that contain the specified location, add them to the prompt.
		const diagnostics = vscode.languages.getDiagnostics(document.uri);
		if (diagnostics.length > 0) {
			const diagnosticsText = this.mapDiagnostics(diagnostics, selection);
			const diagnosticsNode = xml.node('diagnostics', diagnosticsText, {
				description: 'Diagnostics for the active file',
			});
			editorNodes.push(diagnosticsNode);
		}

		const editorNode = xml.node('editor', editorNodes.join('\n'),
			{
				description: 'Current active editor',
				filePath,
				language: document.languageId,
				line: selection.active.line + 1,
				column: selection.active.character + 1,
				documentOffset: document.offsetAt(selection.active),
			},
		);
		log.debug(`[context] adding editor context: ${editorNode.length} characters`);
		return editorNode;
	}

}

/** The participant used in notebook inline chats. */
class PositronAssistantNotebookParticipant extends PositronAssistantEditorParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Notebook;
	// For now, the Notebook Participant inherits everything from the Editor Participant.
}

/** The participant used in the chat pane in Edit mode. */
class PositronAssistantEditParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Edit;


}

export function registerParticipants(context: vscode.ExtensionContext) {
	// Register the participants service.
	const participantService = new ParticipantService();
	context.subscriptions.push(participantService);

	// Register the Positron Assistant chat participants.
	participantService.registerParticipant(new PositronAssistantChatParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantAgentParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantTerminalParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantEditorParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantNotebookParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantEditParticipant(context, participantService));

	return participantService;
}

async function openLlmsTextDocument(): Promise<vscode.TextDocument | undefined> {
	// If the workspace has an llms.txt document, add it's current value to the message thread.
	if (!vscode.workspace.workspaceFolders) {
		return undefined;
	}

	const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `llms.txt`);
	const fileExists = await vscode.workspace.fs.stat(fileUri).then(() => true, () => false);
	if (!fileExists) {
		return undefined;
	}

	const llmsDocument = await vscode.workspace.openTextDocument(fileUri);
	return llmsDocument;
}

/**
 * Whether the experimental streaming edit mode is enabled.
 */
export function isStreamingEditsEnabled(): boolean {
	return vscode.workspace.getConfiguration('positron.assistant.streamingEdits').get('enable', true);
}

/** Processes streaming text. */
export interface TextProcessor {
	/** Process a chunk of text. */
	process(chunk: string): void | Promise<void>;

	/** Process any unhandled text at the end of the stream. */
	flush(): void | Promise<void>;
}

/**
 * Add cache breakpoints (for Anthropic prompt caching) to the last few user messages.
 *
 * @param messages The chat messages to modify.
 * @param maxCacheBreakpointParts The maximum number of cache breakpoints to add.
 *   Note that Anthropic supports a maximum of 4 cache controls per request and that
 *   we may also cache tools and the system prompt.
 */
function addCacheControlBreakpointPartsToLastUserMessages(
	messages: vscode.LanguageModelChatMessage2[],
	maxCacheBreakpointParts: number,
) {
	let numCacheControlParts = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			continue;
		}
		const lastPart = message.content.at(-1);
		if (!lastPart) {
			continue;
		}
		log.debug(`[participant] Adding cache breakpoint to user message part: ${lastPart.constructor.name}`);
		message.content.push(languageModelCacheBreakpointPart());
		numCacheControlParts++;
		if (numCacheControlParts >= maxCacheBreakpointParts) {
			// We only want to cache the last two user messages.
			break;
		}
	}
}
