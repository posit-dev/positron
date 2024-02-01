/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridCornerTopLeft';

// React.
import * as React from 'react';
import { useDataGridContext } from 'vs/base/browser/ui/dataGrid/dataGridContext';
import { PositronColumnSplitter } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';

/**
 * DataGridCornerTopLeftProps interface.
 */
interface DataGridCornerTopLeftProps {
	onClick: () => void;
}

/**
 * DataGridCornerTopLeft component.
 * @param props A DataGridCornerTopLeftProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridCornerTopLeft = (props: DataGridCornerTopLeftProps) => {
	// Context hooks.
	const context = useDataGridContext();

	// Render.
	return (
		<div className='data-grid-corner-top-left' onClick={props.onClick}>
			<PositronColumnSplitter
				onBeginResize={() => ({
					minimumWidth: 20,
					maximumWidth: 400,
					startingWidth: context.instance.rowHeadersWidth
				})}
				onResize={width =>
					context.instance.setRowHeadersWidth(width)
				}
			/>
		</div>
	);
};
