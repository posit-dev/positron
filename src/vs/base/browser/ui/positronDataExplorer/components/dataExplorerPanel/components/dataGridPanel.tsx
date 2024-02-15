/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGrid } from 'vs/base/browser/ui/dataGrid/positronDataGrid';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

/**
 * DataGridPanelProps interface.
 */
interface DataGridPanelProps {
	width: number;
	height: number;
}

/**
 * DataGridPanel component.
 * @param props A DataGridPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridPanel = (props: DataGridPanelProps) => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Render.
	return (
		<div className='data-grid-panel'>
			<div className='data-grid-container'>
				<DataGrid
					layoutService={context.layoutService}
					instance={context.instance.dataGridInstance}
					width={props.width}
					height={props.height}
					borderTop={true}
				/>
			</div>
		</div>
	);
};
