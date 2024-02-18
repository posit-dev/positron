/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataExplorerCell';

// React.
import * as React from 'react';

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';

/**
 * DataExplorerCellProps interface.
 */
interface DataExplorerCellProps {
	column: PositronDataExplorerColumn;
	value: string;
}

/**
 * DataExplorerCell component.
 * @param props A DataExplorerCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataExplorerCell = (props: DataExplorerCellProps) => {
	// Render.
	return (
		<div className={positronClassNames('text', props.column.alignment)}>
			{props.value}
		</div>
	);
};
