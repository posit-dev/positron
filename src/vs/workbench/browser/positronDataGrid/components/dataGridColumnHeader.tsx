/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridColumnHeader';

// React.
import * as React from 'react';
import { MouseEvent, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { isMacintosh } from 'vs/base/common/platform';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IDataColumn } from 'vs/workbench/browser/positronDataGrid/interfaces/dataColumn';
import { Button, MouseTrigger } from 'vs/base/browser/ui/positronComponents/button/button';
import { selectionType } from 'vs/workbench/browser/positronDataGrid/utilities/mouseUtilities';
import { VerticalSplitter } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { ColumnSelectionState } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

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
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	const mouseDownHandler = async (e: MouseEvent<HTMLElement>) => {
		// Ignore mouse events with meta / ctrl key.
		if (isMacintosh ? e.metaKey : e.ctrlKey) {
			return;
		}

		// Consume the event.
		e.stopPropagation();

		// If selection is enabled, process selection.
		if (context.instance.selection) {
			// Mouse select the column.
			context.instance.mouseSelectColumn(props.columnIndex, selectionType(e));
		}
	};

	/**
	 * dropdownPressed event handler.
	 */
	const dropdownPressed = async () => {
		await context.instance.showColumnContextMenu(sortingButtonRef.current, props.columnIndex);
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
					onResize={async width =>
						await context.instance.setColumnWidth(props.columnIndex, width)
					}
				/>
			}
		</div>
	);
};
