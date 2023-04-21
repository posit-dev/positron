/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableGroup';
import * as React from 'react';
import { CSSProperties, MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import * as platform from 'vs/base/common/platform';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';
import { POSITRON_ENVIRONMENT_COLLAPSE, POSITRON_ENVIRONMENT_EXPAND } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentIdentifiers';

/**
 * EnvironmentVariableGroupProps interface.
 */
interface EnvironmentVariableGroupProps {
	environmentVariableGroup: IEnvironmentVariableGroup;
	selected: boolean;
	focused: boolean;
	style: CSSProperties;
	onSelected: () => void;
	onDeselected: () => void;
	onToggleExpandCollapse: () => void;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableGroup component.
 * @param props An EnvironmentVariableGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableGroup = (props: EnvironmentVariableGroupProps) => {
	// Context hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

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
	 */
	const showContextMenu = (x: number, y: number) => {
		// Build the actions.
		const actions: IAction[] = [];

		// Add the toggle expand / collapse action.
		actions.push({
			id: props.environmentVariableGroup.expanded ?
				POSITRON_ENVIRONMENT_COLLAPSE :
				POSITRON_ENVIRONMENT_EXPAND,
			label: props.environmentVariableGroup.expanded ?
				nls.localize('positron.environment.collapse', "Collapse") :
				nls.localize('positron.environment.expand', "Expand"),
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => props.onToggleExpandCollapse()
		});

		// Show the context menu.
		positronEnvironmentContext.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x, y }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	// Create the class names.
	const classNames = positronClassNames(
		'environment-variable-group',
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
				{props.environmentVariableGroup.expanded ?
					<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
					<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
				}
			</div>
			<div className='title'>
				{props.environmentVariableGroup.title}
			</div>
		</div>
	);
};
