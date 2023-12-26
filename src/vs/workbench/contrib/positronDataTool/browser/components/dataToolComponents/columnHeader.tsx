/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnHeader';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { PositronColumnSplitter, PositronColumnSplitterResizeResult } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';

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

	const [width, setWidth] = useState(context.instance.columns[props.index].width);

	const resizeHandler = (x: number): PositronColumnSplitterResizeResult => {

		let newWidth = width + x;
		let result: PositronColumnSplitterResizeResult;
		console.log(`Resize width ${x}`);
		if (newWidth < 90) {
			newWidth = 90;
			result = PositronColumnSplitterResizeResult.TooSmall;
		} else {
			result = PositronColumnSplitterResizeResult.Resizing;
		}

		setWidth(newWidth);

		context.instance.columns[props.index].width = width;

		// Done.
		return result;
	};

	const column = context.instance.columns[props.index];

	// Render.
	return (
		<div className='column-header' style={{ width: width }}>
			<div className='title'>{column.columnSchema.name} </div>
			<PositronColumnSplitter width={5} showSizer={true} onResize={resizeHandler} />
		</div>
	);
};
