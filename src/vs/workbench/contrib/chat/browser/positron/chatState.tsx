/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { ILanguageModelsService, IPositronChatProvider } from '../../common/languageModels.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ChatInputPart } from '../chatInputPart.js';

export interface PositronChatServices {
	readonly languageModelsService: ILanguageModelsService;
	readonly chatInput: ChatInputPart;
}

export interface PositronChatState extends PositronChatServices {
	readonly providers?: IPositronChatProvider[];
	readonly currentProvider?: IPositronChatProvider;
}

export const usePositronChatState = (services: PositronChatServices): PositronChatState => {
	const [providers, setProviders] = useState<IPositronChatProvider[]>([]);
	const [currentProvider, setCurrentProvider] = useState<IPositronChatProvider | undefined>(services.languageModelsService.currentProvider);

	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(services.languageModelsService.onDidChangeLanguageModels((event) => {
			const newProviders = services.languageModelsService.getLanguageModelProviders();
			setProviders(newProviders);
		}));

		disposableStore.add(services.languageModelsService.onDidChangeCurrentProvider((newProvider) => {
			setCurrentProvider(newProvider);
		}));

		return () => disposableStore.dispose();
	}, [services.chatInput, services.languageModelsService]);

	return {
		providers: providers,
		currentProvider: currentProvider,
		...services,
	};
}
