/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../common/languageModels.js';
import { usePositronChatContext } from './chatContext.js';
import { IAction } from '../../../../../base/common/actions.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { LanguageModelIcon } from '../../../positronAssistant/browser/components/languageModelButton.js';
import { localize } from '../../../../../nls.js';

interface ChatActionBarProps {
	currentModel?: ILanguageModelChatMetadataAndIdentifier;
	width: number;
	onModelSelect: (newLanguageModel: ILanguageModelChatMetadataAndIdentifier) => void;
}

export const ChatActionBar: React.FC<ChatActionBarProps> = ((props) => {
	const positronChatContext = usePositronChatContext();

	const [models, setModels] = React.useState<ILanguageModelChatMetadataAndIdentifier[] | undefined>(positronChatContext.languageModels);
	const [selectorLabel, setSelectorLabel] = React.useState<string>((() => localize('positronChatSelector.unavailable', 'No models available'))());

	const actions = React.useCallback(() => {
		const actions: IAction[] = [];
		models?.forEach((model) => {
			actions.push({
				id: model.identifier,
				label: model.metadata.name,
				enabled: true,
				class: undefined,
				tooltip: `${model.metadata.name} ${model.metadata.version}`,
				run: () => {
					props.onModelSelect(model);
				}
			});
		});

		return actions;
	}, [models, props]);

	React.useEffect(() => {
		setModels(positronChatContext.languageModels);
	}, [positronChatContext.languageModels]);

	React.useEffect(() => {
		if (positronChatContext.currentModel) {
			setSelectorLabel(positronChatContext.currentModel.metadata.name);
		} else if (models?.length) {
			setSelectorLabel((() => localize('positronChatSelector.selectModel', 'Select a model'))());
		} else {
			setSelectorLabel((() => localize('positronChatSelector.unavailable', 'No models available'))());
		}
	}, [positronChatContext.currentModel, models]);

	return (
		<div className='chat-action-bar'>
			<PositronActionBar
				size='small'
			>
				{<LanguageModelIcon provider={positronChatContext.currentModel?.metadata.family ?? ''} />}
				<ActionBarMenuButton
					actions={actions}
					text={selectorLabel}
				/>
			</PositronActionBar>
		</div>
	);
});
