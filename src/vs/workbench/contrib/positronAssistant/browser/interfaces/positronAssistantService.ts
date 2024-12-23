/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IChatAgentHistoryEntry, IChatAgentRequest, IChatAgentResult } from '../../../chat/common/chatAgents.js';
import { IChatProgress } from '../../../chat/common/chatService.js';

// Create the decorator for the Positron assistant service (used in dependency injection).
export const IPositronAssistantService = createDecorator<IPositronAssistantService>('positronAssistantService');

export interface IPositronAssistantProvider {
	name: string;
	provideChatResponse(request: IPositronAssistantChatRequest,
		handler: (content: IChatProgress) => void, token: CancellationToken): Promise<void>;
}

export interface IPositronAssistantChatTask {
	handler: (content: IChatProgress) => void;
}

export interface IPositronAssistantChatMessage {
	role: 'user' | 'system' | 'assistant';
	content: string;
}

export interface IPositronAssistantChatRequest extends IChatAgentRequest {
	history: IPositronAssistantChatMessage[];
	context?: IPositronAssistantContext;
}

// TODO: Separate this into separate context contexts: Sidebar pane, terminal, editor, notebook
export interface IPositronAssistantContext {
	value: {
		console?: {
			language: string;
			version: string;
		};
		variables?: {
			name: string;
			value: string;
			type: string;
		}[];
		shell?: string;
		selection?: string;
	};
	additional: {
		plotUri?: string;
	};
}

/**
 * IPositronAssistantService interface.
 */
export interface IPositronAssistantService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Notifies subscribers when a new assistant has been registered.
	 */
	readonly onDidRegisterAssistant: Event<string>;

	/**
	 * Provider functions for assistants registered with the assistant service.
	 */
	readonly registeredProviders: Map<string, IPositronAssistantProvider>;

	/**
	 * Register a new assistant.
	 */
	registerAssistant(id: string, provider: IPositronAssistantProvider): IDisposable;

	/**
	 * Provide a chat response.
	 */
	provideResponse(request: IChatAgentRequest, progress: (part: IChatProgress) => void,
		history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult>;

	/**
	 * Placeholder that gets called to "initialize" the PositronAssistantService.
	 */
	initialize(): void;

}
