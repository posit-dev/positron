/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isFalsyOrWhitespace } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IExtensionService, isProposedApiEnabled } from '../../../services/extensions/common/extensions.js';
import { ExtensionsRegistry } from '../../../services/extensions/common/extensionsRegistry.js';
import { ChatContextKeys } from './chatContextKeys.js';

// --- Start Positron ---
import { match } from '../../../../base/common/glob.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
// --- End Positron ---

export const enum ChatMessageRole {
	System,
	User,
	Assistant,
}

export enum ToolResultAudience {
	Assistant = 0,
	User = 1,
}

export interface IChatMessageTextPart {
	type: 'text';
	value: string;
	audience?: ToolResultAudience[];
}

export interface IChatMessageImagePart {
	type: 'image_url';
	value: IChatImageURLPart;
}

export interface IChatMessageDataPart {
	type: 'data';
	mimeType: string;
	data: VSBuffer;
	audience?: ToolResultAudience[];
}

export interface IChatImageURLPart {
	/**
	 * The image's MIME type (e.g., "image/png", "image/jpeg").
	 */
	mimeType: ChatImageMimeType;

	/**
	 * The raw binary data of the image, encoded as a Uint8Array. Note: do not use base64 encoding. Maximum image size is 5MB.
	 */
	data: VSBuffer;
}

/**
 * Enum for supported image MIME types.
 */
export enum ChatImageMimeType {
	PNG = 'image/png',
	JPEG = 'image/jpeg',
	GIF = 'image/gif',
	WEBP = 'image/webp',
	BMP = 'image/bmp',
}

/**
 * Specifies the detail level of the image.
 */
export enum ImageDetailLevel {
	Low = 'low',
	High = 'high'
}


export interface IChatMessageToolResultPart {
	type: 'tool_result';
	toolCallId: string;
	value: (IChatResponseTextPart | IChatResponsePromptTsxPart | IChatResponseDataPart)[];
	isError?: boolean;
}

export type IChatMessagePart = IChatMessageTextPart | IChatMessageToolResultPart | IChatResponseToolUsePart | IChatMessageImagePart | IChatMessageDataPart;

export interface IChatMessage {
	readonly name?: string | undefined;
	readonly role: ChatMessageRole;
	readonly content: IChatMessagePart[];
}

export interface IChatResponseTextPart {
	type: 'text';
	value: string;
	audience?: ToolResultAudience[];
}

export interface IChatResponsePromptTsxPart {
	type: 'prompt_tsx';
	value: unknown;
}

export interface IChatResponseDataPart {
	type: 'data';
	value: IChatImageURLPart;
	audience?: ToolResultAudience[];
}

export interface IChatResponseToolUsePart {
	type: 'tool_use';
	name: string;
	toolCallId: string;
	parameters: any;
}

export interface IChatResponsePullRequestPart {
	type: 'pullRequest';
	uri: URI;
	title: string;
	description: string;
	author: string;
	linkTag: string;
}

export type IExtendedChatResponsePart = IChatResponsePullRequestPart;

export type IChatResponsePart = IChatResponseTextPart | IChatResponseToolUsePart | IChatResponseDataPart;

export interface IChatResponseFragment {
	index: number;
	part: IChatResponsePart;
}

// --- Start Positron ---
export interface IPositronChatProvider {
	readonly id: string;
	readonly displayName: string;
}

// re-added in 1.103.0 merge and modified for Positron
export interface ILanguageModelsChangeEvent {
	added?: string[];
	removed?: string[];
}
// --- End Positron ---

export interface ILanguageModelChatMetadata {
	readonly extension: ExtensionIdentifier;

	readonly name: string;
	readonly id: string;
	readonly vendor: string;
	readonly version: string;
	readonly description?: string;
	readonly cost?: string;
	readonly family: string;
	// --- Start Positron ---
	readonly providerName?: string;
	// --- End Positron ---
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;

