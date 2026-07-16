/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IAgentAllowedCommandsService } from '../../../contrib/positronAiFeatures/common/agentAllowedCommandsService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { ChatViewId } from '../../../contrib/chat/browser/chat.js';
import { ChatViewPane } from '../../../contrib/chat/browser/widgetHosts/viewPane/chatViewPane.js';
import { IChatAgentData, IChatAgentService } from '../../../contrib/chat/common/participants/chatAgents.js';
import { ChatModel, IExportableChatData } from '../../../contrib/chat/common/model/chatModel.js';
import { IChatProgress, IChatService } from '../../../contrib/chat/common/chatService/chatService.js';
import { ILanguageModelsService, IPositronChatProvider } from '../../../contrib/chat/common/languageModels.js';
import { IChatRequestData, IGenerateAssistantPromptRequest, IPositronAssistantConfigurationService, IPositronAssistantService, IPositronChatContext, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IChatProgressDto } from '../../common/extHost.protocol.js';
import { ExtHostAiFeaturesShape, ExtHostPositronContext, ISerializedAgentCommand, ISerializedValidateAndExecuteCommandResult, ISerializedAllowedCommand, MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ChatModeKind } from '../../../contrib/chat/common/constants.js';
import { PromptRenderer } from '../../../contrib/positronAssistant/browser/prompts/promptRenderer.js';
import { getPositronContextPrompts } from '../../../contrib/positronAssistant/browser/prompts/positronContextPrompts.js';
import { getForegroundSessionInfo } from '../../../contrib/positronAssistant/browser/prompts/promptSessions.js';
import * as xml from '../../../contrib/positronAssistant/common/xml.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _proxy: ExtHostAiFeaturesShape;
	private readonly _registrations = this._register(new DisposableMap<string>());
	private _promptRenderer: PromptRenderer | undefined;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronAssistantService private readonly _positronAssistantService: IPositronAssistantService,
		@IPositronAssistantConfigurationService private readonly _positronAssistantConfigurationService: IPositronAssistantConfigurationService,
		@IChatService private readonly _chatService: IChatService,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IFileService private readonly _fileService: IFileService,
		@IAgentAllowedCommandsService private readonly _agentAllowedCommandsService: IAgentAllowedCommandsService,
	) {
		super();
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostAiFeatures);

		// Forward provider configuration changes to the extension host.
		this._register(this._positronAssistantConfigurationService.onChangeProviderConfig(source => {
			this._proxy.$onDidChangeProviderConfig(source);
		}));
	}

	/**
	 * Register chat agent data from the extension host.
	 */
	async $registerChatAgent(agentData: IChatAgentData): Promise<void> {
		const agent = this._register(this._chatAgentService.registerAgent(agentData.id, agentData));
		this._registrations.set(agentData.id, agent);
	}

	/*
	 * Deregister a chat agent.
	 */
	$unregisterChatAgent(id: string): void {
		this._registrations.deleteAndDispose(id);
	}

	/*
	 * Show a modal dialog for language model configuration. Return a promise resolving to the
	 * configuration saved by the user.
	 */
	$languageModelConfig(id: string, options?: IShowLanguageModelConfigOptions): Thenable<void> {
		return new Promise((resolve, reject) => {
			this._positronAssistantService.showLanguageModelModalDialog(
				async (source, config, action) => {
					await this._proxy.$responseProviderAction(source, config, action);
				},
				() => {
					this._proxy.$onCompleteLanguageModelConfig(id);
					resolve();
				},
				options,
			);
		});
	}

	/**
	 * Respond to a request from the extension host to send the current plot data.
	 */
	async $getCurrentPlotUri(): Promise<string | undefined> {
		return this._positronAssistantService.getCurrentPlotUri();
	}

	/**
	 * Respond to a request from the extension host to send a progress part to the chat response.
	 */
	$responseProgress(sessionResource: URI, content: IChatProgressDto): void {
		const progress = revive(content) as IChatProgress;
		const model = this._chatService.getSession(sessionResource) as ChatModel;
		if (!model) {
			throw new Error('Chat session not found.');
		}

		const request = model.getRequests().at(-1)!;
		model.acceptResponseProgress(request, progress);
	}

	/**
	 * Get Positron global context information to be included with every request.
	 */
	async $getPositronChatContext(request: IChatRequestData): Promise<IPositronChatContext> {
		return this._positronAssistantService.getPositronChatContext(request);
	}

	private get promptRenderer(): PromptRenderer {
		if (!this._promptRenderer) {
			this._promptRenderer = new PromptRenderer(this._fileService);
		}
		return this._promptRenderer;
	}

	/**
	 * Generate the Positron assistant prompt for a chat request. Assembles the
	 * mode prompt, the global IDE context, and any attached session context.
	 */
	async $generateAssistantPrompt(request: IGenerateAssistantPromptRequest): Promise<string> {
		// Use the mode currently selected in the chat UI, defaulting to agent.
		const mode = (await this.$getCurrentChatMode()) ?? ChatModeKind.Agent;

		// Describe the runtime the user is currently working in - the selected
		// (foreground) session - so both the language-specific fragments and the
		// context reflect it, rather than whatever other sessions happen to be
		// active in the background.
		const { sessions, contextFragment: activeSessionContext } = getForegroundSessionInfo(this._runtimeSessionService);

		// Reconstruct the minimal request shape the templates reference.
		const renderRequest = request.selectionIsEmpty === undefined
			? undefined
			: { location2: { selection: { isEmpty: request.selectionIsEmpty } } };

		let prompt = await this.promptRenderer.renderModePrompt({ mode, sessions, request: renderRequest, streamingEdits: true });

		// Append the global IDE context for the request.
		const positronContext = this._positronAssistantService.getPositronChatContext({ location: request.location });
		const contextPrompts = getPositronContextPrompts(positronContext);
		if (activeSessionContext) {
			contextPrompts.push(activeSessionContext);
		}
		prompt += contextPrompts.join('\n');
		if (contextPrompts.length > 0) {
			prompt += xml.node('context', contextPrompts.join('\n\n'));
		}

		// Append context about any active sessions attached to the request.
		let allSessions = '';
		for (const reference of request.referenceSessions) {
			let sessionContent = JSON.stringify(reference.activeSession, null, 2);
			if (reference.variables) {
				sessionContent += '\n' + xml.node('variables', JSON.stringify(reference.variables, null, 2));
			}
			allSessions += xml.node('session', sessionContent);
		}
		if (request.referenceSessions.length > 0) {
			const sessionText = await this.promptRenderer.readPromptFile('sessions.md');
			prompt += sessionText + '\n' + xml.node('sessions', allSessions);
		}

		return prompt;
	}

	/**
	 * Get the chat export as a JSON object (IExportableChatData).
	 */
	async $getChatExport(): Promise<IExportableChatData | undefined> {
		return this._positronAssistantService.getChatExport();
	}

	$registerProvider(registration: IPositronLanguageModelSource): void {
		this._positronAssistantConfigurationService.registerProvider(registration);
	}

	$updateProvider(id: string, update: Partial<IPositronLanguageModelSource>): void {
		this._positronAssistantConfigurationService.updateProvider(id, update);

		// Invalidate the provider's model cache so the model picker and
		// welcome view update to reflect that the provider is no longer
		// signed in.
		if (update.signedIn === false) {
			this._languageModelsService.invalidateProvider(id);
		}
	}

	$unregisterProvider(id: string): void {
		this._positronAssistantConfigurationService.unregisterProvider(id);
		this._languageModelsService.invalidateProvider(id);
	}

	async $getRegisteredProviders(): Promise<IPositronLanguageModelSource[]> {
		return this._positronAssistantConfigurationService.getRegisteredSources();
	}

	/**
	 * Check if a file should be enabled for AI completions based on configuration settings.
	 */
	async $areCompletionsEnabled(file: UriComponents): Promise<boolean> {
		const uri = URI.revive(file);
		if (!uri) {
			return true; // If URI is invalid, consider it excluded
		}

		// Use the language model ignored files service to check if the file should be excluded
		return this._positronAssistantService.areCompletionsEnabled(uri);
	}

	/**
	 * Get the current langauge model provider.
	 */
	async $getCurrentProvider(): Promise<IPositronChatProvider | undefined> {
		return this._languageModelsService.currentProvider;
	}

	/**
	 * Get the current chat mode selected in the Chat panel.
	 */
	async $getCurrentChatMode(): Promise<string | undefined> {
		const chatPanel = this._viewsService.getActiveViewWithId<ChatViewPane>(ChatViewId);
		return chatPanel?.widget.input.currentModeKind;
	}

	/**
	 * Get all the available langauge model providers.
	 */
	async $getProviders(): Promise<IPositronChatProvider[]> {
		return this._languageModelsService.getLanguageModelProviders();
	}

	/**
	 * Set the current language chat provider.
	 */
	async $setCurrentProvider(id: string): Promise<IPositronChatProvider | undefined> {
		const provider = this._languageModelsService.getLanguageModelProviders().find(p => p.id === id);
		this._languageModelsService.currentProvider = provider;
		return provider;
	}

	/**
	 * Get the list of enabled provider IDs from configuration.
	 */
	async $getEnabledProviders(): Promise<string[]> {
		return this._positronAssistantConfigurationService.getEnabledProviders();
	}

	/**
	 * Return the curated set of Positron commands available to AI agents.
	 */
	async $getAgentAllowedCommands(): Promise<ISerializedAgentCommand[]> {
		return this._agentAllowedCommandsService.getAgentAllowedCommands().map(cmd => ({
			id: cmd.id,
			description: cmd.description,
			args: cmd.args?.map(a => ({
				name: a.name,
				description: a.description,
				schema: a.schema,
				required: a.required,
			})),
			returns: cmd.returns,
			source: {
				type: cmd.source.type,
				id: cmd.source.id,
				displayName: cmd.source.displayName,
			},
		}));
	}

	/**
	 * Check that a command exists and is currently enabled, then execute it.
	 * Returns a structured result the caller can act on.
	 */
	async $validateAndExecuteCommand(
		commandId: string,
		args: unknown[] | undefined,
	): Promise<ISerializedValidateAndExecuteCommandResult> {
		return this._agentAllowedCommandsService.validateAndExecute(commandId, args);
	}

	/**
	 * Return all registered commands with their IDs, descriptions, and parameter metadata.
	 * Internal commands (IDs starting with '_') are excluded.
	 */
	async $getAllowedCommands(): Promise<ISerializedAllowedCommand[]> {
		const allCommands = CommandsRegistry.getCommands();
		const menuCommands = MenuRegistry.getCommands();

		// Build title map from command palette menu items — catches MultiCommand/EditorCommand
		// registrations (e.g. undo, redo) that use appendMenuItem instead of addCommand.
		const paletteItemTitles = new Map<string, string>();
		for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
			if (isIMenuItem(item)) {
				const { id, title } = item.command;
				if (title) {
					paletteItemTitles.set(id, typeof title === 'string' ? title : title.value);
				}
			}
		}

		// Build label map from editor actions (covers undo, redo, cursor commands, etc.)
		const editorActionLabels = new Map<string, string>();
		for (const action of EditorExtensionsRegistry.getEditorActions()) {
			editorActionLabels.set(action.id, action.label);
		}

		const result: ISerializedAllowedCommand[] = [];

		for (const [id, command] of allCommands) {
			if (id.startsWith('_')) {
				continue;
			}

			const meta = command.metadata;
			const menuCmd = menuCommands.get(id);

			let description: string | undefined;
			if (meta?.description) {
				description = typeof meta.description === 'string'
					? meta.description
					: meta.description.value;
			} else if (menuCmd) {
				const title = menuCmd.title;
				description = typeof title === 'string' ? title : title.value;
			} else {
				description = paletteItemTitles.get(id) ?? editorActionLabels.get(id);
			}

			const cmdSource = menuCmd?.source;
			const source: ISerializedAllowedCommand['source'] = cmdSource
				? { type: 'extension', id: cmdSource.id, displayName: cmdSource.title }
				: { type: 'builtin' };

			result.push({
				id,
				description,
				args: meta?.args?.map(a => ({
					name: a.name,
					description: a.description,
					isOptional: a.isOptional,
				})),
				returns: meta?.returns,
				source,
			});
		}

		return result;
	}
}
