/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridColumnHeader.css';

// React.
import React, { MouseEvent, useRef } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { IDataColumn } from '../interfaces/dataColumn.js';
import { Button, MouseTrigger } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { selectionType } from '../utilities/mouseUtilities.js';
import { VerticalSplitter } from '../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { ColumnSelectionState } from '../classes/dataGridInstance.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';
import { renderLeadingTrailingWhitespace } from '../../../services/positronDataExplorer/browser/components/tableDataCell.js';

/**
 * Constants.
 */
export const SORTING_BUTTON_WIDTH = 20;

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
	const ref = useRef<HTMLDivElement>(undefined!);
	const sortingButtonRef = useRef<HTMLButtonElement>(undefined!);

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	const mouseDownHandler = async (e: MouseEvent<HTMLElement>) => {
		// Stop propagation.
		e.stopPropagation();

		// Get the starting bounding client rect. This is used to calculate the position of the
		// context menu.
		const startingRect = ref.current.getBoundingClientRect();

		// Get the column selection state.
		const columnSelectionState = context.instance.columnSelectionState(props.columnIndex);

		// If the column selection state is None, and selection is enabled, mouse-select the column.
		// Otherwise, scroll the column into view.
		if (columnSelectionState === ColumnSelectionState.None && context.instance.selection) {
			await context.instance.mouseSelectColumn(props.columnIndex, selectionType(e));
		} else {
			await context.instance.scrollToColumn(props.columnIndex);
		}

		// If the left mouse button was pressed, show the context menu.
		if (e.button === 2) {
			// Get the ending bounding client rect.
			const endingRect = ref.current.getBoundingClientRect();

			// Show the column context menu.
			await context.instance.showColumnContextMenu(
				props.columnIndex,
				ref.current,
				{
					clientX: e.clientX + endingRect.left - startingRect.left,
					clientY: e.clientY
				}
			);
		}
	};

	/**
	 * dropdownPressed event handler.
	 */
	const dropdownPressed = async () => {
		// Show the column context menu.
		await context.instance.showColumnContextMenu(props.columnIndex, sortingButtonRef.current);
	};

	// Get the column sort key.
	const columnSortKey = context.instance.columnSortKey(props.columnIndex);

	// Get the column selection state.
	const columnSelectionState = context.instance.columnSelectionState(props.columnIndex);

	// Determine whether the column is selected.
	const selected = (columnSelectionState & ColumnSelectionState.Selected) !== 0;

	const renderedColumn = renderLeadingTrailingWhitespace(props.column?.name);

	// Render.
	return (
		<div
			ref={ref}
			className='data-grid-column-header'
			style={{
				left: props.left,
				width: context.instance.getColumnWidth(props.columnIndex)
			}}
			onMouseDown={mouseDownHandler}
		>
			{context.instance.cellBorders &&
				<>
					<div className='border-overlay' />
					{selected &&
						<div
							className={positronClassNames(
								'selection-overlay',
								{ 'focused': context.instance.focused },
								{ 'selected-left': columnSelectionState & ColumnSelectionState.SelectedLeft },
								{ 'selected-right': columnSelectionState & ColumnSelectionState.SelectedRight }
							)}
						/>
					}
				</>
			}
			<div
				className='content'
				style={{
					paddingLeft: context.instance.horizontalCellPadding,
					paddingRight: context.instance.horizontalCellPadding
				}}
			>
				<div className='title-description'>
					<div className='title'>{renderedColumn}</div>
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
					tabIndex={-1}
					onPressed={dropdownPressed}
				>
					<div className='codicon codicon-positron-vertical-ellipsis' style={{ fontSize: 18 }} />
				</Button>
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
		</div>
	);
};
