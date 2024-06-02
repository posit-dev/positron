/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRowCell';

// React.
import * as React from 'react';
import { MouseEvent, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { selectionType } from 'vs/workbench/browser/positronDataGrid/utilities/mouseUtilities';
import { CellSelectionState } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { VerticalSplitter } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { HorizontalSplitter } from 'vs/base/browser/ui/positronComponents/splitters/horizontalSplitter';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

/**
 * DataGridRowCellProps interface.
 */
interface DataGridRowCellProps {
	columnIndex: number;
	rowIndex: number;
	left: number;
}

/**
 * DataGridRowCell component.
 * @param props A DataGridRowCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridRowCell = (props: DataGridRowCellProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	/**
	 * onContextMenu handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const contextMenuHandler = async (e: MouseEvent<HTMLElement>) => {
		console.log(`-------------- ROW CELL CONTEXT MENU!`);
		context.instance.showCellContextMenu(ref.current, props.columnIndex, props.rowIndex);
	};

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = async (e: MouseEvent<HTMLElement>) => {
		// Process the left button.
		if (e.button === 0 && context.instance.selection) {
			// Consume the event.
			e.stopPropagation();

			// Mouse select the cell.
			context.instance.mouseSelectCell(props.columnIndex, props.rowIndex, selectionType(e));
		}
	};

	// Get the selection states.
	const cellSelectionState = context.instance.cellSelectionState(
		props.columnIndex,
		props.rowIndex
	);

	// Render.
	return (
		<div
			ref={ref}
			className={
				positronClassNames(
					'data-grid-row-cell',
					{ 'selected': cellSelectionState & CellSelectionState.Selected },
				)}
			style={{
				left: props.left,
				width: context.instance.getColumnWidth(props.columnIndex),
				height: context.instance.getRowHeight(props.rowIndex)
			}}
			onContextMenu={contextMenuHandler}
			onMouseDown={mouseDownHandler}
		>
			<div
				className={
					positronClassNames(
						'data-grid-row-cell-border-overlay',
						{ 'bordered': context.instance.cellBorder },
						{ 'selected': cellSelectionState & CellSelectionState.Selected },
						{ 'selected-top': cellSelectionState & CellSelectionState.SelectedTop },
						{ 'selected-bottom': cellSelectionState & CellSelectionState.SelectedBottom },
						{ 'selected-left': cellSelectionState & CellSelectionState.SelectedLeft },
						{ 'selected-right': cellSelectionState & CellSelectionState.SelectedRight },
					)}
			>
				{
					context.instance.internalCursor &&
					props.columnIndex === context.instance.cursorColumnIndex &&
					props.rowIndex === context.instance.cursorRowIndex &&
					<div
						className='cursor-border'
						style={{
							top: context.instance.cursorOffset,
							right: context.instance.cursorOffset,
							bottom: context.instance.cursorOffset,
							left: context.instance.cursorOffset
						}}
					/>
				}
			</div>
			<div className='content'>
				{context.instance.cell(props.columnIndex, props.rowIndex)}
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
			{context.instance.rowResize &&
				<HorizontalSplitter
					onBeginResize={() => ({
						minimumHeight: context.instance.minimumRowHeight,
						maximumHeight: 90,
						startingHeight: context.instance.getRowHeight(props.rowIndex)
					})}
					onResize={async height =>
						await context.instance.setRowHeight(props.rowIndex, height)
					}
				/>
			}
		</div>
	);
};