	readonly isDefault?: boolean;
	readonly isUserSelectable?: boolean;
	readonly modelPickerCategory: { label: string; order: number } | undefined;
	readonly auth?: {
		readonly providerLabel: string;
		readonly accountLabel?: string;
	};
	readonly capabilities?: {
		readonly vision?: boolean;
		readonly toolCalling?: boolean;
		readonly agentMode?: boolean;
	};
}

export namespace ILanguageModelChatMetadata {
	export function suitableForAgentMode(metadata: ILanguageModelChatMetadata): boolean {
		const supportsToolsAgent = typeof metadata.capabilities?.agentMode === 'undefined' || metadata.capabilities.agentMode;
		return supportsToolsAgent && !!metadata.capabilities?.toolCalling;
	}

	export function asQualifiedName(metadata: ILanguageModelChatMetadata): string {
		if (metadata.modelPickerCategory === undefined) {
			// in the others category
			return `${metadata.name} (${metadata.family})`;
		}
		return metadata.name;
	}
}

export interface ILanguageModelChatResponse {
	stream: AsyncIterable<IChatResponseFragment | IChatResponseFragment[]>;
	result: Promise<any>;
}

export interface ILanguageModelChatProvider {
	onDidChange: Event<void>;
	prepareLanguageModelChat(options: { silent: boolean }, token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]>;
	sendChatRequest(modelId: string, messages: IChatMessage[], from: ExtensionIdentifier, options: { [name: string]: any }, token: CancellationToken): Promise<ILanguageModelChatResponse>;
	provideTokenCount(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
}

export interface ILanguageModelChat {
	metadata: ILanguageModelChatMetadata;
	sendChatRequest(messages: IChatMessage[], from: ExtensionIdentifier, options: { [name: string]: any }, token: CancellationToken): Promise<ILanguageModelChatResponse>;
	provideTokenCount(message: string | IChatMessage, token: CancellationToken): Promise<number>;
}

export interface ILanguageModelChatSelector {
	readonly name?: string;
	readonly id?: string;
	readonly vendor?: string;
	readonly version?: string;
	readonly family?: string;
	readonly tokens?: number;
	readonly extension?: ExtensionIdentifier;
}

export const ILanguageModelsService = createDecorator<ILanguageModelsService>('ILanguageModelsService');

export interface ILanguageModelChatMetadataAndIdentifier {
	metadata: ILanguageModelChatMetadata;
	identifier: string;
}

export interface ILanguageModelsService {

	readonly _serviceBrand: undefined;

	// --- Start Positron ---
	/** The current language model provider. */
	get currentProvider(): IPositronChatProvider | undefined;

	/** Set the current language model provider. */
	set currentProvider(provider: IPositronChatProvider | undefined);

	/** Fires when the current language model provider is changed. */
	onDidChangeCurrentProvider: Event<string | undefined>;

	/** Fires when the registered providers change */
	onDidChangeProviders: Event<ILanguageModelsChangeEvent>;

	/** Get the language model IDs for the current provider. */
	getLanguageModelIdsForCurrentProvider(): string[];

	/** List the available language model providers. */
	getLanguageModelProviders(): IPositronChatProvider[];

	/** Get the extension identifier for a provider vendor. */
	getExtensionIdentifierForProvider(vendor: string): ExtensionIdentifier | undefined;
	// --- End Positron ---

	// TODO @lramos15 - Make this a richer event in the future. Right now it just indicates some change happened, but not what
	onDidChangeLanguageModels: Event<void>;

	updateModelPickerPreference(modelIdentifier: string, showInModelPicker: boolean): void;

	getLanguageModelIds(): string[];

	getVendors(): IUserFriendlyLanguageModel[];

	lookupLanguageModel(modelId: string): ILanguageModelChatMetadata | undefined;

