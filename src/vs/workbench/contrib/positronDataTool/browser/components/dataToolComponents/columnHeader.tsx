/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnHeader';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { PositronColumnSplitter, PositronColumnSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';

/**
 * Constants.
 */
const MIN_COLUMN_WIDTH = 45;

/**
 * ColumnHeaderProps interface.
 */
interface ColumnHeaderProps {
	index: number;
}

/**
 * ColumnHeader component.
 * @param props A ColumnHeaderProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnHeader = (props: ColumnHeaderProps) => {
	// Context hooks.
	const context = usePositronDataToolContext();

	// State hooks.
	const [width, setWidth] = useState(context.instance.columns[props.index].width);

	// Access the column.
	const column = context.instance.columns[props.index];

	// Main useEffect.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeWidth event handler.
		disposableStore.add(column.onDidChangeWidth(e => {
			setWidth(e);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	/**
	 * onBeginResize handler.
	 * @returns A PositronColumnSplitterResizeParams containing the resize parameters.
	 */
	const beginResizeHandler = (): PositronColumnSplitterResizeParams => ({
		minimumWidth: MIN_COLUMN_WIDTH,
		maximumWidth: 1000,
		startingWidth: column.width
	});

	/**
	 * onResize handler.
	 * @param newColumnsWidth The new columns width.
	 */
	const resizeHandler = (newColumnWidth: number) => {
		column.width = newColumnWidth;
	};

	// Render.
	return (
		<div className='column-header' style={{ width: width }}>
			<div className='title'>{column.columnSchema.name} </div>
			<PositronColumnSplitter
				width={5}
				showSizer={true}
				onBeginResize={beginResizeHandler}
				onResize={resizeHandler}
			/>
		</div>
	);
};
