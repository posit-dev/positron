/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridRowCell.css';

// React.
import React, { MouseEvent, useRef } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { selectionType } from '../utilities/mouseUtilities.js';
import { CellSelectionState } from '../classes/dataGridInstance.js';
import { VerticalSplitter } from '../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { HorizontalSplitter } from '../../../../base/browser/ui/positronComponents/splitters/horizontalSplitter.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

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
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = async (e: MouseEvent<HTMLElement>) => {
		// Stop propagation.
		e.stopPropagation();

		// Get the starting bounding client rect. This is used to calculate the position of the
		// context menu.
		const startingRect = ref.current.getBoundingClientRect();

		// If selection is enabled, process selection logic.
		if (context.instance.selection) {
			// Get the cell selection state.
			const cellSelectionState = context.instance.cellSelectionState(
				props.columnIndex,
				props.rowIndex
			);

			// If the cell is not selected, or it is and the user is left-clicking, mouse-select
			// the cell. Otherwise, scroll to the cell.
			if (cellSelectionState === CellSelectionState.None || e.button === 0) {
				// Mouse-select the cell.
				await context.instance.mouseSelectCell(
					props.columnIndex,
					props.rowIndex,
					selectionType(e)
				);
			} else {
				// Scroll to the cell.
				await context.instance.scrollToCell(props.columnIndex, props.rowIndex);
			}
		}

		// If the left mouse button was pressed, show the context menu.
		if (e.button === 2) {
			// Get the ending bounding client rect.
			const endingRect = ref.current.getBoundingClientRect();

			// Show the cell context menu.
			await context.instance.showCellContextMenu(
				props.columnIndex,
				props.rowIndex,
				ref.current,
				{
					clientX: e.clientX + endingRect.left - startingRect.left,
					clientY: e.clientY + endingRect.top - startingRect.top
				}
			);
		}
	};

	// Get the selection states.
	const cellSelectionState = context.instance.cellSelectionState(
		props.columnIndex,
		props.rowIndex
	);

	// Determine whether this cell is selected.
	const selected = (cellSelectionState & CellSelectionState.Selected) !== 0;

	// Determine whether this cell is the cursor cell.
	const isCursorCell = context.instance.internalCursor &&
		props.columnIndex === context.instance.cursorColumnIndex &&
		props.rowIndex === context.instance.cursorRowIndex;


	/**
	 * Cursor component.
	 * @param dimmed A value which indicates whether the cursor component should be dimmed.
	 * @returns The rendered component.
	 */
	const Cursor = ({ dimmed }: { dimmed?: boolean }) => {
		return (
			<div
				className={positronClassNames(
					'cursor-border',
					{ dimmed }
				)}
				style={{
					top: context.instance.cursorOffset,
					right: context.instance.cursorOffset,
					bottom: context.instance.cursorOffset,
					left: context.instance.cursorOffset,
				}}
			/>
		);
	};

	// Render.
	return (
		<div
			ref={ref}
			className='data-grid-row-cell'
			style={{
				left: props.left,
				width: context.instance.getColumnWidth(props.columnIndex),
				height: context.instance.getRowHeight(props.rowIndex)
			}}
			onMouseDown={mouseDownHandler}
		>
			{context.instance.cellBorders &&
				<>
					<div className='border-overlay'>
						{!selected && isCursorCell && <Cursor dimmed={!context.instance.focused} />}
					</div>
					{selected &&
						<div
							className={positronClassNames(
								'selection-overlay',
								{ 'focused': context.instance.focused },
								{ 'selected-top': cellSelectionState & CellSelectionState.SelectedTop },
								{ 'selected-bottom': cellSelectionState & CellSelectionState.SelectedBottom },
								{ 'selected-left': cellSelectionState & CellSelectionState.SelectedLeft },
								{ 'selected-right': cellSelectionState & CellSelectionState.SelectedRight },
							)}
						>
							{isCursorCell && <Cursor />}
						</div>
					}
				</>
			}
			<div
				className='content'
				id={`data-grid-row-cell-content-${props.columnIndex}-${props.rowIndex}`}
				style={{
					paddingLeft: context.instance.horizontalCellPadding,
					paddingRight: context.instance.horizontalCellPadding
				}}
			>
				{context.instance.cell(props.columnIndex, props.rowIndex)}
			</div>
			{context.instance.columnResize &&
				<VerticalSplitter
					configurationService={context.configurationService}
					onBeginResize={() => ({
						minimumWidth: context.instance.minimumColumnWidth,
						maximumWidth: context.instance.maximumColumnWidth,
						startingWidth: context.instance.getColumnWidth(props.columnIndex)
					})}
					onResize={async columnWidth =>
						await context.instance.setColumnWidth(props.columnIndex, columnWidth)
					}
				/>
			}
			{context.instance.rowResize &&
				<HorizontalSplitter
					onBeginResize={() => ({
						minimumHeight: context.instance.minimumRowHeight,
						maximumHeight: 90,
						startingHeight: context.instance.getRowHeight(props.rowIndex)!
					})}
					onResize={async rowHeight =>
						await context.instance.setRowHeight(props.rowIndex, rowHeight)
					}
				/>
			}
		</div>
	);
};