	/**
	 * Given a selector, returns a list of model identifiers
	 * @param selector The selector to lookup for language models. If the selector is empty, all language models are returned.
	 * @param allowPromptingUser If true the user may be prompted for things like API keys for us to select the model.
	 */
	selectLanguageModels(selector: ILanguageModelChatSelector, allowPromptingUser?: boolean): Promise<string[]>;

	// --- Start Positron ---
	// Add extensionId parameter
	registerLanguageModelProvider(vendor: string, extensionId: ExtensionIdentifier, provider: ILanguageModelChatProvider): IDisposable;
	// --- End Positron ---

	sendChatRequest(modelId: string, from: ExtensionIdentifier, messages: IChatMessage[], options: { [name: string]: any }, token: CancellationToken): Promise<ILanguageModelChatResponse>;

	computeTokenLength(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
}

const languageModelType: IJSONSchema = {
	type: 'object',
	properties: {
		vendor: {
			type: 'string',
			description: localize('vscode.extension.contributes.languageModels.vendor', "A globally unique vendor of language models.")
		},
		displayName: {
			type: 'string',
			description: localize('vscode.extension.contributes.languageModels.displayName', "The display name of the language model vendor.")
		},
		managementCommand: {
			type: 'string',
			description: localize('vscode.extension.contributes.languageModels.managementCommand', "A command to manage the language model vendor, e.g. 'Manage Copilot models'. This is used in the chat model picker. If not provided, a gear icon is not rendered during vendor selection.")
		}
	}
};

export interface IUserFriendlyLanguageModel {
	vendor: string;
	displayName: string;
	managementCommand?: string;
}

export const languageModelExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IUserFriendlyLanguageModel | IUserFriendlyLanguageModel[]>({
	extensionPoint: 'languageModels',
	jsonSchema: {
		description: localize('vscode.extension.contributes.languageModels', "Contribute language models of a specific vendor."),
		oneOf: [
			languageModelType,
			{
				type: 'array',
				items: languageModelType
			}
		]
	},
	activationEventsGenerator: (contribs: IUserFriendlyLanguageModel[], result: { push(item: string): void }) => {
		for (const contrib of contribs) {
			result.push(`onLanguageModelChat:${contrib.vendor}`);
		}
	}
});

export class LanguageModelsService implements ILanguageModelsService {

	readonly _serviceBrand: undefined;

	private readonly _store = new DisposableStore();

	// --- Start Positron ---
	// We connect the onDidChangeLanguageModels event to a new _onDidChangeLanguageModels
	// Emitter that fires _after_ the current language model provider is updated.
	// The order is important since consumers (e.g. ChatInputPart) may query language
	// models for the current provider in an onDidChangeLanguageModels event handler.

	// Add the current provider and corresponding event.
	private _currentProvider?: IPositronChatProvider;
	private readonly _onDidChangeCurrentProvider = this._store.add(new Emitter<string | undefined>());
	readonly onDidChangeCurrentProvider = this._onDidChangeCurrentProvider.event;

	// Track if we're in the initial setup phase to avoid changing provider during chat requests
	private _isInitialSetup = true;

	// Positron re-added this in the 1.103.0 merge
	private readonly _onDidChangeProviders = this._store.add(new Emitter<ILanguageModelsChangeEvent>());
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	// Track provider vendor to extension mapping for chat agent selection
	private readonly _providerExtensions = new Map<string, ExtensionIdentifier>();
	// --- End Positron ---

	private readonly _providers = new Map<string, ILanguageModelChatProvider>();
	private readonly _modelCache = new Map<string, ILanguageModelChatMetadata>();
	private readonly _vendors = new Map<string, IUserFriendlyLanguageModel>();
	private readonly _modelPickerUserPreferences: Record<string, boolean> = {}; // We use a record instead of a map for better serialization when storing

	private readonly _hasUserSelectableModels: IContextKey<boolean>;
	private readonly _onLanguageModelChange = this._store.add(new Emitter<void>());

