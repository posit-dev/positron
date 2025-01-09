/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ChatAgentLocation, IChatAgentMetadata, IChatAgentRequest } from '../../../chat/common/chatAgents.js';
import { IChatProgress } from '../../../chat/common/chatService.js';

// Create the decorator for the Positron assistant service (used in dependency injection).
export const IPositronAssistantService = createDecorator<IPositronAssistantService>('positronAssistantService');

export interface IPositronChatTask {
	progress: (content: IChatProgress) => void;
}

export interface IPositronChatContext {
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
}

export interface IPositronChatParticipant {
	name: string;
	fullName?: string;
	id: string;
	isDefault: boolean;
	locations: ChatAgentLocation[];
	metadata: IChatAgentMetadata;
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
	 * Build positron specific context object to be attached to chat requests.
	 */
	buildChatContext(request: IChatAgentRequest): IPositronChatContext;

	/**
	 * Get the currently visible plot as a URI.
	 */
	getCurrentPlotUri(): string | undefined;

	/**
	 * Placeholder that gets called to "initialize" the PositronAssistantService.
	 */
	initialize(): void;

}
