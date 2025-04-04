/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../../common/languageModels.js';

export interface PositronChatServices {
	readonly languageModelsService: ILanguageModelsService;
	readonly modelService: IModelService;
}

export interface PositronChatState extends PositronChatServices {
	readonly languageModels?: ILanguageModelChatMetadataAndIdentifier[];
	selectedLanguageModel: string;
}

export const usePositronChatState = (services: PositronChatServices): PositronChatState => {
	const [languageModels, setLanguageModels] = useState<ILanguageModelChatMetadataAndIdentifier[]>([]);

	useEffect(() => {
		services.languageModelsService.onDidChangeLanguageModels((e) => {
			const newModels: ILanguageModelChatMetadataAndIdentifier[] = [];
			if (e.added) {
				newModels.push(...e.added
					.map(modelId => ({ identifier: modelId.identifier, metadata: services.languageModelsService.lookupLanguageModel(modelId.identifier)! }))
					.filter((model) => {
						return model.metadata?.isUserSelectable;
					}));
				setLanguageModels([...languageModels, ...newModels]);
			}
			if (e.removed) {
				e.removed.forEach((modelId) => {
					const index = languageModels.findIndex((model) => model.identifier === modelId);
					if (index !== -1) {
						languageModels.splice(index, 1);
					}
				});
			}
		});
	}, [languageModels, services.languageModelsService]);
	services.languageModelsService.getLanguageModelIds().map((model) => {
		const metadata = services.languageModelsService.lookupLanguageModel(model)!
		return {
			identifier: model,
			metadata: metadata,
		}
	}).filter((model) => {
		return model.metadata?.isUserSelectable;
	});

	return {
		languageModels: languageModels,
		selectedLanguageModel: languageModels[0]?.identifier,
		...services,
	};
}
