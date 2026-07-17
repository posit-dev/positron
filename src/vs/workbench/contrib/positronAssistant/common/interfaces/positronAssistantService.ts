/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { URI } from '../../../../../base/common/uri.js';
import { IExportableChatData } from '../../../chat/common/model/chatModel.js';

// Create the decorator for the Positron assistant service (used in dependency injection).
export const IPositronAssistantConfigurationService = createDecorator<IPositronAssistantConfigurationService>('positronAssistantConfigurationService');
export const IPositronAssistantService = createDecorator<IPositronAssistantService>('positronAssistantService');

//#region Chat Participants

export interface IChatRequestData {
	location: ChatAgentLocation;
}

/**
 * An active-session reference attached to a chat request. The values are the
 * opaque session/variables payloads the chat client attaches; they are
 * serialized verbatim into the prompt.
 */
export interface IChatRequestReferenceSession {
	activeSession: unknown;
	variables?: unknown;
}

/**
 * The serializable subset of a chat request needed to generate the Positron
 * assistant prompt. Extracted in the extension host from the live request.
 */
export interface IGenerateAssistantPromptRequest extends IChatRequestData {
	/**
	 * Whether the editor selection is empty. Undefined when the request does not
	 * originate from an editor.
	 */
	selectionIsEmpty?: boolean;
	/** Active-session references attached to the request. */
	referenceSessions: IChatRequestReferenceSession[];
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
	/** Provider ID (e.g., 'anthropic-api', 'copilot-auth') */
	id: string;
	/** Display name shown in UI (e.g., 'Anthropic', 'GitHub Copilot') */
	displayName: string;
	/**
	 * Setting name used in the per-provider enable key. Either
	 * `assistant.provider.<settingName>.enabled` (for providers owned by
	 * the authentication extension) or
	 * `positron.assistant.provider.<settingName>.enable` (the legacy
	 * form, still used by providers declared in
	 * `extensions/positron-assistant/package.json`) toggles the provider.
	 */
	settingName: string;
	/**
	 * Maturity status of the provider. Drives how it's presented in the
	 * configuration modal: stable providers (no status) are listed first, then
	 * 'preview', then 'experimental'.
	 */
	status?: 'preview' | 'experimental';
	/** Optional data URL for the provider icon (e.g., data:image/svg+xml;base64,...) */
	logoUrl?: string;
}

// Equivalent in positron.d.ts API: LanguageModelSource
export interface IPositronLanguageModelSource {
	type: PositronLanguageModelType;
	provider: IPositronProviderMetadata;
	supportedOptions: PositronLanguageModelOptions[];
	defaults: IPositronLanguageModelConfig;
	signedIn?: boolean;
	authMethods?: string[];
	status?: 'ok' | 'error' | null;
	statusMessage?: string;
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
	model?: string;
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

// Equivalent in positron.d.ts API: ShowLanguageModelConfigOptions
export interface IShowLanguageModelConfigOptions {
	/**
	 * Optional provider ID to pre-select in the dialog.
	 * If provided and valid, the modal will open with this provider selected.
	 */
	preselectedProviderId?: string;
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
	 * Registers a language model provider with the configuration service.
	 * Call once per provider during extension activation with all static config.
	 * Creates a positron.assistant.provider.<settingName>.enable toggle in Settings.
	 *
	 * @param source Provider source definition
	 */
	registerProvider(source: IPositronLanguageModelSource): void;

	/**
	 * Unregisters a provider, removing its registration and dynamic state.
	 * Fires onChangeProviderConfig so open dialogs update immediately.
	 *
	 * @param id Provider ID to unregister
	 */
	unregisterProvider(id: string): void;

	/**
	 * Updates dynamic state for a previously registered provider.
	 * Fires onChangeProviderConfig so listeners react immediately.
	 *
	 * @param id Provider ID (must match a previously registered provider)
	 * @param update Partial state to deep-merge
	 */
	updateProvider(id: string, update: Partial<IPositronLanguageModelSource>): void;

	/**
	 * Returns sources for all registered, enabled providers.
	 */
	getRegisteredSources(): IPositronLanguageModelSource[];

	/**
	 * Event that fires when a provider's configuration changes via
	 * registerProvider, unregisterProvider, or updateProvider.
	 */
	readonly onChangeProviderConfig: Event<IPositronLanguageModelSource>;

	/**
	 * Gets the list of enabled provider IDs from configuration.
	 *
	 * Should only be used after the Positron Assistant extension has finished activation,
	 * as enabled providers are registered as part of the extension activation flow.
	 *
	 * Reads from per-provider enable settings: either
	 * `assistant.provider.<settingName>.enabled` or
	 * `positron.assistant.provider.<settingName>.enable` toggles the
	 * provider on.
	 *
	 * @returns Array of enabled provider IDs
	 */
	getEnabledProviders(): string[];

	/**
	 * Check if a specific provider is enabled in Positron's provider configuration.
	 *
	 * @param providerId The provider ID to check (e.g., 'copilot', 'anthropic-api', 'openai-api')
	 * @returns true if the provider is enabled, false otherwise
	 */
	isProviderEnabled(providerId: string): boolean;

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
	 * Sources are read from the configuration service's internal state.
	 */
	showLanguageModelModalDialog(
		onAction: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>,
		onClose: () => void,
		options?: IShowLanguageModelConfigOptions,
	): void;

	/**
	 * Get the chat export as a JSON object (IExportableChatData).
	 */
	getChatExport(): IExportableChatData | undefined;

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
