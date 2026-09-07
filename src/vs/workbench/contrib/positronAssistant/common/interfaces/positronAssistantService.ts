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
 * Why a field cannot be set in the configuration form, and what value applies
 * instead. Today this is always an environment variable, which ai-config ranks
 * above the user's configuration file.
 *
 * Deliberately not part of {@link IPositronLanguageModelConfig}: that type is
 * bidirectional (it arrives as `defaults` and is submitted back on save), and
 * this is an inbound-only fact about the environment the UI does not own.
 */
export interface IPositronLanguageModelFieldOverride {
	/** The value in effect, shown in place of the user's saved value. */
	readonly value: string;
	/**
	 * Name of the environment variable supplying the value, e.g. `AWS_REGION`,
	 * so the form can say what to change instead. Omit when there is no single
	 * name to give.
	 */
	readonly name?: string;
}

/**
 * Which of a provider's form fields are supplied by a higher-precedence layer,
 * shaped to mirror {@link IPositronLanguageModelConfig} with each value
 * replaced by the reason it cannot be set.
 *
 * Only the fields that something can actually take over appear -- a mechanical
 * mirror of the whole config would advertise override slots for `model`,
 * `toolCalls` and the rest, which nothing supplies.
 *
 * Mirroring the *form's* config type rather than the on-disk one is deliberate:
 * Databricks and Snowflake carry their value through the base URL input while
 * persisting elsewhere, so an override for either belongs on `baseUrl` -- the
 * input the user is actually looking at.
 */
export interface IPositronLanguageModelFieldOverrides {
	baseUrl?: IPositronLanguageModelFieldOverride;
	apiKey?: IPositronLanguageModelFieldOverride;
	aws?: {
		profile?: IPositronLanguageModelFieldOverride;
		region?: IPositronLanguageModelFieldOverride;
	};
}

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
	 * Provider id in the resolved provider catalog (`~/.posit/ai/providers.json`),
	 * used to resolve enablement and connection config. When undefined, `id` is
	 * used instead, so a provider is still subject to the catalog if the catalog
	 * knows that id. Providers the catalog has never heard of are enabled.
	 */
	catalogId?: string;
	/**
	 * Maturity status of the provider. Drives how it's presented in the
	 * configuration modal: stable providers (no status) are listed first, then
	 * 'preview', then 'experimental'.
	 */
	status?: 'preview' | 'experimental';
	/**
	 * For a provider from a `providers.custom` entry, its type (client kind, e.g.
	 * 'anthropic'); undefined for a built-in. The modal shows the entry under
	 * that vendor's icon and marks the row as custom.
	 */
	customKind?: string;
	/**
	 * Optional URL for the provider icon (e.g., data:image/svg+xml;base64,...).
	 * It must be an icon with a transparent background (like a codicon): the new
	 * provider modal recolors it to the theme foreground by using it as a CSS
	 * mask, so an opaque image would mask to a solid theme-colored square.
	 */
	logoUrl?: string;
}

// Equivalent in positron.d.ts API: LanguageModelSource
export interface IPositronLanguageModelSource {
	type: PositronLanguageModelType;
	provider: IPositronProviderMetadata;
	supportedOptions: PositronLanguageModelOptions[];
	defaults: IPositronLanguageModelConfig;
	/**
	 * Fields the user cannot set here because a higher-precedence config layer
	 * supplies them. Absent when every supported field is editable.
	 */
	overrides?: IPositronLanguageModelFieldOverrides;
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
		isPositWorkbench?: boolean;
	}
);

/**
 * A user-declared model for a custom provider, mirroring the required fields of
 * ai-config's custom model schema (providers.json `models.custom`). The modal
 * fills the capability flags and context length with OpenAI-compatible defaults,
 * so the user only has to supply the id.
 */
export interface IPositronCustomModel {
	id: string;
	name: string;
	maxContextLength: number;
	supportsTools: boolean;
	supportsImages: boolean;
	supportsToolResultImages: boolean;
	supportsWebSearch: boolean;
}

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
	/**
	 * Wire protocol (API type) the provider speaks, e.g. 'openai-chat' (Chat
	 * Completions) or 'openai-responses' (Responses). Routes custom /
	 * OpenAI-compatible providers to the right API. Omit to let the provider
	 * decide.
	 */
	protocol?: string;
	/**
	 * Explicit model list for a custom provider whose endpoint has no `/models`
	 * listing. Persisted as providers.json `models.custom` (with discovery off).
	 * Create-flow only; not part of the public `positron.d.ts` API.
	 */
	customModels?: IPositronCustomModel[];
	autoconfigure?: IPositronLanguageModelAutoconfigure;
	/**
	 * AWS profile and region for a provider authenticating through the AWS
	 * credential chain. Both optional: an omitted field falls back to the
	 * ambient AWS configuration, and an empty string means the user cleared the
	 * box and any saved value should be removed.
	 */
	aws?: { profile?: string; region?: string };
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
	 * Fires when provider enablement in the catalog (providers.json) changes.
	 */
	readonly onChangeEnabledProviders: Event<void>;

	/**
	 * Check if a specific provider is enabled in Positron's provider configuration.
	 *
	 * @param providerId The catalog provider ID to check (e.g., 'copilot', 'anthropic', 'openai')
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
	 * Get the chat export as a JSON object (IExportableChatData).
	 */
	getChatExport(): IExportableChatData | undefined;

	/**
	 * Checks if Copilot inline completions are enabled for the given file.
	 * Scoped to Copilot: gated on the Copilot catalog provider. Posit AI Next Edit
	 * Suggestions (NES) has its own separate enablement and does not use this.
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