	readonly onDidChangeLanguageModels: Event<void> = this._onLanguageModelChange.event;

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IContextKeyService _contextKeyService: IContextKeyService,
		// --- Start Positron ---
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		// --- End Positron ---
	) {
		this._hasUserSelectableModels = ChatContextKeys.languageModelsAreUserSelectable.bindTo(_contextKeyService);
		this._modelPickerUserPreferences = this._storageService.getObject<Record<string, boolean>>('chatModelPickerPreferences', StorageScope.PROFILE, this._modelPickerUserPreferences);

		this._store.add(this.onDidChangeLanguageModels(() => {
			this._hasUserSelectableModels.set(this._modelCache.size > 0 && Array.from(this._modelCache.values()).some(model => model.isUserSelectable));

			// --- Start Positron ---
			// Only auto-set provider during initial setup or if the current provider becomes unavailable
			if (!this._currentProvider && this._modelCache.size > 0 && this._isInitialSetup) {
				const availableProviders = this.getLanguageModelProviders();
				if (availableProviders.length > 0) {
					this._currentProvider = availableProviders[0];
					this._onDidChangeCurrentProvider.fire(availableProviders[0].id);
					// Mark the end of initial setup after first provider is set
					this._isInitialSetup = false;
				}
			}
			// --- End Positron ---
		}));

		this._store.add(languageModelExtensionPoint.setHandler((extensions) => {

			this._vendors.clear();

			for (const extension of extensions) {

				if (!isProposedApiEnabled(extension.description, 'chatProvider')) {
					extension.collector.error(localize('vscode.extension.contributes.languageModels.chatProviderRequired', "This contribution point requires the 'chatProvider' proposal."));
					continue;
				}

				// --- Start Positron ---
				// Don't include BYOK model providers from copilot-chat extension
				if (extension.description.id === 'GitHub.copilot-chat' && extension.value && Array.isArray(extension.value)) {
					extension.value = extension.value.filter(v => v.vendor === 'copilot');
				}
				// --- End Positron ---

				for (const item of Iterable.wrap(extension.value)) {
					if (this._vendors.has(item.vendor)) {
						extension.collector.error(localize('vscode.extension.contributes.languageModels.vendorAlreadyRegistered', "The vendor '{0}' is already registered and cannot be registered twice", item.vendor));
						continue;
					}
					if (isFalsyOrWhitespace(item.vendor)) {
						extension.collector.error(localize('vscode.extension.contributes.languageModels.emptyVendor', "The vendor field cannot be empty."));
						continue;
					}
					if (item.vendor.trim() !== item.vendor) {
						extension.collector.error(localize('vscode.extension.contributes.languageModels.whitespaceVendor', "The vendor field cannot start or end with whitespace."));
						continue;
					}
					this._vendors.set(item.vendor, item);
				}
			}
			// --- Start Positron ---
			// Restore provider change events that was removed in 1.103.0
			/*
			for (const [vendor, _] of this._providers) {
				if (!this._vendors.has(vendor)) {
					this._providers.delete(vendor);
				}
			}
			*/
			const removed: string[] = [];
			for (const [vendor, _] of this._providers) {
				if (!this._vendors.has(vendor)) {
					this._providers.delete(vendor);
					removed.push(vendor);
				}
			}
			if (removed.length > 0) {
				this._onDidChangeProviders.fire({ removed });
			}
			// --- End Positron ---
		}));

		// --- Start Positron ---
		this._store.add(this._onDidChangeProviders.event((event) => {
			this._logService.trace('[LM] onDidChangeProviders fired', event);
			const currentProvider = this._currentProvider;

			// Only auto-set provider during initial setup if there's no current provider
			if (!currentProvider && event.added && event.added.length > 0 && this._isInitialSetup) {
				// Set the first available provider as current
				const firstProvider = event.added[0];
				if (firstProvider) {
					// Create a proper provider object by looking up the vendor info
					const vendorInfo = this._vendors.get(firstProvider);
					if (vendorInfo) {
						this._logService.trace('[LM] Auto-setting current provider during initial setup', firstProvider);
						this.currentProvider = {
							id: firstProvider,
							displayName: vendorInfo.displayName
						};
						// Mark the end of initial setup after first provider is set
						this._isInitialSetup = false;
					}
				}
			} else if (currentProvider && event.removed && event.removed.includes(currentProvider.id)) {
				// Only change provider if the current one was actually removed/disposed
				this._logService.trace('[LM] Current provider was removed, switching to next available', currentProvider.id);
				const availableProviders = this.getLanguageModelProviders();
				if (availableProviders.length > 0) {
					this.currentProvider = availableProviders[0];
				} else {
					this.currentProvider = undefined;
				}
			}

			// Fire the public language model changed event
			this._onLanguageModelChange.fire();
		}));

		// Restore the current provider from storage, if it exists.
		const storedCurrentProvider = this._storageService.getObject<IPositronChatProvider>(this.getSelectedProviderStorageKey(), StorageScope.APPLICATION, undefined);
		if (storedCurrentProvider) {
			// Set privately to avoid writing to storage again.
			this._currentProvider = storedCurrentProvider;
			this._onDidChangeCurrentProvider.fire(storedCurrentProvider.id);
			// Mark the end of initial setup since we have a stored provider
			this._isInitialSetup = false;
		}
		// --- End Positron ---
	}

