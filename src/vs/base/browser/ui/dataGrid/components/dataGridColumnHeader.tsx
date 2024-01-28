/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridColumnHeader';

// React.
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IDataColumn } from 'vs/base/browser/ui/dataGrid/interfaces/dataColumn';
import { useDataGridContext } from 'vs/base/browser/ui/dataGrid/dataGridContext';
import { selectionType } from 'vs/base/browser/ui/dataGrid/utilities/mouseUtilities';
import { MouseTrigger, PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { SelectionState } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';
import { PositronColumnSplitter } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';

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

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();

		context.instance.mouseSelectColumn(props.columnIndex, selectionType(e));
	};

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
				{props.column.codicon &&
					<div className={
						positronClassNames(
							'icon',
							'codicon',
							`codicon-${props.column.codicon}`
						)}
						style={{
							fontSize: 18
						}} />
				}
				<div className='title-description'>
					<div className='title'>{props.column.name}</div>
					{props.column.description && <div className='description'>{props.column.description}</div>}
				</div>
				<PositronButton
					className='button'
					mouseTrigger={MouseTrigger.MouseDown}
					onPressed={() => console.log('DROP DOWN MENU!')}
				>
					<div className='codicon codicon-positron-drop-down-arrow' style={{ fontSize: 18 }} />
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
