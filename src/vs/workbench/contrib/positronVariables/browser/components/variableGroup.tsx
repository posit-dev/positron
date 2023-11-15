/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variableGroup';
import * as React from 'react';
import { CSSProperties, MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import * as platform from 'vs/base/common/platform';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { IVariableGroup } from 'vs/workbench/services/positronVariables/common/interfaces/variableGroup';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { IPositronVariablesInstance } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';
import { POSITRON_VARIABLES_COLLAPSE, POSITRON_VARIABLES_EXPAND } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesIdentifiers';

/**
 * VariableGroupProps interface.
 */
interface VariableGroupProps {
	variableGroup: IVariableGroup;
	selected: boolean;
	focused: boolean;
	style: CSSProperties;
	onSelected: () => void;
	onDeselected: () => void;
	onToggleExpandCollapse: () => void;
	positronVariablesInstance: IPositronVariablesInstance;
}

/**
 * VariableGroup component.
 * @param props An VariableGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariableGroup = (props: VariableGroupProps) => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

	/**
	 * MouseDown handler for the row.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const rowMouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Handle the event.
		switch (e.button) {
			// Main button.
			case 0:
				if (props.selected && (platform.isMacintosh ? e.metaKey : e.ctrlKey)) {
					props.onDeselected();
				} else {
					props.onSelected();
					if (platform.isMacintosh && e.ctrlKey) {
						showContextMenu(e.clientX, e.clientY);
					}
				}
				break;

			// Secondary button.
			case 2:
				props.onSelected();
				showContextMenu(e.clientX, e.clientY);
				break;
		}
	};

	/**
	 * MouseDown handler for the chevron.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const chevronMouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();
	};

	/**
	 * MouseUp handler for the chevron.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const chevronMouseUpHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Call the toggle expand / collapse callback.
		props.onToggleExpandCollapse();
	};

	/**
	 * Shows the context menu.
	 * @param x The x coordinate.
	 * @param y The y coordinate.
	 */
	const showContextMenu = (x: number, y: number) => {
		// Build the actions.
		const actions: IAction[] = [];

		// Add the toggle expand / collapse action.
		actions.push({
			id: props.variableGroup.expanded ?
				POSITRON_VARIABLES_COLLAPSE :
				POSITRON_VARIABLES_EXPAND,
			label: props.variableGroup.expanded ?
				nls.localize('positron.variables.collapse', "Collapse") :
				nls.localize('positron.variables.expand', "Expand"),
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => props.onToggleExpandCollapse()
		});

		// Show the context menu.
		positronVariablesContext.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x, y }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	// Create the class names.
	const classNames = positronClassNames(
		'variable-group',
		{
			'selected': props.selected
		},
		{
			'focused': props.focused
		}
	);

	// Render.
	return (
		<div className={classNames} onMouseDown={rowMouseDownHandler} style={props.style}>
			<div className='expand-collapse-area' onMouseDown={chevronMouseDownHandler} onMouseUp={chevronMouseUpHandler}>
				{props.variableGroup.expanded ?
					<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
					<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
				}
			</div>
			<div className='title'>
				{props.variableGroup.title}
			</div>
		</div>
	);
};
