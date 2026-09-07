/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAgentAllowedCommandsService } from '../../../contrib/positronAiFeatures/common/agentAllowedCommandsService.js';
import { ChatViewId } from '../../../contrib/chat/browser/chat.js';
import { ChatViewPane } from '../../../contrib/chat/browser/widgetHosts/viewPane/chatViewPane.js';
import { IGenerateAssistantPromptRequest, IPositronAssistantService } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ExtHostAiFeaturesShape, ExtHostPositronContext, ISerializedAgentCommand, ISerializedValidateAndExecuteCommandResult, MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ChatModeKind } from '../../../contrib/chat/common/constants.js';
import { PromptRenderer } from '../../../contrib/positronAssistant/browser/prompts/promptRenderer.js';
import { getPositronContextPrompts } from '../../../contrib/positronAssistant/browser/prompts/positronContextPrompts.js';
import { getForegroundSessionInfo } from '../../../contrib/positronAssistant/browser/prompts/promptSessions.js';
import * as xml from '../../../contrib/positronAssistant/common/xml.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _proxy: ExtHostAiFeaturesShape;
	private _promptRenderer: PromptRenderer | undefined;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronAssistantService private readonly _positronAssistantService: IPositronAssistantService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IFileService private readonly _fileService: IFileService,
		@IAgentAllowedCommandsService private readonly _agentAllowedCommandsService: IAgentAllowedCommandsService,
		@IAiProviderService private readonly _aiProviderService: IAiProviderService,
	) {
		super();
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostAiFeatures);

		// Forward per-provider catalog enablement flips to the extension host. The
		// baseline snapshot is captured after initialization so activation-time
		// listeners never see a flip against the empty pre-initialization state.
		let lastEnabled = new Map<string, boolean>();
		const snapshotEnablement = () => new Map(this._aiProviderService.getProviders().map(p => [p.id, p.enabled]));
		this._aiProviderService.whenInitialized.then(() => { lastEnabled = snapshotEnablement(); });
		this._register(this._aiProviderService.onDidChangeProviders(e => {
			if (!e.enabledChanged) {
				return;
			}
			const current = snapshotEnablement();
			for (const [id, enabled] of current) {
				const previous = lastEnabled.get(id);
				if (previous !== undefined && previous !== enabled) {
					this._proxy.$onDidChangeProviderEnablement(id, enabled);
				}
			}
			lastEnabled = current;
		}));
	}

	/**
	 * Respond to a request from the extension host to send the current plot data.
	 */
	async $getCurrentPlotUri(): Promise<string | undefined> {
		return this._positronAssistantService.getCurrentPlotUri();
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
		const mode = this.getCurrentChatMode() ?? ChatModeKind.Agent;

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
	/** The chat mode currently selected in the Chat panel. */
	private getCurrentChatMode(): string | undefined {
		const chatPanel = this._viewsService.getActiveViewWithId<ChatViewPane>(ChatViewId);
		return chatPanel?.widget.input.currentModeKind;
	}

	/**
	 * Check whether a provider (identified by its catalog id) is enabled in the
	 * resolved provider catalog.
	 */
	async $isProviderEnabled(id: string): Promise<boolean> {
		// Activation-time callers must not observe the pre-initialization
		// snapshot.
		await this._aiProviderService.whenInitialized;
		return this._aiProviderService.isEnabled(id);
	}

	/**
	 * Return the curated set of Positron commands available to AI agents.
	 */
	async $getAgentAllowedCommands(options?: { includeDisabled?: boolean }): Promise<ISerializedAgentCommand[]> {
		return this._agentAllowedCommandsService.getAgentAllowedCommands({ enabledOnly: !options?.includeDisabled }).map(cmd => ({
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
}
