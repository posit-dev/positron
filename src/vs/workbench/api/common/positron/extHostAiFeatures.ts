/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type * as positron from 'positron';

import { ChatRequestEditorData, Disposable } from '../extHostTypes.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import * as typeConvert from '../extHostTypeConverters.js';
import { ExtHostCommands } from '../extHostCommands.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { isToolInvocationContext, IToolInvocationContext } from '../../../contrib/chat/common/tools/languageModelToolsService.js';
import { IChatRequestData, IChatRequestReferenceSession, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ChatAgentLocation, ChatModeKind } from '../../../contrib/chat/common/constants.js';
import { IPositronChatProvider } from '../../../contrib/chat/common/languageModels.js';
import { IExtHostWorkspace } from '../extHostWorkspace.js';
import { getEnabledTools as filterEnabledTools } from './positronToolFilter.js';

export class ExtHostAiFeatures implements extHostProtocol.ExtHostAiFeaturesShape {

	private readonly _proxy: extHostProtocol.MainThreadAiFeaturesShape;
	private readonly _disposables: DisposableStore = new DisposableStore();
	private readonly _providerActionCallbacks = new Map<string, (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Thenable<void>>();
	private readonly _dialogSessions = new Map<string, { resolve: () => void }>();
	private readonly _onDidChangeProviderConfigEmitter = this._disposables.add(new Emitter<IPositronLanguageModelSource>());

	readonly onDidChangeProviderConfig = this._onDidChangeProviderConfigEmitter.event;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _commands: ExtHostCommands,
		private readonly _extHostWorkspace: IExtHostWorkspace,
	) {
		// Trigger creation of proxy to main thread
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadAiFeatures);
	}

	/**
	 * Filters a chat request's tools down to those Positron considers enabled.
	 * Runs synchronously in the extension host; used by chat clients such as
	 * Copilot Chat.
	 */
	getEnabledTools(request: vscode.ChatRequest, tools: readonly vscode.LanguageModelToolInformation[]): string[] {
		const isWorkspaceOpen = (this._extHostWorkspace.getWorkspaceFolders()?.length ?? 0) > 0;
		return filterEnabledTools(request, tools, isWorkspaceOpen);
	}

	async registerChatAgent(extension: IExtensionDescription, agentData: positron.ai.ChatAgentData): Promise<Disposable> {
		await this._proxy.$registerChatAgent({
			...agentData,
			modes: agentData.modes as unknown as ChatModeKind[],
			extensionId: extension.identifier,
			extensionVersion: extension.version,
			extensionPublisherId: extension.publisher,
			extensionDisplayName: extension.displayName ?? extension.publisher,
			locations: agentData.locations.map((v) => ChatAgentLocation.fromRaw(v)),
		});

		return new Disposable(() => {
			this._proxy.$unregisterChatAgent(agentData.id);
		});
	}

	registerProvider(extension: IExtensionDescription, source: IPositronLanguageModelSource, onAction?: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Thenable<void>): Disposable {
		if (onAction) {
			this._providerActionCallbacks.set(source.provider.id, onAction);
		}
		this._proxy.$registerProvider(source);

		return new Disposable(() => {
			this._providerActionCallbacks.delete(source.provider.id);
			this._proxy.$unregisterProvider(source.provider.id);
		});
	}

	updateProvider(id: string, update: Partial<IPositronLanguageModelSource>): void {
		this._proxy.$updateProvider(id, update);
	}

	async getRegisteredProviders(): Promise<IPositronLanguageModelSource[]> {
		return this._proxy.$getRegisteredProviders();
	}

	$onDidChangeProviderConfig(source: IPositronLanguageModelSource): void {
		this._onDidChangeProviderConfigEmitter.fire(source);
	}

	async showLanguageModelConfig(options?: positron.ai.ShowLanguageModelConfigOptions): Promise<void> {
		const id = generateUuid();

		return new Promise<void>((resolve, reject) => {
			this._dialogSessions.set(id, { resolve });
			Promise.resolve(this._proxy.$languageModelConfig(id, options)).catch((err: unknown) => {
				this._dialogSessions.delete(id);
				reject(err);
			});
		});
	}

	async getCurrentPlotUri(): Promise<string | undefined> {
		return this._proxy.$getCurrentPlotUri();
	}

	async getPositronChatContext(request: vscode.ChatRequest): Promise<IPositronChatContext> {
		const agentRequest: IChatRequestData = {
			location: typeConvert.ChatLocation.from(request.location),
		};
		return this._proxy.$getPositronChatContext(agentRequest);
	}

	async generateAssistantPrompt(request: vscode.ChatRequest): Promise<string> {
		// Extract only the serializable parts of the live request that the
		// prompt needs, then let the main thread assemble and render it.
		const selectionIsEmpty = request.location2 instanceof ChatRequestEditorData
			? request.location2.selection?.isEmpty
			: undefined;

		const referenceSessions: IChatRequestReferenceSession[] = [];
		for (const reference of request.references ?? []) {
			const value = reference.value as { activeSession?: unknown; variables?: unknown };
			if (value.activeSession) {
				referenceSessions.push({ activeSession: value.activeSession, variables: value.variables });
			}
		}

		return this._proxy.$generateAssistantPrompt({
			location: typeConvert.ChatLocation.from(request.location),
			selectionIsEmpty,
			referenceSessions,
		});
	}

	responseProgress(context: IToolInvocationContext, part: vscode.ChatResponsePart | vscode.ChatResponseTextEditPart | vscode.ChatResponseConfirmationPart): void {
		if (!isToolInvocationContext(context)) {
			throw new Error('Invalid tool invocation token');
		}

		const dto = typeConvert.ChatResponsePart.from(part, this._commands.converter, this._disposables);
		this._proxy.$responseProgress(context.sessionResource, dto);
	}

	async $responseProviderAction(source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string): Promise<void> {
		const onAction = this._providerActionCallbacks.get(source.provider.id);
		if (!onAction) {
			return;
		}
		return onAction(source, config, action);
	}

	$onCompleteLanguageModelConfig(id: string): void {
		const session = this._dialogSessions.get(id);
		if (session) {
			session.resolve();
			this._dialogSessions.delete(id);
		}
	}

	async getChatExport(): Promise<object | undefined> {
		return this._proxy.$getChatExport();
	}

	async areCompletionsEnabled(file: vscode.Uri): Promise<boolean> {
		return this._proxy.$areCompletionsEnabled(file);
	}

	async getCurrentProvider(): Promise<IPositronChatProvider | undefined> {
		return this._proxy.$getCurrentProvider();
	}

	async getCurrentChatMode(): Promise<string | undefined> {
		return this._proxy.$getCurrentChatMode();
	}

	async getProviders(): Promise<IPositronChatProvider[]> {
		return this._proxy.$getProviders();
	}

	async setCurrentProvider(id: string): Promise<IPositronChatProvider | undefined> {
		return this._proxy.$setCurrentProvider(id);
	}

	async getEnabledProviders(): Promise<string[]> {
		return this._proxy.$getEnabledProviders();
	}

}
