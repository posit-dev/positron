/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { ChatInputPart } from '../chatInputPart.js';
import { IPositronChatProvider } from '../../common/languageModels.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

export interface PositronChatEnvironment {
	readonly chatInput: ChatInputPart;
}

export interface PositronChatState extends PositronChatEnvironment {
	readonly providers?: IPositronChatProvider[];
	readonly currentProvider?: IPositronChatProvider;
}

export const usePositronChatState = (environment: PositronChatEnvironment): PositronChatState => {
	const services = usePositronReactServicesContext();
	const [providers, setProviders] = useState<IPositronChatProvider[]>([]);
	const [currentProvider, setCurrentProvider] = useState<IPositronChatProvider | undefined>(undefined);

	useEffect(() => {
		const disposableStore = new DisposableStore();

		setProviders(services.languageModelsService.getLanguageModelProviders());
		setCurrentProvider(services.languageModelsService.currentProvider);

		disposableStore.add(services.languageModelsService.onDidChangeProviders((event) => {
			const providers = services.languageModelsService.getLanguageModelProviders();
			setProviders(providers);
		}));

		disposableStore.add(services.languageModelsService.onDidChangeCurrentProvider((newProvider) => {
			const currentProvider = services.languageModelsService.currentProvider;
			setCurrentProvider(currentProvider);
		}));

		return () => disposableStore.dispose();
	}, [environment.chatInput, services.languageModelsService]);

	return {
		providers: providers,
		currentProvider: currentProvider,
		...environment,
	};
}
