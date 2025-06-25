/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronChatContext } from './chatContext.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { LanguageModelIcon } from '../../../positronAssistant/browser/components/languageModelButton.js';
import { localize } from '../../../../../nls.js';
import { IPositronChatProvider } from '../../common/languageModels.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';

interface ChatActionBarProps {
	width: number;
	onModelSelect: (newLanguageModel: IPositronChatProvider | undefined) => void;
}

const addChatModelProviderLabel = () => localize('positronChatSelector.addChatModelProvider', 'Add Chat Model Provider...');
const addCompletionsModelProviderLabel = () => localize('positronChatSelector.addCompletionsModelProvider', 'Add Completions Model Provider...');
const configureModelProvidersLabel = () => localize('positronChatSelector.configureModelProviders', 'Configure All Model Providers...');
const addModelProviderTooltip = () => localize('positronChatSelector.addModelProviderTooltip', 'Add a Chat Model Provider');

export const ChatActionBar: React.FC<ChatActionBarProps> = ((props) => {
	const positronActionBarContext = usePositronActionBarContext();
	const positronChatContext = usePositronChatContext();
	const { providers, currentProvider } = positronChatContext;

	const actions = React.useCallback(() => {
		const providerActions: IAction[] = [];
		providers?.forEach((provider) => {
			// Skip the current provider -- it's already selected.
			if (currentProvider && currentProvider.id === provider.id) {
				return;
			}

			providerActions.push({
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

		const otherActions = [
			{
				id: 'add-chat-model-provider',
				label: addChatModelProviderLabel(),
				enabled: true,
				class: undefined,
				tooltip: addModelProviderTooltip(),
				run: async () => {
					await positronActionBarContext.commandService.executeCommand('positron-assistant.configureChatModels');
				}
			},
			{
				id: 'add-completion-model-provider',
				label: addCompletionsModelProviderLabel(),
				enabled: true,
				class: undefined,
				tooltip: addModelProviderTooltip(),
				run: async () => {
					await positronActionBarContext.commandService.executeCommand('positron-assistant.configureCompletionModels');
				}
			},
			{
				id: 'configure-model-providers',
				label: configureModelProvidersLabel(),
				enabled: true,
				class: undefined,
				tooltip: addModelProviderTooltip(),
				run: async () => {
					await positronActionBarContext.commandService.executeCommand('positron-assistant.configureModels');
				}
			},
		];

		return Separator.join(providerActions, otherActions);
	}, [props, providers, currentProvider, positronActionBarContext.commandService]);

	const renderCurrentProvider = () => {
		if (!currentProvider) {
			return <ActionBarButton
				label={addChatModelProviderLabel()}
				tooltip={addModelProviderTooltip()}
				onPressed={async () => {
					await positronActionBarContext.commandService.executeCommand('positron-assistant.configureChatModels');
				}}
			/>;
		}
		return <>
			<LanguageModelIcon provider={positronChatContext.currentProvider?.id ?? ''} />
			<ActionBarMenuButton
				actions={actions}
				label={currentProvider.displayName}
			/>
		</>
	};

	return (
		<div className='chat-action-bar'>
			<PositronActionBar>
				{renderCurrentProvider()}
			</PositronActionBar>
		</div>
	);
});