	dispose() {
		this._store.dispose();
		this._providers.clear();
	}

	updateModelPickerPreference(modelIdentifier: string, showInModelPicker: boolean): void {
		const model = this._modelCache.get(modelIdentifier);
		if (!model) {
			this._logService.warn(`[LM] Cannot update model picker preference for unknown model ${modelIdentifier}`);
			return;
		}

		this._modelPickerUserPreferences[modelIdentifier] = showInModelPicker;
		if (showInModelPicker === model.isUserSelectable) {
			delete this._modelPickerUserPreferences[modelIdentifier];
			this._storageService.store('chatModelPickerPreferences', this._modelPickerUserPreferences, StorageScope.PROFILE, StorageTarget.USER);
		} else if (model.isUserSelectable !== showInModelPicker) {
			this._storageService.store('chatModelPickerPreferences', this._modelPickerUserPreferences, StorageScope.PROFILE, StorageTarget.USER);
		}
		this._onLanguageModelChange.fire();
		this._logService.trace(`[LM] Updated model picker preference for ${modelIdentifier} to ${showInModelPicker}`);
	}

	getVendors(): IUserFriendlyLanguageModel[] {
		return Array.from(this._vendors.values());
	}

	getLanguageModelIds(): string[] {
		return Array.from(this._modelCache.keys());
	}
	// --- Start Positron ---
	private getSelectedProviderStorageKey(): string {
		return `chat.currentLanguageProvider`;
	}

	/**
	 * Gets the available providers, including their display names. This is done by
	 * using the current model cache to determine what providers are available.
	 *
	 * @returns The available providers with their display names
	 */
	getLanguageModelProviders(): IPositronChatProvider[] {
		const seenProviderIds = new Set<string>();
		const providers: IPositronChatProvider[] = [];

		for (const model of this._modelCache.values()) {
			if (seenProviderIds.has(model.vendor) ||
				// Only consider user-selectable models.
				!model.isUserSelectable) {
				continue;
			}
			seenProviderIds.add(model.vendor);
			providers.push({
				displayName: model.providerName ?? model.vendor,
				id: model.vendor
			});
		}

		return providers;
	}

	getLanguageModelIdsForCurrentProvider() {
		const currentProvider = this._currentProvider;
		if (!currentProvider) {
			return Array.from(this._modelCache.keys());
		}
		return Array.from(this._modelCache.entries())
			.filter(([, model]) => model.vendor === currentProvider.id)
			.map(([modelId,]) => modelId);
	}

