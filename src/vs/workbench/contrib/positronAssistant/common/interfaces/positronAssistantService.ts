/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { Variable } from '../../../../services/languageRuntime/common/positronVariablesComm.js';
import { UriComponents } from '../../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

// Create the decorator for the Positron assistant service (used in dependency injection).
export const IPositronAssistantService = createDecorator<IPositronAssistantService>('positronAssistantService');

//#region Chat Participants

export interface IChatRequestData {
	location: ChatAgentLocation;
}

export interface IPositronChatContext {
	activeSession?: {
		identifier: string;
		language: string;
		version: string;
		mode: LanguageRuntimeSessionMode;
		notebookUri?: UriComponents;
		executions: {
			input: string;
			output: string;
			error?: any;
		}[];
	};
	plots?: {
		hasPlots: boolean;
	};
	variables: Variable[];
	shell?: string;
}

//#endregion
//#region Model Configuration

export enum PositronLanguageModelType {
	Chat = 'chat',
	Completion = 'completion',
}

export type PositronLanguageModelOptions = Exclude<{
	[K in keyof IPositronLanguageModelConfig]: undefined extends IPositronLanguageModelConfig[K] ? K : never
}[keyof IPositronLanguageModelConfig], undefined>;

export interface IPositronLanguageModelSource {
	type: PositronLanguageModelType;
	provider: { id: string; displayName: string };
	supportedOptions: PositronLanguageModelOptions[];
	defaults: Omit<IPositronLanguageModelConfig, 'provider' | 'type'>;
	signedIn?: boolean;
	authMethods?: string[];
}

export interface IPositronLanguageModelConfig {
	type: PositronLanguageModelType;
	provider: string;
	name: string;
	model: string;
	baseUrl?: string;
	apiKey?: string;
	oauth?: boolean;
	toolCalls?: boolean;
	resourceName?: string;
	project?: string;
	location?: string;
	numCtx?: number;
	maxOutputTokens?: number;
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
	 * Event that fires when a language model configuration is added or deleted.
	 */
	readonly onChangeLanguageModelConfig: Event<IPositronLanguageModelSource>;

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
	showLanguageModelModalDialog(
		sources: IPositronLanguageModelSource[],
		onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>,
		onCancel: () => void,
		onClose: () => void,
	): void;

	/**
	 * Get the supported providers for Positron Assistant.
	 */
	getSupportedProviders(): string[];

	/**
	 * Add a language model configuration.
	 */
	addLanguageModelConfig(source: IPositronLanguageModelSource): void;

	/**
	 * Remove a language model configuration.
	 */
	removeLanguageModelConfig(source: IPositronLanguageModelSource): void;

	/**
	 * Placeholder that gets called to "initialize" the PositronAssistantService.
	 */
	initialize(): void;
}

//#endregion
