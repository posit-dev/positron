/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variableItem.css';

// React.
import React, { CSSProperties, MouseEvent, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { isNumber } from '../../../../../base/common/types.js';
import * as platform from '../../../../../base/common/platform.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { IVariableItem } from '../../../../services/positronVariables/common/interfaces/variableItem.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { VerticalSplitter, VerticalSplitterResizeParams } from '../../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { IPositronVariablesInstance, PositronVariablesSorting } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { POSITRON_VARIABLES_COLLAPSE, POSITRON_VARIABLES_COPY_AS_HTML, POSITRON_VARIABLES_COPY_AS_TEXT, POSITRON_VARIABLES_EXPAND, POSITRON_VARIABLES_VIEW } from '../positronVariablesIdentifiers.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';

/**
 * Formats a size for display.
 * @param size The size to format.
 * @returns The formatted size.
 */
export const formatSize = (size: number) => {
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
	disabled: boolean;
	style: CSSProperties;
	onSelected: () => void;
	onDeselected: () => void;
	onToggleExpandCollapse: () => void;
	onBeginResizeNameColumn: () => VerticalSplitterResizeParams;
	onResizeNameColumn: (newNameColumnWidth: number) => void;
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
	 * State hooks.
	 */
	const [isRecent, setIsRecent] = useState(props.variableItem.isRecent.get());

	useEffect(() => {
		const disposableStore = new DisposableStore();
		const evt = Event.fromObservable(props.variableItem.isRecent, disposableStore);
		evt(e => setIsRecent(e));
		return () => disposableStore.dispose();
	}, [props.variableItem]);

	/**
	 * Opens a viewer for the variable item, or activates the existing viewer
	 * if one is already open.
	 *
	 * @param item The variable item to view or open.
	 */
	const viewVariableItem = async (item: IVariableItem) => {
		// Check for an existing viewer instance.
		const explorerService = positronVariablesContext.dataExplorerService;
		const instance = explorerService.getInstanceForVar(item.id);
		if (instance) {
			// There's an existing viewer instance, so activate it.
			instance.requestFocus();
		} else {
			// Open a viewer for the variable item.
			let viewerId: string | undefined;
			try {
				viewerId = await item.view();
			} catch (err) {
				positronVariablesContext.notificationService.error(localize(
					'positron.variables.viewerError',
					"An error occurred while opening the viewer. Try restarting your session."
				));
			}

			// If a binding was returned, save the binding between the viewer and the variable item.
			if (viewerId) {
				explorerService.setInstanceForVar(viewerId, item.id);
			}
		}
	};

	/**
	 * onDoubleClick handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const doubleClickHandler = (e: MouseEvent<HTMLElement>) => {
		// Ignore if disabled.
		if (props.disabled) {
			return;
		}

		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// If the variable item has a viewer, launch it.
		if (props.variableItem.hasViewer) {
			viewVariableItem(props.variableItem);
		}
	};

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Ignore if disabled.
		if (props.disabled) {
			return;
		}

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
		// Ignore if disabled.
		if (props.disabled) {
			return;
		}

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
		// Ignore if disabled.
		if (props.disabled) {
			return;
		}

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
		// Ignore if disabled.
		if (props.disabled) {
			return;
		}

		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Launch the viewer.
		viewVariableItem(props.variableItem);
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
		if (!props.disabled && props.variableItem.hasViewer) {
			actions.push({
				id: POSITRON_VARIABLES_VIEW,
				label: localize('positron.variables.view', "View"),
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => viewVariableItem(props.variableItem)
			});
		}

		// If the variable item has children, add the toggle expand / collapse action.
		if (!props.disabled && props.variableItem.hasChildren) {
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

		// Add copy value actions, if we're not disabled.
		if (!props.disabled) {
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
		}

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
		},
		{
			'disabled': props.disabled
		},
		{
			'recent': isRecent
		}
	);

	/**
	 * RightColumn component.
	 * @returns The rendered component.
	 */
	const RightColumn = () => {
		if (!props.disabled && props.variableItem.hasViewer) {
			let icon = 'codicon codicon-open-preview';
			if (props.variableItem.kind === 'table') {
				icon = 'codicon codicon-table';
			} else if (props.variableItem.kind === 'connection') {
				icon = 'codicon codicon-database';
			}
			icon = 'viewer-icon ' + icon + ' ' + props.variableItem.kind;

			return (
				<div className='right-column'>
					<div
						className={icon}
						onMouseDown={viewerMouseDownHandler}
						title={localize('positron.variables.clickToView', "Click to view")}
					></div>
				</div>
			);
		} else if (props.rightColumnVisible) {
			if (props.positronVariablesInstance.sorting === PositronVariablesSorting.Size) {
				return (
					<div className='right-column'>
						<span>{formatSize(props.variableItem.size)}</span>
					</div>
				);
			} else {
				return (
					<div className='right-column'>
						<span>{props.variableItem.displayType}</span>
					</div>
				);
			}
		} else {
			return null;
		}
	};

	// Render.
	return (
		<div className={classNames} style={props.style} onDoubleClick={doubleClickHandler} onMouseDown={mouseDownHandler}>
			<div className='name-column' style={{ width: props.nameColumnWidth, minWidth: props.nameColumnWidth }}>
				<div className='name-column-indenter' style={{ marginLeft: props.variableItem.indentLevel * 20 }}>
					<div className='gutter'>
						<div className='expand-collapse-area' onMouseDown={chevronMouseDownHandler} onMouseUp={chevronMouseUpHandler} >
							{!props.disabled &&
								props.variableItem.hasChildren && (
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
			<VerticalSplitter
				configurationService={positronVariablesContext.configurationService}
				onBeginResize={props.onBeginResizeNameColumn}
				onResize={props.onResizeNameColumn}
			/>
			<div className='details-column' style={{ width: props.detailsColumnWidth - 6, minWidth: props.detailsColumnWidth - 6 }}>
				<div className='value'>
					{props.variableItem.displayValue}
				</div>
				<RightColumn />
			</div>
		</div>
	);
};
