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

interface ChatActionBarProps {
	currentModel?: ILanguageModelChatMetadataAndIdentifier;
	delegate: ModelPickerDelegate;
	width: number;
	onModelSelect: (newLanguageModel: ILanguageModelChatMetadataAndIdentifier) => void;
}

export const ChatActionBar: React.FC<ChatActionBarProps> = ((props) => {
	const positronChatContext = usePositronChatContext();

	const [model, setModel] = React.useState<ILanguageModelChatMetadataAndIdentifier>();

	const actions = React.useCallback(() => {
		const actions: IAction[] = [];
		positronChatContext.languageModels?.forEach((model) => {
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
	}, [positronChatContext.languageModels, props]);

	React.useEffect(() => {
		props.delegate.onDidChangeModel((newModel) => setModel(newModel));
	})

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
			{getIcon()}
			<ActionBarMenuButton
				actions={actions}
				text={model?.metadata.name ?? 'Loading models...'}
			/>
		</div>
	);
});
