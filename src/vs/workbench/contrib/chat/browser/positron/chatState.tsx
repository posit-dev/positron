/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../../common/languageModels.js';
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
}

export const usePositronChatState = (services: PositronChatServices): PositronChatState => {
	const [languageModels, setLanguageModels] = useState<ILanguageModelChatMetadataAndIdentifier[]>([]);
	const [currentModel, setCurrentModel] = useState<ILanguageModelChatMetadataAndIdentifier | undefined>(undefined);

	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(services.languageModelsService.onDidChangeLanguageModels((event) => {
			const newModels: ILanguageModelChatMetadataAndIdentifier[] = [];
			services.languageModelsService.getLanguageModelIds().forEach((id) => {
				const metadata = services.languageModelsService.lookupLanguageModel(id);
				if (metadata && metadata.isUserSelectable) {
					newModels.push({
						identifier: id,
						metadata: metadata
					})
				}
			});

			setLanguageModels(newModels);
		}));

		disposableStore.add(services.chatInput.modelPickerDelegate.onDidChangeModel((newModel) => {
			setCurrentModel(newModel);
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

	return {
		languageModels: languageModels,
		currentModel: currentModel,
		...services,
	};
}