	get currentProvider(): IPositronChatProvider | undefined {
		return this._currentProvider;
	}

	set currentProvider(provider: IPositronChatProvider | undefined) {
		this._logService.debug(`[LanguageModelsService] Setting current provider to ${provider?.id ?? 'undefined'}`);
		this._currentProvider = provider;
		this._onDidChangeCurrentProvider.fire(provider?.id);
		this._storageService.store(this.getSelectedProviderStorageKey(), provider, StorageScope.APPLICATION, StorageTarget.USER);
	}

	/**
	 * Get the extension identifier for a provider vendor.
	 */
	getExtensionIdentifierForProvider(vendor: string): ExtensionIdentifier | undefined {
		return this._providerExtensions.get(vendor);
	}
	// --- End Positron ---

	lookupLanguageModel(modelIdentifier: string): ILanguageModelChatMetadata | undefined {
		const model = this._modelCache.get(modelIdentifier);
		if (model && this._modelPickerUserPreferences[modelIdentifier] !== undefined) {
			return { ...model, isUserSelectable: this._modelPickerUserPreferences[modelIdentifier] };
		}
		return model;
	}

	private _clearModelCache(vendors: string | string[]): void {
		if (typeof vendors === 'string') {
			vendors = [vendors];
		}
		for (const vendor of vendors) {
			for (const [id, model] of this._modelCache.entries()) {
				if (model.vendor === vendor) {
					this._modelCache.delete(id);
				}
			}
		}
	}

	async resolveLanguageModels(vendors: string | string[], silent: boolean): Promise<void> {
		if (typeof vendors === 'string') {
			vendors = [vendors];
		}
		this._clearModelCache(vendors);
		for (const vendor of vendors) {
			const provider = this._providers.get(vendor);
			if (!provider) {
				this._logService.warn(`[LM] No provider registered for vendor ${vendor}`);
				continue;
			}
			try {
				const modelsAndIdentifiers = await provider.prepareLanguageModelChat({ silent }, CancellationToken.None);
				for (const modelAndIdentifier of modelsAndIdentifiers) {
					if (this._modelCache.has(modelAndIdentifier.identifier)) {
						this._logService.warn(`[LM] Model ${modelAndIdentifier.identifier} is already registered. Skipping.`);
						continue;
					}

					// --- Start Positron ---
					// Get and apply LLM allow filters from configuration.
					const _config = this._configurationService.getValue<{ filterModels: string[] }>('positron.assistant');
					this._logService.trace('[LM] Applying model filters:', _config.filterModels);
					if (_config.filterModels.length > 0 && !_config.filterModels.some(pattern =>
						match(pattern, modelAndIdentifier.metadata.id) ||
						match(pattern, modelAndIdentifier.metadata.name))
					) {
						continue;
					}
					// --- End Positron ---

					this._modelCache.set(modelAndIdentifier.identifier, modelAndIdentifier.metadata);
				}
				this._logService.trace(`[LM] Resolved language models for vendor ${vendor}`, modelsAndIdentifiers);
			} catch (error) {
				this._logService.error(`[LM] Error resolving language models for vendor ${vendor}:`, error);
			}
		}
		this._onLanguageModelChange.fire();
	}

	async selectLanguageModels(selector: ILanguageModelChatSelector, allowPromptingUser?: boolean): Promise<string[]> {

		if (selector.vendor) {
			// selective activation
			await this._extensionService.activateByEvent(`onLanguageModelChat:${selector.vendor}}`);
			await this.resolveLanguageModels([selector.vendor], !allowPromptingUser);
		} else {
			// activate all extensions that do language models
			const allVendors = Array.from(this._vendors.keys());
			const all = allVendors.map(vendor => this._extensionService.activateByEvent(`onLanguageModelChat:${vendor}`));
			await Promise.all(all);
			await this.resolveLanguageModels(allVendors, !allowPromptingUser);
		}

		const result: string[] = [];

		for (const [internalModelIdentifier, model] of this._modelCache) {
			if ((selector.vendor === undefined || model.vendor === selector.vendor)
				&& (selector.family === undefined || model.family === selector.family)
				&& (selector.version === undefined || model.version === selector.version)
				&& (selector.id === undefined || model.id === selector.id)) {
				result.push(internalModelIdentifier);
			}
		}

		this._logService.trace('[LM] selected language models', selector, result);

		return result;
	}

