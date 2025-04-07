/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../../common/languageModels.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

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
		const disposableStore = new DisposableStore();

		disposableStore.add(services.languageModelsService.onDidChangeLanguageModels((_e) => {
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

		return () => disposableStore.dispose();
	}, [languageModels, services.languageModelsService]);

	return {
		languageModels: languageModels,
		selectedLanguageModel: languageModels[0]?.identifier,
		...services,
	};
}
