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
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
// import { ChatImagePart } from '../../../api/common/extHostTypes.js';
import { IExtensionService, isProposedApiEnabled } from '../../../services/extensions/common/extensions.js';
import { ExtensionsRegistry } from '../../../services/extensions/common/extensionsRegistry.js';
import { ChatContextKeys } from './chatContextKeys.js';
// --- Start Positron ---
// The storage service is needed for Positron AI provider additions.
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
// --- End Positron ---

export const enum ChatMessageRole {
	System,
	User,
	Assistant,
}

export interface IChatMessageTextPart {
	type: 'text';
	value: string;
}

export interface IChatMessageImagePart {
	type: 'image_url';
	value: IChatImageURLPart;
}

export interface IChatMessageDataPart {
	type: 'data';
	mimeType: string;
	data: VSBuffer;
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
}

export interface IChatResponsePromptTsxPart {
	type: 'prompt_tsx';
	value: unknown;
}

export interface IChatResponseDataPart {
	type: 'data';
	value: IChatImageURLPart;
}

export interface IChatResponseToolUsePart {
	type: 'tool_use';
	name: string;
	toolCallId: string;
	parameters: any;
}

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
	readonly targetExtensions?: string[];

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

export interface ILanguageModelsChangeEvent {
	added?: ILanguageModelChatMetadataAndIdentifier[];
	removed?: string[];
}

export interface ILanguageModelsService {

	readonly _serviceBrand: undefined;

	onDidChangeLanguageModels: Event<ILanguageModelsChangeEvent>;
	// --- Start Positron ---
	/** The current language model provider. */
	get currentProvider(): IPositronChatProvider | undefined;

	/** Set the current language model provider. */
	set currentProvider(provider: IPositronChatProvider | undefined);

	/** Fires when the current language model provider is changed. */
	onDidChangeCurrentProvider: Event<IPositronChatProvider | undefined>;

	/** Get the language model IDs for the current provider. */
	getLanguageModelIdsForCurrentProvider(): string[];

	/** List the available language model providers. */
	getLanguageModelProviders(): IPositronChatProvider[];

	/** Get the extension identifier for a provider vendor. */
	getExtensionIdentifierForProvider(vendor: string): ExtensionIdentifier | undefined;
	// --- End Positron ---

	getLanguageModelIds(): string[];

	lookupLanguageModel(identifier: string): ILanguageModelChatMetadata | undefined;

	selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]>;

	registerLanguageModelChat(identifier: string, provider: ILanguageModelChat): IDisposable;

	sendChatRequest(identifier: string, from: ExtensionIdentifier, messages: IChatMessage[], options: { [name: string]: any }, token: CancellationToken): Promise<ILanguageModelChatResponse>;

	computeTokenLength(identifier: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
}

const languageModelType: IJSONSchema = {
	type: 'object',
	properties: {
		vendor: {
			type: 'string',
			description: localize('vscode.extension.contributes.languageModels.vendor', "A globally unique vendor of language models.")
		}
	}
};

interface IUserFriendlyLanguageModel {
	vendor: string;
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

	private readonly _providers = new Map<string, ILanguageModelChat>();
	private readonly _vendors = new Set<string>();
	// --- Start Positron ---
	// Track provider vendor to extension mapping for chat agent selection
	private readonly _providerExtensions = new Map<string, ExtensionIdentifier>();
	// --- End Positron ---

	private readonly _onDidChangeProviders = this._store.add(new Emitter<ILanguageModelsChangeEvent>());
	// --- Start Positron ---
	// readonly onDidChangeLanguageModels: Event<ILanguageModelsChangeEvent> = this._onDidChangeProviders.event;

	// We connect the onDidChangeLanguageModels event to a new _onDidChangeLanguageModels
	// Emitter that fires _after_ the current language model provider is updated.
	// The order is important since consumers (e.g. ChatInputPart) may query language
	// models for the current provider in an onDidChangeLanguageModels event handler.

	private readonly _onDidChangeLanguageModels = this._store.add(new Emitter<ILanguageModelsChangeEvent>());
	readonly onDidChangeLanguageModels: Event<ILanguageModelsChangeEvent> = this._onDidChangeLanguageModels.event;

	// Add the current provider and corresponding event.
	private _currentProvider?: IPositronChatProvider;
	private readonly _onDidChangeCurrentProvider = this._store.add(new Emitter<IPositronChatProvider | undefined>());
	readonly onDidChangeCurrentProvider = this._onDidChangeCurrentProvider.event;
	// --- End Positron ---

