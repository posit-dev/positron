/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./tableDataPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { PositronDataGrid } from 'vs/base/browser/ui/positronDataGrid/positronDataGrid';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

/**
 * TableDataPanelProps interface.
 */
interface TableDataPanelProps {
	width: number;
	height: number;
}

/**
 * TableDataPanel component.
 * @param props A TableDataPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const TableDataPanel = (props: TableDataPanelProps) => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Render.
	return (
		<div className='table-data-panel'>
			<div className='container'>
				<PositronDataGrid
					layoutService={context.layoutService}
					instance={context.instance.tableDataDataGridInstance}
					width={props.width}
					height={props.height}
					borderTop={true}
				/>
			</div>
		</div>
	);
};
