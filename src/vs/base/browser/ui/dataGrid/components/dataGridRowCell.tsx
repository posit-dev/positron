/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRowCell';

// React.
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { isMacintosh } from 'vs/base/common/platform';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IDataColumn } from 'vs/base/browser/ui/dataGrid/interfaces/dataColumn';
import { usePositronDataGridContext } from 'vs/base/browser/ui/dataGrid/dataGridContext';
import { VerticalSplitter } from 'vs/base/browser/ui/positronComponents/verticalSplitter';
import { CellSelectionState } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';
import { HorizontalSplitter } from 'vs/base/browser/ui/positronComponents/horizontalSplitter';

/**
 * DataGridRowCellProps interface.
 */
interface DataGridRowCellProps {
	column: IDataColumn;
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

	/**
	 * MouseDown handler..
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		if (isMacintosh ? e.metaKey : e.ctrlKey) {
			// Individual cell selection is not supported.
		} else if (e.shiftKey) {
			context.instance.mouseSelectCell(props.columnIndex, props.rowIndex);
		} else {
			context.instance.clearSelection();
			context.instance.setCursorPosition(props.columnIndex, props.rowIndex);
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
			onMouseDown={mouseDownHandler}
		>
			<div
				className={
					positronClassNames(
						'data-grid-row-cell-border-overlay',
						{ 'selected': cellSelectionState & CellSelectionState.Selected },
						{ 'selected-top': cellSelectionState & CellSelectionState.SelectedTop },
						{ 'selected-bottom': cellSelectionState & CellSelectionState.SelectedBottom },
						{ 'selected-left': cellSelectionState & CellSelectionState.SelectedLeft },
						{ 'selected-right': cellSelectionState & CellSelectionState.SelectedRight },
					)}
			>
				{
					props.columnIndex === context.instance.cursorColumnIndex &&
					props.rowIndex === context.instance.cursorRowIndex &&
					<div className='cursor-border' />
				}
			</div>
			<div className={positronClassNames('text', props.column.alignment)}>
				{context.instance.cell(props.columnIndex, props.rowIndex)}
			</div>
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
			<HorizontalSplitter
				onBeginResize={() => ({
					minimumHeight: context.instance.minimumRowHeight,
					maximumHeight: 90,
					startingHeight: context.instance.getRowHeight(props.rowIndex)
				})}
				onResize={height =>
					context.instance.setRowHeight(props.rowIndex, height)
				}
			/>
		</div>
	);
};
