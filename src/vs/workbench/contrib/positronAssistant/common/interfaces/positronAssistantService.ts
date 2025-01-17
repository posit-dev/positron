/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ChatAgentLocation } from '../../../chat/common/chatAgents.js';

// Create the decorator for the Positron assistant service (used in dependency injection).
export const IPositronAssistantService = createDecorator<IPositronAssistantService>('positronAssistantService');

//#region Chat Participants

export interface IChatRequestData {
	location: ChatAgentLocation;
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

//#endregion
//#region Model Configuration

export type PositronLanguageModelType = 'chat' | 'completion';

export type PositronLanguageModelOptions = 'apiKey' | 'baseUrl';

export interface IPositronLanguageModelSource {
	type: PositronLanguageModelType;
	provider: {
		id: string;
		displayName: string;
	};
	supportedOptions: PositronLanguageModelOptions[];
	defaults: {
		name: string;
		model: string;
		baseUrl?: string;
		apiKey?: string;
	};
}

export interface IPositronLanguageModelConfig {
	provider: string;
	type: string;
	name: string;
	model: string;
	baseUrl?: string;
	apiKey?: string;
}

//#endregion
//#region Assistant Service

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
	getPositronChatContext(request: IChatRequestData): IPositronChatContext;

	/**
	 * Get the currently visible plot as a URI.
	 */
	getCurrentPlotUri(): string | undefined;

	/**
	 * Show the language model configuration modal.
	 */
	showLanguageModelModalDialog(sources: IPositronLanguageModelSource[]): Promise<IPositronLanguageModelConfig | undefined>;

	/**
	 * Placeholder that gets called to "initialize" the PositronAssistantService.
	 */
	initialize(): void;
}

//#endregion
