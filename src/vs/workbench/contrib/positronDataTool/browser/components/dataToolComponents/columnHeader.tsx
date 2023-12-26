/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnHeader';
import * as React from 'react';
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

	const resizeHandler = (x: number, y: number): PositronColumnSplitterResizeResult => {
		return PositronColumnSplitterResizeResult.Resizing;
	};

	// Render.
	return (
		<div className='column-header' style={{ width: 190 }}>
			<div className='title'>{context.instance.columns[props.index].columnSchema.name} </div>
			<PositronColumnSplitter width={5} showSizer={true} onResize={resizeHandler} />
		</div>
	);
};
