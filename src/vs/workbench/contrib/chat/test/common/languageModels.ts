/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IChatMessage, ILanguageModelChat, ILanguageModelChatMetadata, ILanguageModelChatResponse, ILanguageModelChatSelector, ILanguageModelsService } from '../../common/languageModels.js';

// --- Start Positron ---
// eslint-disable-next-line no-duplicate-imports
import { IPositronChatProvider } from '../../common/languageModels.js';
// --- End Positron ---

export class NullLanguageModelsService implements ILanguageModelsService {

	_serviceBrand: undefined;

	onDidChangeLanguageModels = Event.None;

	getLanguageModelIds(): string[] {
		return [];
	}

	lookupLanguageModel(identifier: string): ILanguageModelChatMetadata | undefined {
		return undefined;
	}

	async selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]> {
		return [];
	}

	registerLanguageModelChat(identifier: string, provider: ILanguageModelChat): IDisposable {
		return Disposable.None;
	}

	sendChatRequest(identifier: string, from: ExtensionIdentifier, messages: IChatMessage[], options: { [name: string]: any }, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		throw new Error('Method not implemented.');
	}

	computeTokenLength(identifier: string, message: string | IChatMessage, token: CancellationToken): Promise<number> {
		throw new Error('Method not implemented.');
	}

	// --- Start Positron ---
	// Add Positron-specific methods
	get currentProvider(): IPositronChatProvider | undefined {
		throw new Error('Method not implemented.');
	}
	set currentProvider(provider: IPositronChatProvider | undefined) {
		throw new Error('Method not implemented.');
	}
	onDidChangeCurrentProvider: Event<IPositronChatProvider | undefined> = Event.None;
	getLanguageModelIdsForCurrentProvider(): string[] {
		throw new Error('Method not implemented.');
	}
	getLanguageModelProviders(): IPositronChatProvider[] {
		throw new Error('Method not implemented.');
	}

	getExtensionIdentifierForProvider(vendor: string): ExtensionIdentifier | undefined {
		throw new Error('Method not implemented.');
	}
	// --- End Positron ---
}
