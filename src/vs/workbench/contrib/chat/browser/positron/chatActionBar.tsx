/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import Claude from '../../../positronAssistant/browser/icons/claude.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../common/languageModels.js';
import { usePositronChatContext } from './chatContext.js';
import { IAction } from '../../../../../base/common/actions.js';
import { ModelPickerDelegate } from '../chatInputPart.js';
import Gemini from '../../../positronAssistant/browser/icons/gemini.js';
import Bedrock from '../../../positronAssistant/browser/icons/bedrockColor.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';

interface ChatActionBarProps {
	currentModel?: ILanguageModelChatMetadataAndIdentifier;
	delegate: ModelPickerDelegate;
	width: number;
	onModelSelect: (newLanguageModel: ILanguageModelChatMetadataAndIdentifier) => void;
}

export const ChatActionBar: React.FC<ChatActionBarProps> = ((props) => {
	const positronChatContext = usePositronChatContext();

	const [model, setModel] = React.useState<ILanguageModelChatMetadataAndIdentifier>();
	const [models, setModels] = React.useState<ILanguageModelChatMetadataAndIdentifier[] | undefined>(positronChatContext.languageModels);

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
		if (!models || models.length === 0 || !models.find((m) => m.identifier === model?.identifier)) {
			setModel(undefined);
		}
	}, [models, model]);

	React.useEffect(() => {
		setModels(positronChatContext.languageModels);
	}, [positronChatContext.languageModels]);

	React.useEffect(() => {
		props.delegate.onDidChangeModel((newModel) => setModel(newModel));
	}, [props.delegate])

	const getIcon = () => {
		switch (model?.metadata.family) {
			case 'bedrock':
				return <Bedrock />;
			case 'anthropic':
				return <Claude />;
			case 'google':
				return <Gemini />;
			case 'echo':
				return <div className={`icon codicon codicon-error`} />;
			default:
				return null;
		}
	}

	return (
		<div className='chat-action-bar'>
			<PositronActionBar
				size='small'
			>
				{getIcon()}
				<ActionBarMenuButton
					actions={actions}
					text={model?.metadata.name ?? 'No models available'}
				/>
			</PositronActionBar>
		</div>
	);
});
