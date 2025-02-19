/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useEffect } from 'react';

import { IAction } from '../../../../../base/common/actions.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { AUX_WINDOW_GROUP_TYPE, ACTIVE_GROUP_TYPE, SIDE_GROUP_TYPE, AUX_WINDOW_GROUP, ACTIVE_GROUP, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { PlotsEditorAction } from '../positronPlotsActions.js';

interface OpenInEditorMenuButtonProps {
	tooltip: string;
	ariaLabel: string;
	defaultGroup: number;
	commandService: ICommandService;
}

interface OpenInEditorCommand {
	editorTarget: AUX_WINDOW_GROUP_TYPE | ACTIVE_GROUP_TYPE | SIDE_GROUP_TYPE;
	label: string;
}

// create an array of action ids with labels
const openInEditorCommands: Array<OpenInEditorCommand> = [
	{
		'editorTarget': AUX_WINDOW_GROUP,
		'label': localize('positron-editor-new-window', 'Open in new window')
	},
	{
		'editorTarget': ACTIVE_GROUP,
		'label': localize('positron-editor-new-tab', 'Open in editor tab')
	},
	{
		'editorTarget': SIDE_GROUP,
		'label': localize('positron-editor-new-tab-right', 'Open in editor tab to the Side')
	},
];

/**
 * OpenInEditorMenuButton component.
 *
 * Creates a menu button that allows the user to open a plot in a new editor tab. Choosing a menu
 * action will update the default action. The default action is preserved by the plots service when
 * opening the editor tab succeeds.
 *
 * @param props An OpenInEditorMenuButtonProps that contains the component properties.
 * @returns
 */
export const OpenInEditorMenuButton = (props: OpenInEditorMenuButtonProps) => {
	const [defaultAction, setDefaultEditorAction] = useState<number>(props.defaultGroup);
	const [actions, setActions] = useState<readonly IAction[]>([]);

	const openEditorPlotHandler = useCallback((groupType: number) => {
		props.commandService.executeCommand(PlotsEditorAction.ID, groupType);
		setDefaultEditorAction(groupType);
	}, [props.commandService]);

	useEffect(() => {
		const actions = openInEditorCommands.map((command) => {
			return {
				id: PlotsEditorAction.ID,
				label: command.label,
				tooltip: '',
				class: undefined,
				checked: defaultAction === command.editorTarget,
				enabled: true,
				run: () => openEditorPlotHandler(command.editorTarget)
			};
		});
		setActions(actions);
	}, [defaultAction, openEditorPlotHandler]);


	return (
		<ActionBarMenuButton
			actions={() => actions}
			ariaLabel={props.ariaLabel}
			dropdownAriaLabel={localize('positron-editor-open-in-editor-dropdown', 'Select where to open plot')}
			dropdownIndicator='enabled-split'
			dropdownTooltip={localize('positron-editor-open-in-editor-dropdown', 'Select where to open plot')}
			iconId='go-to-file'
			tooltip={props.tooltip}
		/>
	);
};
