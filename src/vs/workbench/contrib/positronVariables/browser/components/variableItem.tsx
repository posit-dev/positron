/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variableItem';
import * as React from 'react';
import { CSSProperties, MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { isNumber } from 'vs/base/common/types';
import * as platform from 'vs/base/common/platform';
import { IAction, Separator } from 'vs/base/common/actions';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { IVariableItem } from 'vs/workbench/services/positronVariables/common/interfaces/variableItem';
import { ColumnSplitter } from 'vs/workbench/contrib/positronVariables/browser/components/columnSplitter';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { IPositronVariablesInstance, PositronVariablesSorting } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';
import { POSITRON_VARIABLES_COLLAPSE, POSITRON_VARIABLES_COPY_AS_HTML, POSITRON_VARIABLES_COPY_AS_TEXT, POSITRON_VARIABLES_EXPAND, POSITRON_VARIABLES_VIEW } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesIdentifiers';

/**
 * Formats a size for display.
 * @param size The size to format.
 * @returns The formatted size.
 */
const formatSize = (size: number) => {
	// Sizes.
	const KB = 1024;
	const MB = KB * KB;
	const GB = MB * KB;
	const TB = GB * KB;

	// If the value isn't a number, set the size to 0.
	if (!isNumber(size)) {
		size = 0;
	}

	// < KB.
	if (size < KB) {
		if (size === 1) {
			return localize('positron.sizeByte', "{0} Byte", size.toFixed(0));
		} else {
			return localize('positron.sizeBytes', "{0} Bytes", size.toFixed(0));
		}
	}

	// < MB.
	if (size < MB) {
		return localize('positron.sizeKB', "{0} KB", (size / KB).toFixed(2));
	}

	// < GB.
	if (size < GB) {
		return localize('positron.sizeMB', "{0} MB", (size / MB).toFixed(2));
	}

	// < TB.
	if (size < TB) {
		return localize('positron.sizeGB', "{0} GB", (size / GB).toFixed(2));
	}

	// >= TB.
	return localize('positron.sizeTB', "{0} TB", (size / TB).toFixed(2));
};

/**
 * VariableItemProps interface.
 */
export interface VariableItemProps {
	nameColumnWidth: number;
	detailsColumnWidth: number;
	rightColumnVisible: boolean;
	variableItem: IVariableItem;
	selected: boolean;
	focused: boolean;
	style: CSSProperties;
	onSelected: () => void;
	onDeselected: () => void;
	onToggleExpandCollapse: () => void;
	onStartResizeNameColumn: () => void;
	onResizeNameColumn: (x: number, y: number) => void;
	onStopResizeNameColumn: (x: number, y: number) => void;
	positronVariablesInstance: IPositronVariablesInstance;
}

/**
 * VariableItem component.
 * @param props A VariableItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariableItem = (props: VariableItemProps) => {
	/**
	 * Context hooks.
	 */
	const positronVariablesContext = usePositronVariablesContext();

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
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
		// Process the event if the variable item has children.
		if (props.variableItem.hasChildren) {
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
		// Process the event if the variable item has children.
		if (props.variableItem.hasChildren) {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Call the toggle expand / collapse callback.
			props.onToggleExpandCollapse();
		}
	};

	/**
	 * MouseDown handler for the viewer icon.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const viewerMouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Launch the viewer.
		props.variableItem.view();
	};

	/**
	 * Shows the context menu.
	 * @param x The x coordinate.
	 * @param y The y coordinate.
	 */
	const showContextMenu = (x: number, y: number) => {
		// Build the actions.
		const actions: IAction[] = [];

		// If this is a table, add an action to view it.
		if (props.variableItem.hasViewer) {
			actions.push({
				id: POSITRON_VARIABLES_VIEW,
				label: localize('positron.variables.view', "View"),
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => props.variableItem.view()
			});
		}

		// If the variable item has children, add the toggle expand / collapse action.
		if (props.variableItem.hasChildren) {
			// Push a separator, if there are actions above this action.
			if (actions.length) {
				actions.push(new Separator());
			}

			// Push the expand or collapse action.
			if (props.variableItem.expanded) {
				actions.push({
					id: POSITRON_VARIABLES_COLLAPSE,
					label: localize('positron.variables.collapse', "Collapse"),
					tooltip: '',
					class: undefined,
					enabled: true,
					run: () => props.onToggleExpandCollapse()
				});
			} else {
				actions.push({
					id: POSITRON_VARIABLES_EXPAND,
					label: localize('positron.variables.expand', "Expand"),
					tooltip: '',
					class: undefined,
					enabled: true,
					run: () => props.onToggleExpandCollapse()
				});
			}

			// Push a separator.
			actions.push(new Separator());
		}

		// Add the copy name action.
		actions.push({
			id: 'copy-name',
			label: 'Copy Name',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => positronVariablesContext.clipboardService.writeText(
				props.variableItem.displayName
			)
		});

		// Push a separator.
		actions.push(new Separator());

		// Add the copy as text action.
		actions.push({
			id: POSITRON_VARIABLES_COPY_AS_TEXT,
			label: 'Copy as Text',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: async () => {
				const text = await props.variableItem.formatForClipboard('text/plain');
				positronVariablesContext.clipboardService.writeText(text);
			}
		} as IAction);

		// Add the copy as HTML action.
		actions.push({
			id: POSITRON_VARIABLES_COPY_AS_HTML,
			label: 'Copy as HTML',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: async () => {
				const text = await props.variableItem.formatForClipboard('text/html');
				positronVariablesContext.clipboardService.writeText(text);
			}
		} satisfies IAction);

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
		'variable-item',
		{
			'selected': props.selected
		},
		{
			'focused': props.focused
		}
	);

	/**
	 * RightColumn component.
	 * @returns The rendered component.
	 */
	const RightColumn = () => {
		if (props.variableItem.hasViewer) {
			return (
				<div className='right-column'>
					<div className='viewer-icon codicon codicon-table' onMouseDown={viewerMouseDownHandler}></div>
				</div>
			);
		} else if (props.rightColumnVisible) {
			if (props.positronVariablesInstance.sorting === PositronVariablesSorting.Name) {
				return (
					<div className='right-column'>
						<span>{props.variableItem.displayType}</span>
					</div>
				);
			} else {
				return (
					<div className='right-column'>
						<span>{formatSize(props.variableItem.size)}</span>
					</div>
				);
			}
		} else {
			return null;
		}
	};

	// Render.
	return (
		<div className={classNames} onMouseDown={mouseDownHandler} style={props.style}>
			<div className='name-column' style={{ width: props.nameColumnWidth, minWidth: props.nameColumnWidth }}>
				<div className='name-column-indenter' style={{ marginLeft: props.variableItem.indentLevel * 20 }}>
					<div className='gutter'>
						<div className='expand-collapse-area' onMouseDown={chevronMouseDownHandler} onMouseUp={chevronMouseUpHandler} >
							{props.variableItem.hasChildren && (
								props.variableItem.expanded ?
									<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
									<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
							)}
						</div>
					</div>
					<div className='name-value'>
						{props.variableItem.displayName}
					</div>
				</div>
			</div>
			<ColumnSplitter
				onStartResize={props.onStartResizeNameColumn}
				onResize={props.onResizeNameColumn}
				onStopResize={props.onStopResizeNameColumn} />
			<div className='details-column' style={{ width: props.detailsColumnWidth - 6, minWidth: props.detailsColumnWidth - 6 }}>
				<div className='value'>
					{props.variableItem.displayValue}
				</div>
				<RightColumn />
			</div>
		</div>
	);
};
