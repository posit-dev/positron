/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableItem';
import * as React from 'react';
import { CSSProperties, MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import * as nls from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { ColumnSplitter } from 'vs/workbench/contrib/positronEnvironment/browser/components/columnSplitter';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';
import { POSITRON_ENVIRONMENT_COLLAPSE, POSITRON_ENVIRONMENT_COPY_AS_HTML, POSITRON_ENVIRONMENT_COPY_AS_TEXT, POSITRON_ENVIRONMENT_EXPAND } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentIdentifiers';

/**
 * EnvironmentVariableItemProps interface.
 */
export interface EnvironmentVariableItemProps {
	nameColumnWidth: number;
	detailsColumnWidth: number;
	typeVisible: boolean;
	environmentVariableItem: IEnvironmentVariableItem;
	selected: boolean;
	focused: boolean;
	style: CSSProperties;
	onSelected: () => void;
	onToggleExpandCollapse: () => void;
	onStartResizeNameColumn: () => void;
	onResizeNameColumn: (x: number, y: number) => void;
	onStopResizeNameColumn: (x: number, y: number) => void;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableItem component.
 * @param props A EnvironmentVariableItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableItem = (props: EnvironmentVariableItemProps) => {
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
				// Call the selected callback.
				props.onSelected();
				break;

			// Secondary button.
			case 2:
				// Show the context menu.
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
		// Process the event if the environment variable item has children.
		if (props.environmentVariableItem.hasChildren) {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();
		}
	};

	/**
	 * MouseUp handler for the chevron.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const chevronMouseUpHandler = (e: MouseEvent<HTMLElement>) => {
		// Process the event if the environment variable item has children.
		if (props.environmentVariableItem.hasChildren) {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Call the toggle expand / collapse callback.
			props.onToggleExpandCollapse();
		}
	};

	/**
	 * Shows the context menu.
	 */
	const showContextMenu = (x: number, y: number) => {
		// Build the actions.
		const actions: IAction[] = [];

		// Add the toggle expand / collapse action.
		actions.push({
			id: props.environmentVariableItem.expanded ?
				POSITRON_ENVIRONMENT_COLLAPSE :
				POSITRON_ENVIRONMENT_EXPAND,
			label: props.environmentVariableItem.expanded ?
				nls.localize('positron.environment.collapse', "Collapse") :
				nls.localize('positron.environment.expand', "Expand"),
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => props.onToggleExpandCollapse()
		});

		// Push a separator.
		actions.push(new Separator());

		// Add the copy name action.
		actions.push({
			id: 'copy-name',
			label: 'Copy Name',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => positronEnvironmentContext.clipboardService.writeText(
				props.environmentVariableItem.displayName
			)
		});

		// Push a separator.
		actions.push(new Separator());

		// Add the copy as text action.
		actions.push({
			id: POSITRON_ENVIRONMENT_COPY_AS_TEXT,
			label: 'Copy as Text',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: async () => {
				const text = await props.environmentVariableItem.formatForClipboard('text/plain');
				positronEnvironmentContext.clipboardService.writeText(text);
			}
		} as IAction);

		// Add the copy as HTML action.
		actions.push({
			id: POSITRON_ENVIRONMENT_COPY_AS_HTML,
			label: 'Copy as HTML',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: async () => {
				const text = await props.environmentVariableItem.formatForClipboard('text/html');
				positronEnvironmentContext.clipboardService.writeText(text);
			}
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
		'environment-variable',
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
			<div className='name-column' style={{ width: props.nameColumnWidth, minWidth: props.nameColumnWidth }}>
				<div style={{ display: 'flex', marginLeft: props.environmentVariableItem.indentLevel * 20 }}>
					<div className='gutter'>
						<div className='expand-collapse-area' onMouseDown={chevronMouseDownHandler} onMouseUp={chevronMouseUpHandler} >
							{props.environmentVariableItem.hasChildren && (
								props.environmentVariableItem.expanded ?
									<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
									<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
							)}

						</div>
					</div>
					<div className='name-value'>
						{props.environmentVariableItem.displayName}
					</div>
				</div>
			</div>
			<ColumnSplitter
				onStartResize={props.onStartResizeNameColumn}
				onResize={props.onResizeNameColumn}
				onStopResize={props.onStopResizeNameColumn} />
			<div className='details-column' style={{ width: props.detailsColumnWidth - 5, minWidth: props.detailsColumnWidth - 5 }}>
				<div className='value'>
					{props.environmentVariableItem.displayValue}
				</div>
				{props.typeVisible && (
					<div className='type'>
						{props.environmentVariableItem.displayType}
					</div>
				)}
			</div>
		</div>
	);
};
