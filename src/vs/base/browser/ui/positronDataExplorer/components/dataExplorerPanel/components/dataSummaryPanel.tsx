/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataSummaryPanel';

// React.
import * as React from 'react';
// import { useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
// import { PositronDataGrid } from 'vs/base/browser/ui/positronDataGrid/positronDataGrid';
// import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

/**
 * DataSummaryPanelProps interface.
 */
interface DataSummaryPanelProps {
	width: number;
	height: number;
}

/**
 * DataSummaryPanel component.
 * @param props A DataSummaryPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataSummaryPanel = (props: DataSummaryPanelProps) => {
	// Context hooks.
	// const context = usePositronDataExplorerContext();

	// Render.
	return (
		<div className='data-summary-panel'>
			<div className='data-summary-container'>
			</div>
		</div>
	);
};
