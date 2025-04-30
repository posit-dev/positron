/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService, IPositronChatProvider } from '../../common/languageModels.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ChatInputPart } from '../chatInputPart.js';

export interface PositronChatServices {
	readonly languageModelsService: ILanguageModelsService;
	readonly modelService: IModelService;
	readonly chatInput: ChatInputPart;
}

export interface PositronChatState extends PositronChatServices {
	readonly languageModels?: ILanguageModelChatMetadataAndIdentifier[];
	readonly currentModel?: ILanguageModelChatMetadataAndIdentifier;
	readonly providers?: IPositronChatProvider[];
	readonly currentProvider?: IPositronChatProvider;
}

export const usePositronChatState = (services: PositronChatServices): PositronChatState => {
	const [languageModels, setLanguageModels] = useState<ILanguageModelChatMetadataAndIdentifier[]>([]);
	const [currentModel, setCurrentModel] = useState<ILanguageModelChatMetadataAndIdentifier | undefined>(undefined);
	const [providers, setProviders] = useState<IPositronChatProvider[]>([]);
	const [currentProvider, setCurrentProvider] = useState<IPositronChatProvider | undefined>(undefined);

	useEffect(() => {
		const newModels: ILanguageModelChatMetadataAndIdentifier[] = services.chatInput.getModels();

		setLanguageModels(newModels);
	}, [services.chatInput]);

	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(services.languageModelsService.onDidChangeLanguageModels((event) => {
			const newModels: ILanguageModelChatMetadataAndIdentifier[] = services.chatInput.getModels();

			setLanguageModels(newModels);
		}));

		disposableStore.add(services.chatInput.modelPickerDelegate.onDidChangeModel((newModel) => {
			setCurrentModel(newModel);
		}));

		disposableStore.add(services.chatInput.modelPickerDelegate.onDidChangeProvider((newProvider) => {
			setCurrentProvider(newProvider);
		}));

		return () => disposableStore.dispose();
	}, [services.chatInput.modelPickerDelegate, services.languageModelsService]);

	useEffect(() => {
		const currentModelId = services.chatInput.currentLanguageModel;
		if (currentModelId) {
			const model = services.languageModelsService.lookupLanguageModel(currentModelId);
			if (model !== undefined) {
				setCurrentModel({
					identifier: currentModelId,
					metadata: model
				});
			} else {
				setCurrentModel(undefined);
			}
		}
	}, [services.chatInput.currentLanguageModel, services.languageModelsService]);

	useEffect(() => {
		const providers = new Set<IPositronChatProvider>();

		languageModels.forEach((model) => {
			const provider = {
				id: model.metadata.family,
				displayName: model.metadata.providerName ?? model.metadata.name,
			}
			providers.add(provider);
		});

		setProviders(Array.from(providers));
	}, [languageModels]);

	useEffect(() => {
		const currentProvider = services.chatInput.currentProvider;
		if (currentProvider) {
			setCurrentProvider(currentProvider);
		}
	}, []);

	return {
		languageModels: languageModels,
		currentModel: currentModel,
		providers: providers,
		currentProvider: currentProvider,
		...services,
	};
}
