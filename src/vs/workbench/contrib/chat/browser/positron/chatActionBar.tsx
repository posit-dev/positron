/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { DynamicActionBarAction, PositronDynamicActionBar } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';
import Claude from '../../../positronAssistant/browser/icons/claude.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../common/languageModels.js';
import { usePositronChatContext } from './chatContext.js';
import { IAction } from '../../../../../base/common/actions.js';

interface ChatActionBarProps {
	currentModel?: ILanguageModelChatMetadataAndIdentifier;
	width: number;
}

export const ChatActionBar: React.FC<ChatActionBarProps> = ((props) => {
	const positronChatContext = usePositronChatContext();

	const [languageModelActions, setLanguageModelActions] = React.useState<IAction[]>([]);
	const leftActions: DynamicActionBarAction[] = [];

	React.useEffect(() => {
		const actions: IAction[] = [];
		positronChatContext.languageModels?.forEach((model) => {
			actions.push({
				id: model.identifier,
				label: model.metadata.name,
				enabled: true,
				class: undefined,
				tooltip: `${model.metadata.name} ${model.metadata.version}`,
				run: () => {
					console.log(`Selected model: ${model.metadata.name}`);
				}
			});
			setLanguageModelActions(actions);
		});
	}, [positronChatContext.languageModels]);

	// Function to get actions for the action bar menu button.
	// Returns an empty array of IAction
	const getActions = () => {
		return languageModelActions;
	}

	leftActions.push({
		fixedWidth: props.width ?? 100,
		separator: false,
		component: (
			<>
				<Claude />
				<ActionBarMenuButton
					actions={() => getActions()}
					text={props.currentModel?.identifier ?? 'Select Model'}
				/>
			</>
		)
	})

	return (
		<PositronDynamicActionBar
			borderBottom={true}
			leftActions={leftActions}
			rightActions={[]}
			size='small'
		/>
	);
});
