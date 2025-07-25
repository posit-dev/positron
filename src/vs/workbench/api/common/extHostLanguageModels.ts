/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { AsyncIterableObject, AsyncIterableSource, RunOnceScheduler } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError, SerializedError, transformErrorForSerialization, transformErrorFromSerialization } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Iterable } from '../../../base/common/iterator.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ExtensionIdentifier, ExtensionIdentifierMap, ExtensionIdentifierSet, IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { Progress } from '../../../platform/progress/common/progress.js';
import { ChatImageMimeType, IChatMessage, IChatResponseFragment, IChatResponsePart, ILanguageModelChatMetadata } from '../../contrib/chat/common/languageModels.js';
import { INTERNAL_AUTH_PROVIDER_PREFIX } from '../../services/authentication/common/authentication.js';
import { checkProposedApiEnabled } from '../../services/extensions/common/extensions.js';
import { ExtHostLanguageModelsShape, MainContext, MainThreadLanguageModelsShape } from './extHost.protocol.js';
import { IExtHostAuthentication } from './extHostAuthentication.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import * as typeConvert from './extHostTypeConverters.js';
import * as extHostTypes from './extHostTypes.js';
import { SerializableObjectWithBuffers } from '../../services/extensions/common/proxyIdentifier.js';
import { VSBuffer } from '../../../base/common/buffer.js';

export interface IExtHostLanguageModels extends ExtHostLanguageModels { }

export const IExtHostLanguageModels = createDecorator<IExtHostLanguageModels>('IExtHostLanguageModels');

type LanguageModelData = {
	readonly languageModelId: string;
	readonly extension: ExtensionIdentifier;
	readonly provider: vscode.ChatResponseProvider;
};

class LanguageModelResponseStream {

	readonly stream = new AsyncIterableSource<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>();

	constructor(
		readonly option: number,
		stream?: AsyncIterableSource<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>
	) {
		this.stream = stream ?? new AsyncIterableSource<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>();
	}
}

class LanguageModelResponse {

	readonly apiObject: vscode.LanguageModelChatResponse;

	private readonly _responseStreams = new Map<number, LanguageModelResponseStream>();
	private readonly _defaultStream = new AsyncIterableSource<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>();
	private _isDone: boolean = false;

	constructor() {

		const that = this;
		this.apiObject = {
			// result: promise,
			get stream() {
				return that._defaultStream.asyncIterable;
			},
			get text() {
				return AsyncIterableObject.map(that._defaultStream.asyncIterable, part => {
					if (part instanceof extHostTypes.LanguageModelTextPart) {
						return part.value;
					} else {
						return undefined;
					}
				}).coalesce();
			},
		};
	}

	private * _streams() {
		if (this._responseStreams.size > 0) {
			for (const [, value] of this._responseStreams) {
				yield value.stream;
			}
		} else {
			yield this._defaultStream;
		}
	}

	handleFragment(fragments: IChatResponseFragment | IChatResponseFragment[]): void {
		if (this._isDone) {
			return;
		}

		const partsByIndex = new Map<number, (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[]>();

		for (const fragment of Iterable.wrap(fragments)) {

			let out: vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart;
			if (fragment.part.type === 'text') {
				out = new extHostTypes.LanguageModelTextPart(fragment.part.value);
			} else if (fragment.part.type === 'data') {
				out = new extHostTypes.LanguageModelTextPart('');
			} else {
				out = new extHostTypes.LanguageModelToolCallPart(fragment.part.toolCallId, fragment.part.name, fragment.part.parameters);
			}
			const array = partsByIndex.get(fragment.index);
			if (!array) {
				partsByIndex.set(fragment.index, [out]);
			} else {
				array.push(out);
			}
		}


		for (const [index, parts] of partsByIndex) {
			let res = this._responseStreams.get(index);
			if (!res) {
				if (this._responseStreams.size === 0) {
					// the first response claims the default response
					res = new LanguageModelResponseStream(index, this._defaultStream);
				} else {
					res = new LanguageModelResponseStream(index);
				}
				this._responseStreams.set(index, res);
			}
			res.stream.emitMany(parts);
		}
	}

	reject(err: Error): void {
		this._isDone = true;
		for (const stream of this._streams()) {
			stream.reject(err);
		}
	}

	resolve(): void {
		this._isDone = true;
		for (const stream of this._streams()) {
			stream.resolve();
		}
	}
}

export class ExtHostLanguageModels implements ExtHostLanguageModelsShape {

	declare _serviceBrand: undefined;

	private static _idPool = 1;

