/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridColumnHeader';

// React.
import * as React from 'react';
import { MouseEvent, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { showContextMenu } from 'vs/base/browser/ui/contextMenu/contextMenu';
import { IDataColumn } from 'vs/base/browser/ui/dataGrid/interfaces/dataColumn';
import { useDataGridContext } from 'vs/base/browser/ui/dataGrid/dataGridContext';
import { ContextMenuItem } from 'vs/base/browser/ui/contextMenu/contextMenuItem';
import { selectionType } from 'vs/base/browser/ui/dataGrid/utilities/mouseUtilities';
import { SelectionState } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';
import { ContextMenuSeparator } from 'vs/base/browser/ui/contextMenu/contextMenuSeparator';
import { MouseTrigger, PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { PositronColumnSplitter } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';

/**
 * Localized strings.
 */
const sortAscendingTitle = localize('positron.sortAscending', "Sort Ascending");
const sortDescendingTitle = localize('positron.sortDescending', "Sort Descending");
const removeSortTitle = localize('positron.removeSort', "Remove Sort");
const copyColumnTitle = localize('positron.copyColumn', "Copy Column");

/**
 * DataGridColumnHeaderProps interface.
 */
interface DataGridColumnHeaderProps {
	column: IDataColumn;
	columnIndex: number;
	left: number;
}

/**
 * DataGridColumnHeader component.
 * @param props A DataGridColumnHeaderProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridColumnHeader = (props: DataGridColumnHeaderProps) => {
	// Context hooks.
	const context = useDataGridContext();

	// Reference hooks.
	const columnsPanelRef = useRef<HTMLDivElement>(undefined!);

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Mouse select the column.
		context.instance.mouseSelectColumn(props.columnIndex, selectionType(e));
	};

	/**
	 * dropdownPressed event handler.
	 */
	const dropdownPressed = async () => {
		/**
		 * Get the column sort key for the column.
		 */
		const columnSortKey = context.instance.columnSortKey(props.columnIndex);

		// Show the context menu.
		await showContextMenu({
			layoutService: context.layoutService,
			anchorElement: columnsPanelRef.current,
			width: 200,
			entries: [
				new ContextMenuItem({
					checked: columnSortKey !== undefined && columnSortKey.ascending,
					label: sortAscendingTitle,
					icon: 'arrow-up',
					onSelected: async () => context.instance.setColumnSortKey(
						props.columnIndex,
						true
					)
				}),
				new ContextMenuItem({
					checked: columnSortKey !== undefined && !columnSortKey.ascending,
					label: sortDescendingTitle,
					icon: 'arrow-down',
					onSelected: async () => context.instance.setColumnSortKey(
						props.columnIndex,
						false
					)
				}),
				new ContextMenuSeparator(),
				new ContextMenuItem({
					checked: false,
					label: removeSortTitle,
					disabled: !columnSortKey,
					onSelected: async () =>
						context.instance.removeColumnSortKey(props.columnIndex)
				}),
				new ContextMenuSeparator(),
				new ContextMenuItem({
					checked: false,
					label: copyColumnTitle,
					disabled: true,
					icon: 'copy',
					onSelected: () => console.log('Copy')
				}),
			]
		});
	};

	// Get the column sort key.
	const columnSortKey = context.instance.columnSortKey(props.columnIndex);

	// Get the column selection state.
	const columnSelectionState = context.instance.columnSelectionState(props.columnIndex);

	// Render.
	return (
		<div
			className={
				positronClassNames(
					'data-grid-column-header',
					{ 'selected': columnSelectionState & SelectionState.Selected }
				)}
			style={{
				left: props.left,
				width: props.column.width
			}}
			onMouseDown={mouseDownHandler}
		>
			<div className={
				positronClassNames(
					'border-overlay',
					{ 'selected': columnSelectionState & SelectionState.Selected },
					{ 'selected-left': columnSelectionState & SelectionState.FirstSelected },
					{ 'selected-right': columnSelectionState & SelectionState.LastSelected }
				)}
			/>
			<div className='content'>
				<div className='title-description'>
					<div className='title'>{props.column.name}</div>
					{props.column.description &&
						<div className='description'>{props.column.description}</div>
					}
				</div>
				{columnSortKey &&
					<div className='sort-indicator'>
						<div
							className={positronClassNames(
								'sort-icon',
								'codicon',
								columnSortKey.ascending ?
									'codicon-arrow-up' :
									'codicon-arrow-down'
							)}
							style={{ fontSize: 16 }}
						/>
						<div className='sort-index'>{columnSortKey.sortIndex + 1}</div>
					</div>
				}
				<PositronButton
					ref={columnsPanelRef}
					className='button'
					mouseTrigger={MouseTrigger.MouseDown}
					onPressed={dropdownPressed}
				>
					<div className='codicon codicon-positron-vertical-ellipsis' style={{ fontSize: 18 }} />
				</PositronButton>
			</div>

			<PositronColumnSplitter
				onBeginResize={() => ({
					minimumWidth: context.instance.minimumColumnWidth,
					maximumWidth: 400,
					startingWidth: props.column.width
				})}
				onResize={width =>
					context.instance.setColumnWidth(props.columnIndex, width)
				}
			/>
		</div>
	);
};
