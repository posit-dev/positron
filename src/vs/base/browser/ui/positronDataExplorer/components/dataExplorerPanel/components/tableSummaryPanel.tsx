/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./tableSummaryPanel';

// React.
import * as React from 'react';
// import { useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { PositronDataGrid } from 'vs/base/browser/ui/positronDataGrid/positronDataGrid';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

/**
 * DataSummaryPanelProps interface.
 */
interface TableSummaryPanelProps {
	width: number;
	height: number;
}

/**
 * TableSummaryPanel component.
 * @param props A TableSummaryPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const TableSummaryPanel = (props: TableSummaryPanelProps) => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Render.
	return (
		<div className='table-summary-panel'>
			<div className='container'>
				<PositronDataGrid
					layoutService={context.layoutService}
					instance={context.instance.tableSchemaDataGridInstance}
					width={props.width}
					height={props.height}
					borderTop={true}
				/>
			</div>
		</div>
	);
};