	private readonly _proxy: MainThreadLanguageModelsShape;
	private readonly _onDidChangeModelAccess = new Emitter<{ from: ExtensionIdentifier; to: ExtensionIdentifier }>();
	private readonly _onDidChangeProviders = new Emitter<void>();
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	private readonly _languageModels = new Map<number, LanguageModelData>();
	private readonly _allLanguageModelData = new Map<string, { metadata: ILanguageModelChatMetadata; apiObjects: ExtensionIdentifierMap<vscode.LanguageModelChat> }>(); // these are ALL models, not just the one in this EH
	private readonly _modelAccessList = new ExtensionIdentifierMap<ExtensionIdentifierSet>();
	private readonly _pendingRequest = new Map<number, { languageModelId: string; res: LanguageModelResponse }>();
	private readonly _ignoredFileProviders = new Map<number, vscode.LanguageModelIgnoredFileProvider>();

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@ILogService private readonly _logService: ILogService,
		@IExtHostAuthentication private readonly _extHostAuthentication: IExtHostAuthentication,
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadLanguageModels);
	}

	dispose(): void {
		this._onDidChangeModelAccess.dispose();
		this._onDidChangeProviders.dispose();
	}

	registerLanguageModel(extension: IExtensionDescription, identifier: string, provider: vscode.ChatResponseProvider, metadata: vscode.ChatResponseProviderMetadata): IDisposable {

		const handle = ExtHostLanguageModels._idPool++;
		this._languageModels.set(handle, { extension: extension.identifier, provider, languageModelId: identifier });
		let auth;
		if (metadata.auth) {
			auth = {
				providerLabel: extension.displayName || extension.name,
				accountLabel: typeof metadata.auth === 'object' ? metadata.auth.label : undefined
			};
		}
		this._proxy.$registerLanguageModelProvider(handle, `${ExtensionIdentifier.toKey(extension.identifier)}/${identifier}`, {
			extension: extension.identifier,
			id: identifier,
			vendor: metadata.vendor ?? ExtensionIdentifier.toKey(extension.identifier),
			name: metadata.name ?? '',
			family: metadata.family ?? '',
			// --- Start Positron ---
			providerName: metadata.providerName ?? metadata.family,
			// --- End Positron ---
			cost: metadata.cost,
			description: metadata.description,
			version: metadata.version,
			maxInputTokens: metadata.maxInputTokens,
			maxOutputTokens: metadata.maxOutputTokens,
			auth,
			targetExtensions: metadata.extensions,
			isDefault: metadata.isDefault,
			isUserSelectable: metadata.isUserSelectable,
			modelPickerCategory: metadata.category,
			capabilities: metadata.capabilities,
		});

		const responseReceivedListener = provider.onDidReceiveLanguageModelResponse2?.(({ extensionId, participant, tokenCount }) => {
			this._proxy.$whenLanguageModelChatRequestMade(identifier, new ExtensionIdentifier(extensionId), participant, tokenCount);
		});

		return toDisposable(() => {
			this._languageModels.delete(handle);
			this._proxy.$unregisterProvider(handle);
			responseReceivedListener?.dispose();
		});
	}

	async $startChatRequest(handle: number, requestId: number, from: ExtensionIdentifier, messages: SerializableObjectWithBuffers<IChatMessage[]>, options: vscode.LanguageModelChatRequestOptions, token: CancellationToken): Promise<void> {
		const data = this._languageModels.get(handle);
		if (!data) {
			throw new Error('Provider not found');
		}

		const queue: IChatResponseFragment[] = [];
		const sendNow = () => {
			if (queue.length > 0) {
				this._proxy.$reportResponsePart(requestId, queue);
				queue.length = 0;
			}
		};
		const queueScheduler = new RunOnceScheduler(sendNow, 30);
		const sendSoon = (part: IChatResponseFragment) => {
			const newLen = queue.push(part);
			// flush/send if things pile up more than expected
			if (newLen > 30) {
				sendNow();
				queueScheduler.cancel();
			} else {
				queueScheduler.schedule();
			}
		};

		const progress = new Progress<vscode.ChatResponseFragment2>(async fragment => {
			if (token.isCancellationRequested) {
				this._logService.warn(`[CHAT](${data.extension.value}) CANNOT send progress because the REQUEST IS CANCELLED`);
				return;
			}

			let part: IChatResponsePart | undefined;
			if (fragment.part instanceof extHostTypes.LanguageModelToolCallPart) {
				part = { type: 'tool_use', name: fragment.part.name, parameters: fragment.part.input, toolCallId: fragment.part.callId };
			} else if (fragment.part instanceof extHostTypes.LanguageModelTextPart) {
				part = { type: 'text', value: fragment.part.value };
			} else if (fragment.part instanceof extHostTypes.LanguageModelDataPart) {
				part = { type: 'data', value: { mimeType: fragment.part.mimeType as ChatImageMimeType, data: VSBuffer.wrap(fragment.part.data) } };
			}

			if (!part) {
				this._logService.warn(`[CHAT](${data.extension.value}) UNKNOWN part ${JSON.stringify(fragment)}`);
				return;
			}

			sendSoon({ index: fragment.index, part });
		});

		let value: unknown;

		try {
			value = data.provider.provideLanguageModelResponse(
				messages.value.map(typeConvert.LanguageModelChatMessage2.to),
				options,
				ExtensionIdentifier.toKey(from),
				progress,
				token
			);

		} catch (err) {
			// synchronously failed
			throw err;
		}

		Promise.resolve(value).then(() => {
			sendNow();
			this._proxy.$reportResponseDone(requestId, undefined);
		}, err => {
			sendNow();
			this._proxy.$reportResponseDone(requestId, transformErrorForSerialization(err));
		});
	}

	//#region --- token counting

	$provideTokenLength(handle: number, value: string, token: CancellationToken): Promise<number> {
		const data = this._languageModels.get(handle);
		if (!data) {
			return Promise.resolve(0);
		}
		return Promise.resolve(data.provider.provideTokenCount(value, token));
	}


	//#region --- making request

	$acceptChatModelMetadata(data: { added?: { identifier: string; metadata: ILanguageModelChatMetadata }[] | undefined; removed?: string[] | undefined }): void {
		if (data.added) {
			for (const { identifier, metadata } of data.added) {
				this._allLanguageModelData.set(identifier, { metadata, apiObjects: new ExtensionIdentifierMap() });
			}
		}
		if (data.removed) {
			for (const id of data.removed) {
				// clean up
				this._allLanguageModelData.delete(id);

				// cancel pending requests for this model
				for (const [key, value] of this._pendingRequest) {
					if (value.languageModelId === id) {
						value.res.reject(new CancellationError());
						this._pendingRequest.delete(key);
					}
				}
			}
		}

		// TODO@jrieken@TylerLeonhardt - this is a temporary hack to populate the auth providers
		data.added?.forEach(added => this._fakeAuthPopulate(added.metadata));

		this._onDidChangeProviders.fire(undefined);
	}

	async getDefaultLanguageModel(extension: IExtensionDescription): Promise<vscode.LanguageModelChat | undefined> {
		const defaultModelId = Iterable.find(this._allLanguageModelData.entries(), ([, value]) => !!value.metadata.isDefault)?.[0];
		if (!defaultModelId) {
			return;
		}

		return this.getLanguageModelByIdentifier(extension, defaultModelId);
	}

	async getLanguageModelByIdentifier(extension: IExtensionDescription, identifier: string): Promise<vscode.LanguageModelChat | undefined> {

		const data = this._allLanguageModelData.get(identifier);
		if (!data) {
			// model gone? is this an error on us?
			return;
		}

		// make sure auth information is correct
		if (this._isUsingAuth(extension.identifier, data.metadata)) {
			await this._fakeAuthPopulate(data.metadata);
		}

		let apiObject = data.apiObjects.get(extension.identifier);
		if (!apiObject) {
			const that = this;
			apiObject = {
				id: data.metadata.id,
				vendor: data.metadata.vendor,
				family: data.metadata.family,
				version: data.metadata.version,
				name: data.metadata.name,
				capabilities: {
					supportsImageToText: data.metadata.capabilities?.vision ?? false,
					supportsToolCalling: data.metadata.capabilities?.toolCalling ?? false,
				},
				maxInputTokens: data.metadata.maxInputTokens,
				countTokens(text, token) {
					if (!that._allLanguageModelData.has(identifier)) {
						throw extHostTypes.LanguageModelError.NotFound(identifier);
					}
					return that._computeTokenLength(identifier, text, token ?? CancellationToken.None);
				},
				sendRequest(messages, options, token) {
					if (!that._allLanguageModelData.has(identifier)) {
						throw extHostTypes.LanguageModelError.NotFound(identifier);
					}
					return that._sendChatRequest(extension, identifier, messages, options ?? {}, token ?? CancellationToken.None);
				}
			};

			Object.freeze(apiObject);
			data.apiObjects.set(extension.identifier, apiObject);
		}

		return apiObject;
	}

	async selectLanguageModels(extension: IExtensionDescription, selector: vscode.LanguageModelChatSelector) {

		// this triggers extension activation
		const models = await this._proxy.$selectChatModels({ ...selector, extension: extension.identifier });

		const result: vscode.LanguageModelChat[] = [];

		for (const identifier of models) {
			const model = await this.getLanguageModelByIdentifier(extension, identifier);
			if (model) {
				result.push(model);
			}
		}

		return result;
	}

	private async _sendChatRequest(extension: IExtensionDescription, languageModelId: string, messages: vscode.LanguageModelChatMessage2[], options: vscode.LanguageModelChatRequestOptions, token: CancellationToken) {

		const internalMessages: IChatMessage[] = this._convertMessages(extension, messages);

		const from = extension.identifier;
		const metadata = this._allLanguageModelData.get(languageModelId)?.metadata;

		if (!metadata || !this._allLanguageModelData.has(languageModelId)) {
			throw extHostTypes.LanguageModelError.NotFound(`Language model '${languageModelId}' is unknown.`);
		}

		if (this._isUsingAuth(from, metadata)) {
			const success = await this._getAuthAccess(extension, { identifier: metadata.extension, displayName: metadata.auth.providerLabel }, options.justification, false);

			if (!success || !this._modelAccessList.get(from)?.has(metadata.extension)) {
				throw extHostTypes.LanguageModelError.NoPermissions(`Language model '${languageModelId}' cannot be used by '${from.value}'.`);
			}
		}

		const requestId = (Math.random() * 1e6) | 0;
		const res = new LanguageModelResponse();
		this._pendingRequest.set(requestId, { languageModelId, res });

		try {
			await this._proxy.$tryStartChatRequest(from, languageModelId, requestId, new SerializableObjectWithBuffers(internalMessages), options, token);

		} catch (error) {
			// error'ing here means that the request could NOT be started/made, e.g. wrong model, no access, etc, but
			// later the response can fail as well. Those failures are communicated via the stream-object
			this._pendingRequest.delete(requestId);
			throw extHostTypes.LanguageModelError.tryDeserialize(error) ?? error;
		}

		return res.apiObject;
	}

	private _convertMessages(extension: IExtensionDescription, messages: vscode.LanguageModelChatMessage2[]) {
		const internalMessages: IChatMessage[] = [];
		for (const message of messages) {
			if (message.role as number === extHostTypes.LanguageModelChatMessageRole.System) {
				checkProposedApiEnabled(extension, 'languageModelSystem');
			}
			internalMessages.push(typeConvert.LanguageModelChatMessage2.from(message));
		}
		return internalMessages;
	}

	async $acceptResponsePart(requestId: number, chunk: IChatResponseFragment | IChatResponseFragment[]): Promise<void> {
		const data = this._pendingRequest.get(requestId);
		if (data) {
			data.res.handleFragment(chunk);
		}
	}

	async $acceptResponseDone(requestId: number, error: SerializedError | undefined): Promise<void> {
		const data = this._pendingRequest.get(requestId);
		if (!data) {
			return;
		}
		this._pendingRequest.delete(requestId);
		if (error) {
			// we error the stream because that's the only way to signal
			// that the request has failed
			data.res.reject(extHostTypes.LanguageModelError.tryDeserialize(error) ?? transformErrorFromSerialization(error));
		} else {
			data.res.resolve();
		}
	}

	// BIG HACK: Using AuthenticationProviders to check access to Language Models
	private async _getAuthAccess(from: IExtensionDescription, to: { identifier: ExtensionIdentifier; displayName: string }, justification: string | undefined, silent: boolean | undefined): Promise<boolean> {
		// This needs to be done in both MainThread & ExtHost ChatProvider
		const providerId = INTERNAL_AUTH_PROVIDER_PREFIX + to.identifier.value;
		const session = await this._extHostAuthentication.getSession(from, providerId, [], { silent: true });

		if (session) {
			this.$updateModelAccesslist([{ from: from.identifier, to: to.identifier, enabled: true }]);
			return true;
		}

		if (silent) {
			return false;
		}

		try {
			const detail = justification
				? localize('chatAccessWithJustification', "Justification: {1}", to.displayName, justification)
				: undefined;
			await this._extHostAuthentication.getSession(from, providerId, [], { forceNewSession: { detail } });
			this.$updateModelAccesslist([{ from: from.identifier, to: to.identifier, enabled: true }]);
			return true;

		} catch (err) {
			// ignore
			return false;
		}
	}

	private _isUsingAuth(from: ExtensionIdentifier, toMetadata: ILanguageModelChatMetadata): toMetadata is ILanguageModelChatMetadata & { auth: NonNullable<ILanguageModelChatMetadata['auth']> } {
		// If the 'to' extension uses an auth check
		return !!toMetadata.auth
			// And we're asking from a different extension
			&& !ExtensionIdentifier.equals(toMetadata.extension, from);
	}

	private async _fakeAuthPopulate(metadata: ILanguageModelChatMetadata): Promise<void> {

		if (!metadata.auth) {
			return;
		}

		for (const from of this._languageAccessInformationExtensions) {
			try {
				await this._getAuthAccess(from, { identifier: metadata.extension, displayName: '' }, undefined, true);
			} catch (err) {
				this._logService.error('Fake Auth request failed');
				this._logService.error(err);
			}
		}
	}

	private async _computeTokenLength(languageModelId: string, value: string | vscode.LanguageModelChatMessage2, token: vscode.CancellationToken): Promise<number> {

		const data = this._allLanguageModelData.get(languageModelId);
		if (!data) {
			throw extHostTypes.LanguageModelError.NotFound(`Language model '${languageModelId}' is unknown.`);
		}

		const local = Iterable.find(this._languageModels.values(), candidate => candidate.languageModelId === languageModelId);
		if (local) {
			// stay inside the EH
			return local.provider.provideTokenCount(value, token);
		}

		return this._proxy.$countTokens(languageModelId, (typeof value === 'string' ? value : typeConvert.LanguageModelChatMessage2.from(value)), token);
	}

	$updateModelAccesslist(data: { from: ExtensionIdentifier; to: ExtensionIdentifier; enabled: boolean }[]): void {
		const updated = new Array<{ from: ExtensionIdentifier; to: ExtensionIdentifier }>();
		for (const { from, to, enabled } of data) {
			const set = this._modelAccessList.get(from) ?? new ExtensionIdentifierSet();
			const oldValue = set.has(to);
			if (oldValue !== enabled) {
				if (enabled) {
					set.add(to);
				} else {
					set.delete(to);
				}
				this._modelAccessList.set(from, set);
				const newItem = { from, to };
				updated.push(newItem);
				this._onDidChangeModelAccess.fire(newItem);
			}
		}
	}

	private readonly _languageAccessInformationExtensions = new Set<Readonly<IExtensionDescription>>();

	createLanguageModelAccessInformation(from: Readonly<IExtensionDescription>): vscode.LanguageModelAccessInformation {

		this._languageAccessInformationExtensions.add(from);

		const that = this;
		const _onDidChangeAccess = Event.signal(Event.filter(this._onDidChangeModelAccess.event, e => ExtensionIdentifier.equals(e.from, from.identifier)));
		const _onDidAddRemove = Event.signal(this._onDidChangeProviders.event);

		return {
			get onDidChange() {
				return Event.any(_onDidChangeAccess, _onDidAddRemove);
			},
			canSendRequest(chat: vscode.LanguageModelChat): boolean | undefined {

				let metadata: ILanguageModelChatMetadata | undefined;

				out: for (const [_, value] of that._allLanguageModelData) {
					for (const candidate of value.apiObjects.values()) {
						if (candidate === chat) {
							metadata = value.metadata;
							break out;
						}
					}
				}
				if (!metadata) {
					return undefined;
				}
				if (!that._isUsingAuth(from.identifier, metadata)) {
					return true;
				}

				const list = that._modelAccessList.get(from.identifier);
				if (!list) {
					return undefined;
				}
				return list.has(metadata.extension);
			}
		};
	}

	fileIsIgnored(extension: IExtensionDescription, uri: vscode.Uri, token: vscode.CancellationToken = CancellationToken.None): Promise<boolean> {
		checkProposedApiEnabled(extension, 'chatParticipantAdditions');

		return this._proxy.$fileIsIgnored(uri, token);
	}

	async $isFileIgnored(handle: number, uri: UriComponents, token: CancellationToken): Promise<boolean> {
		const provider = this._ignoredFileProviders.get(handle);
		if (!provider) {
			throw new Error('Unknown LanguageModelIgnoredFileProvider');
		}

		return (await provider.provideFileIgnored(URI.revive(uri), token)) ?? false;
	}

	registerIgnoredFileProvider(extension: IExtensionDescription, provider: vscode.LanguageModelIgnoredFileProvider): vscode.Disposable {
		checkProposedApiEnabled(extension, 'chatParticipantPrivate');

		const handle = ExtHostLanguageModels._idPool++;
		this._proxy.$registerFileIgnoreProvider(handle);
		this._ignoredFileProviders.set(handle, provider);
		return toDisposable(() => {
			this._proxy.$unregisterFileIgnoreProvider(handle);
			this._ignoredFileProviders.delete(handle);
		});
	}
}
