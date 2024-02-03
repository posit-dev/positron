/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRowHeader';

// React.
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { useDataGridContext } from 'vs/base/browser/ui/dataGrid/dataGridContext';
import { selectionType } from 'vs/base/browser/ui/dataGrid/utilities/mouseUtilities';
import { PositronColumnSplitter } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';
import { RowSelectionState } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';

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
	const context = useDataGridContext();

	/**
	 * MouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		context.instance.mouseSelectRow(props.rowIndex, selectionType(e));
	};

	// Get the row selection state.
	const rowSelectionState = context.instance.rowSelectionState(props.rowIndex);

	// Render.
	return (
		<div
			className={
				positronClassNames(
					'data-grid-row-header',
					{ 'selected': rowSelectionState & RowSelectionState.Selected }
				)
			}
			style={{
				top: props.top,
				height: context.instance.rowHeight
			}}
			onMouseDown={mouseDownHandler}
		>
			<div
				className={
					positronClassNames(
						'data-grid-row-header-border-overlay',
						{ 'selected': rowSelectionState & RowSelectionState.Selected },
						{ 'selected-top': rowSelectionState & RowSelectionState.SelectedTop },
						{ 'selected-bottom': rowSelectionState & RowSelectionState.SelectedBottom }
					)
				}
			/>
			<div className='title'>{context.instance.rowLabel(props.rowIndex)}</div>
			<PositronColumnSplitter
				onBeginResize={() => ({
					minimumWidth: 20,
					maximumWidth: 400,
					startingWidth: context.instance.rowHeadersWidth
				})}
				onResize={width =>
					context.instance.setRowHeadersWidth(width)
				}
			/>
		</div>
	);
};
