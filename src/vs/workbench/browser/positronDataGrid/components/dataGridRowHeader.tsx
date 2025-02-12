/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridRowHeader.css';

// React.
import React, { MouseEvent, useRef } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { selectionType } from '../utilities/mouseUtilities.js';
import { RowSelectionState } from '../classes/dataGridInstance.js';
import { VerticalSplitter } from '../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { HorizontalSplitter } from '../../../../base/browser/ui/positronComponents/splitters/horizontalSplitter.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

/**
 * DataGridRowHeaderProps interface.
 */
interface DataGridRowHeaderProps {
	rowIndex: number;
	top: number;
}

/**
 * DataGridRowHeader component.
 * @param props A DataGridRowHeaderProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridRowHeader = (props: DataGridRowHeaderProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	/**
	 * MouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	const mouseDownHandler = async (e: MouseEvent<HTMLElement>) => {
		// Stop propagation.
		e.stopPropagation();

		// Get the starting bounding client rect. This is used to calculate the position of the
		// context menu.
		const startingRect = ref.current.getBoundingClientRect();

		// Get the row selection state.
		const rowSelectionState = context.instance.rowSelectionState(props.rowIndex);

		// If the row selection state is None, and selection is enabled, mouse-select the row.
		// Otherwise, scroll the row into view.
		if (rowSelectionState === RowSelectionState.None && context.instance.selection) {
			await context.instance.mouseSelectRow(props.rowIndex, selectionType(e));
		} else {
			await context.instance.scrollToRow(props.rowIndex);
		}

		// If the left mouse button was pressed, show the context menu.
		if (e.button === 2) {
			// Get the ending bounding client rect.
			const endingRect = ref.current.getBoundingClientRect();

			// Show the column context menu.
			await context.instance.showRowContextMenu(
				props.rowIndex,
				ref.current,
				{
					clientX: e.clientX,
					clientY: e.clientY + endingRect.top - startingRect.top
				}
			);
		}
	};

	// Get the row selection state.
	const rowSelectionState = context.instance.rowSelectionState(props.rowIndex);

	// Determine whether this row is selected.
	const selected = (rowSelectionState & RowSelectionState.Selected) !== 0;

	// Render.
	return (
		<div
			ref={ref}
			className='data-grid-row-header'
			style={{
				top: props.top,
				height: context.instance.getRowHeight(props.rowIndex)
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
								{ 'selected-top': rowSelectionState & RowSelectionState.SelectedTop },
								{ 'selected-bottom': rowSelectionState & RowSelectionState.SelectedBottom }
							)}
						/>
					}
				</>
			}
			<div className='content'>
				{context.instance.rowHeader(props.rowIndex)}
			</div>
			<VerticalSplitter
				configurationService={context.configurationService}
				onBeginResize={() => ({
					minimumWidth: context.instance.minimumColumnWidth,
					maximumWidth: context.instance.maximumColumnWidth,
					startingWidth: context.instance.rowHeadersWidth
				})}
				onResize={async width =>
					await context.instance.setRowHeadersWidth(width)
				}
			/>
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
