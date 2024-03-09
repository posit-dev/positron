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
import { showContextMenu } from 'vs/base/browser/ui/positronComponents/contextMenu/contextMenu';
import { ContextMenuItem } from 'vs/base/browser/ui/positronComponents/contextMenu/contextMenuItem';
import { IDataColumn } from 'vs/base/browser/ui/positronDataGrid/interfaces/dataColumn';
import { VerticalSplitter } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { ContextMenuSeparator } from 'vs/base/browser/ui/positronComponents/contextMenu/contextMenuSeparator';
import { selectionType } from 'vs/base/browser/ui/positronDataGrid/utilities/mouseUtilities';
import { ColumnSelectionState } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { usePositronDataGridContext } from 'vs/base/browser/ui/positronDataGrid/positronDataGridContext';
import { Button, MouseTrigger } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * Localized strings.
 */
const sortAscendingTitle = localize('positron.sortAscending', "Sort Ascending");
const sortDescendingTitle = localize('positron.sortDescending', "Sort Descending");
const clearSortingTitle = localize('positron.clearSorting', "Clear Sorting");
const copyColumnTitle = localize('positron.copyColumn', "Copy Column");

/**
 * DataGridColumnHeaderProps interface.
 */
interface DataGridColumnHeaderProps {
	column?: IDataColumn;
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
	const context = usePositronDataGridContext();

	// Reference hooks.
	const sortingButtonRef = useRef<HTMLButtonElement>(undefined!);

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
			anchorElement: sortingButtonRef.current,
			alignment: 'right',
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
					label: clearSortingTitle,
					disabled: !columnSortKey,
					icon: 'positron-clear-sorting',
					onSelected: async () =>
						context.instance.removeColumnSortKey(props.columnIndex)
				}),
				new ContextMenuSeparator(),
				new ContextMenuItem({
					checked: false,
					label: copyColumnTitle,
					disabled: false,
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
					{ 'selected': columnSelectionState & ColumnSelectionState.Selected }
				)}
			style={{
				left: props.left,
				width: context.instance.getColumnWidth(props.columnIndex)
			}}
			onMouseDown={mouseDownHandler}
		>
			<div className={
				positronClassNames(
					'border-overlay',
					{ 'selected': columnSelectionState & ColumnSelectionState.Selected },
					{ 'selected-left': columnSelectionState & ColumnSelectionState.SelectedLeft },
					{ 'selected-right': columnSelectionState & ColumnSelectionState.SelectedRight }
				)}
			/>
			<div className='content'>
				<div className='title-description'>
					<div className='title'>{props.column?.name}</div>
					{props.column?.description &&
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
				<Button
					ref={sortingButtonRef}
					className='sort-button'
					mouseTrigger={MouseTrigger.MouseDown}
					onPressed={dropdownPressed}
				>
					<div className='codicon codicon-positron-vertical-ellipsis' style={{ fontSize: 18 }} />
				</Button>
			</div>

			{context.instance.columnResize &&
				<VerticalSplitter
					onBeginResize={() => ({
						minimumWidth: context.instance.minimumColumnWidth,
						maximumWidth: 400,
						startingWidth: context.instance.getColumnWidth(props.columnIndex)
					})}
					onResize={width =>
						context.instance.setColumnWidth(props.columnIndex, width)
					}
				/>
			}
		</div>
	);
};
