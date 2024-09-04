/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridCornerTopLeft';

// React.
import * as React from 'react';

// Other dependencies.
import { VerticalSplitter } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

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
	const context = usePositronDataGridContext();

	// Render.
	return (
		<div className='data-grid-corner-top-left' onClick={props.onClick}>
			<div className='border-overlay' />
			<VerticalSplitter
				configurationService={context.configurationService}
				showSash={false}
				collapsible={false}
				onBeginResize={() => ({
					minimumWidth: 20,
					maximumWidth: context.instance.maximumColumnWidth,
					columnsWidth: context.instance.rowHeadersWidth
				})}
				onResize={async width =>
					await context.instance.setRowHeadersWidth(width)
				}
			/>
		</div>
	);
};