	// --- Start Positron ---
	// Include the extensionId when registering the provider
	// --- End Positron ---
	registerLanguageModelProvider(vendor: string, extensionId: ExtensionIdentifier, provider: ILanguageModelChatProvider): IDisposable {
		this._logService.trace('[LM] registering language model provider', vendor, provider);

		if (!this._vendors.has(vendor)) {
			throw new Error(`Chat model provider uses UNKNOWN vendor ${vendor}.`);
		}
		if (this._providers.has(vendor)) {
			throw new Error(`Chat model provider for vendor ${vendor} is already registered.`);
		}

		this._providers.set(vendor, provider);

		// --- Start Positron ---
		// Track the extension that registered this provider vendor
		this._providerExtensions.set(vendor, extensionId);
		// --- End Positron ---

		// TODO @lramos15 - Smarter restore logic. Don't activate all providers, but only those which were known to need restoring
		this.resolveLanguageModels(vendor, true).then(() => {
			// --- Start Positron ---
			// Fire the provider change event after models are resolved so UI knows usable providers are available
			this._logService.trace('[LM] Provider models resolved, firing onDidChangeProviders', vendor);
			this._onDidChangeProviders.fire({ added: [vendor] });
			// --- End Positron ---
			this._onLanguageModelChange.fire();
		});

		return toDisposable(() => {
			this._logService.trace('[LM] UNregistered language model provider', vendor);

			// --- Start Positron ---
			/* ORIGINAL
			this._providers.delete(vendor);
			*/

			// Clean up extension mapping when provider is removed
			if (this._providers.get(vendor) === provider) {
				// Only remove if this was the provider for this vendor
				this._providerExtensions.delete(vendor);
			}

			// Reverse order so that the context update is performed after changing the state
			const isDeleted = this._providers.delete(vendor);
			if (isDeleted) {
				if (this.currentProvider?.id === vendor) {
					// Current provider was removed, try to set the next available provider
					// First get available providers before clearing cache
					const availableProviders = this.getLanguageModelProviders().filter(p => p.id !== vendor);
					if (availableProviders.length > 0) {
						this.currentProvider = availableProviders[0];
						this._logService.trace('[LM] Set next available provider after removal', availableProviders[0].id);
					} else {
						this.currentProvider = undefined;
						this._logService.trace('[LM] No providers available after removal');
					}
				}
				// Clear the model cache for this vendor after handling provider switching
				this._clearModelCache(vendor);
				this._onDidChangeProviders.fire({ removed: [vendor] });
				this._logService.trace('[LM] Unregistered language model chat', vendor);
			}
			// --- End Positron ---
		});
	}

	async sendChatRequest(modelId: string, from: ExtensionIdentifier, messages: IChatMessage[], options: { [name: string]: any }, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		const provider = this._providers.get(this._modelCache.get(modelId)?.vendor || '');
		if (!provider) {
			throw new Error(`Chat provider for model ${modelId} is not registered.`);
		}
		return provider.sendChatRequest(modelId, messages, from, options, token);
	}

	computeTokenLength(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number> {
		const model = this._modelCache.get(modelId);
		if (!model) {
			throw new Error(`Chat model ${modelId} could not be found.`);
		}
		const provider = this._providers.get(model.vendor);
		if (!provider) {
			throw new Error(`Chat provider for model ${modelId} is not registered.`);
		}
		return provider.provideTokenCount(modelId, message, token);
	}
}
