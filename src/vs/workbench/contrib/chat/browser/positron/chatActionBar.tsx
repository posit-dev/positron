/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronChatContext } from './chatContext.js';
import { IAction } from '../../../../../base/common/actions.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { LanguageModelIcon } from '../../../positronAssistant/browser/components/languageModelButton.js';
import { localize } from '../../../../../nls.js';
import { IPositronChatProvider } from '../../common/languageModels.js';

interface ChatActionBarProps {
	width: number;
	onModelSelect: (newLanguageModel: IPositronChatProvider | undefined) => void;
}

export const ChatActionBar: React.FC<ChatActionBarProps> = ((props) => {
	const positronChatContext = usePositronChatContext();

	const [providers, setProviders] = React.useState<IPositronChatProvider[] | undefined>(positronChatContext.providers)
	const [selectorLabel, setSelectorLabel] = React.useState<string>((() => localize('positronChatSelector.unavailable', 'No providers available'))());

	const actions = React.useCallback(() => {
		const actions: IAction[] = [
			{
				id: 'all-models',
				label: (() => localize('positronChatSelector.allModels', 'All Models'))(),
				enabled: true,
				class: undefined,
				tooltip: (() => localize('positronChatSelector.allModelsTooltip', 'Select a model'))(),
				run: () => {
					props.onModelSelect(undefined);
				}
			}
		];
		providers?.forEach((provider) => {
			actions.push({
				id: provider.id,
				label: provider.displayName,
				enabled: true,
				class: undefined,
				tooltip: `${provider.displayName}`,
				run: () => {
					props.onModelSelect(provider);
				}
			});
		});

		return actions;
	}, [providers,]);

	React.useEffect(() => {
		if (positronChatContext.currentProvider) {
			setSelectorLabel(positronChatContext.currentProvider.displayName);
		} else if (providers?.length && positronChatContext.currentProvider === undefined) {
			setSelectorLabel((() => localize('positronChatSelector.allModels', 'All Models'))());
		} else {
			setSelectorLabel((() => localize('positronChatSelector.unavailable', 'No providers available'))());
		}
	}, [positronChatContext.currentProvider, providers]);

	React.useEffect(() => {
		setProviders(positronChatContext.providers);
	}, [positronChatContext.providers]);

	return (
		<div className='chat-action-bar'>
			<PositronActionBar
				size='small'
			>
				{<LanguageModelIcon provider={positronChatContext.currentProvider?.id ?? ''} />}
				<ActionBarMenuButton
					actions={actions}
					text={selectorLabel}
				/>
			</PositronActionBar>
		</div>
	);
});
