/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { URI } from '../../../../../base/common/uri.js';
import { IExportableChatData } from '../../../chat/common/chatModel.js';

// Create the decorator for the Positron assistant service (used in dependency injection).
export const IPositronAssistantConfigurationService = createDecorator<IPositronAssistantConfigurationService>('positronAssistantConfigurationService');
export const IPositronAssistantService = createDecorator<IPositronAssistantService>('positronAssistantService');

//#region Chat Participants

export interface IChatRequestData {
	location: ChatAgentLocation;
}

export interface IPositronChatContext {
	plots?: {
		hasPlots: boolean;
	};
	positronVersion?: string;
	currentDate: string;
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

/**
 * Metadata about a language model provider used for configuration.
 * Registered during extension activation, independent of sign-in state.
 */
export interface IPositronProviderMetadata {
	/** Provider ID (e.g., 'anthropic-api', 'copilot') */
	id: string;
	/** Display name shown in UI (e.g., 'Anthropic', 'GitHub Copilot') */
	displayName: string;
	/** Setting name used in positron.assistant.provider.<settingName>.enable */
	settingName: string;
}

// Equivalent in positron.d.ts API: LanguageModelSource
export interface IPositronLanguageModelSource {
	type: PositronLanguageModelType;
	provider: IPositronProviderMetadata;
	supportedOptions: PositronLanguageModelOptions[];
	defaults: Omit<IPositronLanguageModelConfig, 'provider' | 'type'>;
	signedIn?: boolean;
	authMethods?: string[];
}

// Equivalent in positron.d.ts API: LanguageModelAutoconfigureType
export enum LanguageModelAutoconfigureType {
	EnvVariable = 0,
	Custom = 1
}

// Equivalent in positron.d.ts API: LanguageModelAutoconfigure
export type IPositronLanguageModelAutoconfigure = (
	{
		type: LanguageModelAutoconfigureType.EnvVariable;
		key: string;
		signedIn: boolean;
	} |
	{
		type: LanguageModelAutoconfigureType.Custom;
		message: string;
		signedIn: boolean;
	}
);

// Equivalent in positron.d.ts API: LanguageModelConfig
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
	maxInputTokens?: number;
	maxOutputTokens?: number;
	completions?: boolean;
	autoconfigure?: IPositronLanguageModelAutoconfigure;
}

//#endregion
//#region Configuration Service

/**
 * IPositronAssistantConfigurationService interface.
 */
export interface IPositronAssistantConfigurationService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Flag indicating whether GitHub Copilot is enabled (via disabled extension, or lack of authentication).
	 */
	readonly copilotEnabled: boolean;

	/**
	 * Event that fires when the Copilot enabled flag changes.
	 */
	readonly onChangeCopilotEnabled: Event<boolean>;

	/**
	 * Event that fires when enabled providers configuration changes.
	 * Fires when either individual provider enable settings or the deprecated enabledProviders array changes.
	 */
	readonly onChangeEnabledProviders: Event<void>;

	/**
	 * Registers provider metadata with the configuration service.
	 * This allows the service to check provider enable settings without requiring sign-in.
	 * Should be called during extension activation for all available providers.
	 *
	 * @param metadata Provider identification and settings information
	 */
	registerProviderMetadata(metadata: IPositronProviderMetadata): void;

	/**
	 * Gets the list of enabled provider IDs from configuration.
	 *
	 * Reads from individual provider enable settings (positron.assistant.provider.<settingName>.enable)
	 * and the deprecated 'positron.assistant.enabledProviders' array setting.
	 *
	 * @returns Array of enabled provider IDs
	 */
	getEnabledProviders(): string[];

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
		onClose: () => void,
	): void;

	/**
	 * Get the chat export as a JSON object (IExportableChatData).
	 */
	getChatExport(): IExportableChatData | undefined;

	/**
	 * Add a language model configuration.
	 */
	addLanguageModelConfig(source: IPositronLanguageModelSource): void;

	/**
	 * Remove a language model configuration.
	 */
	removeLanguageModelConfig(source: IPositronLanguageModelSource): void;

	/**
	 * Checks if completions are enabled for the given file.
	 * @param uri The file URI to check if completions are enabled.
	 * @returns true if completions should be enabled for the file, false otherwise.
	 */
	areCompletionsEnabled(uri: URI): boolean;

	/**
	 * Placeholder that gets called to "initialize" the PositronAssistantService.
	 */
	initialize(): void;
}

//#endregion
