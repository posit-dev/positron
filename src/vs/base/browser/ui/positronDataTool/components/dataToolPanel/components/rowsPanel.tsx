/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./rowsPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGrid } from 'vs/base/browser/ui/dataGrid/dataGrid';
import { usePositronDataToolContext } from 'vs/base/browser/ui/positronDataTool/positronDataToolContext';

/**
 * RowsPanelProps interface.
 */
interface RowsPanelProps {
	width: number;
	height: number;
}

/**
 * RowsPanel component.
 * @param props A RowsPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowsPanel = (props: RowsPanelProps) => {
	// Context hooks.
	const context = usePositronDataToolContext();

	// Render.
	return (
		<div className='rows-panel'>
			<DataGrid
				// Props.
				layoutService={context.layoutService}
				instance={context.instance.positronDataGridInstance}
				width={props.width}
				height={props.height}
			/>
		</div>
	);
};