	private readonly _hasUserSelectableModels: IContextKey<boolean>;

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		// --- Start Positron ---
		// The storage service is needed to persist the current provider.
		@IStorageService private readonly _storageService: IStorageService,
		// --- End Positron ---
	) {
		this._hasUserSelectableModels = ChatContextKeys.languageModelsAreUserSelectable.bindTo(this._contextKeyService);

		this._store.add(languageModelExtensionPoint.setHandler((extensions) => {

			this._vendors.clear();

			for (const extension of extensions) {

				if (!isProposedApiEnabled(extension.description, 'chatProvider')) {
					extension.collector.error(localize('vscode.extension.contributes.languageModels.chatProviderRequired', "This contribution point requires the 'chatProvider' proposal."));
					continue;
				}

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
					this._vendors.add(item.vendor);
				}
			}

			const removed: string[] = [];
			for (const [identifier, value] of this._providers) {
				if (!this._vendors.has(value.metadata.vendor)) {
					this._providers.delete(identifier);
					removed.push(identifier);
				}
			}
			if (removed.length > 0) {
				this._onDidChangeProviders.fire({ removed });
			}
		}));
		// --- Start Positron ---
		this._store.add(this._onDidChangeProviders.event((event) => {
			const currentProvider = this._currentProvider;
			if (!currentProvider && event.added) {
				// There is no current provider and models were added, update the current provider
				// using the first added user-selectable model.
				const firstSelectableModel = event.added.find(model => model.metadata.isUserSelectable);
				if (firstSelectableModel) {
					this.currentProvider = this.getProviderFromLanguageModelMetadata(firstSelectableModel.metadata);
				}
			} else if (currentProvider && event.removed) {
				// There is a current provider and models were removed.
				// If no user-selectable models are left for the current provider,
				// switch to the next available provider.
				const hasCurrentProvider = Array.from(this._providers.values())
					.some((model) => model.metadata.isUserSelectable &&
						model.metadata.family === currentProvider.id);
				if (!hasCurrentProvider) {
					// No user-selectable models left for the current provider,
					// switch to the next available provider.
					this.currentProvider = this.getLanguageModelProviders()[0];
				}
			}

			// Now that the current provider is updated, fire the public language model changed event.
			this._onDidChangeLanguageModels.fire(event);
		}));

		// Restore the current provider from storage, if it exists.
		const storedCurrentProvider = this._storageService.getObject<IPositronChatProvider>(this.getSelectedProviderStorageKey(), StorageScope.APPLICATION, undefined);
		if (storedCurrentProvider) {
			// Set privately to avoid writing to storage again.
			this._currentProvider = storedCurrentProvider;
			this._onDidChangeCurrentProvider.fire(storedCurrentProvider);
		}
		// --- End Positron ---
	}

	dispose() {
		this._store.dispose();
		this._providers.clear();
	}

	getLanguageModelIds(): string[] {
		return Array.from(this._providers.keys());
	}
	// --- Start Positron ---
	private getSelectedProviderStorageKey(): string {
		return `chat.currentLanguageProvider`;
	}

	private getProviderFromLanguageModelMetadata(metadata: ILanguageModelChatMetadata): IPositronChatProvider {
		return {
			id: metadata.vendor,
			displayName: metadata.providerName ?? metadata.name,
		};
	}

	getLanguageModelProviders(): IPositronChatProvider[] {
		const seenProviderIds = new Set<string>();
		const providers: IPositronChatProvider[] = [];
		for (const model of this._providers.values()) {
			if (seenProviderIds.has(model.metadata.vendor) ||
				// Only consider user-selectable models.
				!model.metadata.isUserSelectable) {
				continue;
			}
			seenProviderIds.add(model.metadata.vendor);
			providers.push(this.getProviderFromLanguageModelMetadata(model.metadata));
		}
		return providers;
	}

	getLanguageModelIdsForCurrentProvider() {
		const currentProvider = this._currentProvider;
		if (!currentProvider) {
			return Array.from(this._providers.keys());
		}
		return Array.from(this._providers.entries())
			.filter(([, model]) => model.metadata.vendor === currentProvider.id)
			.map(([modelId,]) => modelId);
	}

	get currentProvider(): IPositronChatProvider | undefined {
		return this._currentProvider;
	}

	set currentProvider(provider: IPositronChatProvider | undefined) {
		this._logService.debug(`[LanguageModelsService] Setting current provider to ${provider?.id ?? 'undefined'}`);
		this._currentProvider = provider;
		this._onDidChangeCurrentProvider.fire(provider);
		this._storageService.store(this.getSelectedProviderStorageKey(), provider, StorageScope.APPLICATION, StorageTarget.USER);
	}

	/**
	 * Get the extension identifier for a provider vendor.
	 */
	getExtensionIdentifierForProvider(vendor: string): ExtensionIdentifier | undefined {
		return this._providerExtensions.get(vendor);
	}
	// --- End Positron ---

	lookupLanguageModel(identifier: string): ILanguageModelChatMetadata | undefined {
		return this._providers.get(identifier)?.metadata;
	}

	async selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]> {

		if (selector.vendor) {
			// selective activation
			await this._extensionService.activateByEvent(`onLanguageModelChat:${selector.vendor}}`);
		} else {
			// activate all extensions that do language models
			const all = Array.from(this._vendors).map(vendor => this._extensionService.activateByEvent(`onLanguageModelChat:${vendor}`));
			await Promise.all(all);
		}

		const result: string[] = [];

		for (const [identifier, model] of this._providers) {

			if ((selector.vendor === undefined || model.metadata.vendor === selector.vendor)
				&& (selector.family === undefined || model.metadata.family === selector.family)
				&& (selector.version === undefined || model.metadata.version === selector.version)
				&& (selector.id === undefined || model.metadata.id === selector.id)
				&& (!model.metadata.targetExtensions || model.metadata.targetExtensions.some(candidate => ExtensionIdentifier.equals(candidate, selector.extension)))
			) {
				result.push(identifier);
			}
		}

		this._logService.trace('[LM] selected language models', selector, result);

		return result;
	}

	registerLanguageModelChat(identifier: string, provider: ILanguageModelChat): IDisposable {

		this._logService.trace('[LM] registering language model chat', identifier, provider.metadata);

		if (!this._vendors.has(provider.metadata.vendor)) {
			// --- Start Positron ---
			// throw new Error(`Chat response provider uses UNKNOWN vendor ${provider.metadata.vendor}.`);
			this._vendors.add(provider.metadata.vendor);
			this._logService.debug(`[LanguageModelsService] Registering vendor ${provider.metadata.vendor}`);
			// --- End Positron ---
		}
		if (this._providers.has(identifier)) {
			throw new Error(`Chat response provider with identifier ${identifier} is already registered.`);
		}
		this._providers.set(identifier, provider);
		// --- Start Positron ---
		// Track the extension that registered this provider vendor
		this._providerExtensions.set(provider.metadata.vendor, provider.metadata.extension);
		// --- End Positron ---
		this._onDidChangeProviders.fire({ added: [{ identifier, metadata: provider.metadata }] });
		this.updateUserSelectableModelsContext();
		return toDisposable(() => {
			// --- Start Positron ---
			// Clean up extension mapping when provider is removed
			if (this._providers.get(identifier)?.metadata.vendor === provider.metadata.vendor) {
				// Only remove if this was the provider for this vendor
				this._providerExtensions.delete(provider.metadata.vendor);
			}
			// --- End Positron ---
			// Reverse order so that the context update is performed after changing the state
			if (this._providers.delete(identifier)) {
				this._onDidChangeProviders.fire({ removed: [identifier] });
				this._logService.trace('[LM] UNregistered language model chat', identifier, provider.metadata);
			}
			this.updateUserSelectableModelsContext();
			// --- End Positron ---
		});
	}

	private updateUserSelectableModelsContext() {
		// This context key to enable the picker is set when there is a default model, and there is at least one other model that is user selectable
		const hasUserSelectableModels = Array.from(this._providers.values()).some(p => p.metadata.isUserSelectable);
		// --- Start Positron ---
		// const hasDefaultModel = Array.from(this._providers.values()).some(p => p.metadata.isDefault);
		this._hasUserSelectableModels.set(hasUserSelectableModels);
		// --- End Positron ---
	}

	async sendChatRequest(identifier: string, from: ExtensionIdentifier, messages: IChatMessage[], options: { [name: string]: any }, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		const provider = this._providers.get(identifier);
		this._logService.trace(`[LanguageModelsService] Sending chat request to provider ${identifier} (${messages.length} messages)`);
		if (!provider) {
			throw new Error(`Chat response provider with identifier ${identifier} is not registered.`);
		}
		return provider.sendChatRequest(messages, from, options, token);
	}

	computeTokenLength(identifier: string, message: string | IChatMessage, token: CancellationToken): Promise<number> {
		const provider = this._providers.get(identifier);
		if (!provider) {
			throw new Error(`Chat response provider with identifier ${identifier} is not registered.`);
		}
		return provider.provideTokenCount(message, token);
	}
}
