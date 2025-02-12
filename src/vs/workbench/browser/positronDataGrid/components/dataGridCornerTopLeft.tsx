/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridCornerTopLeft.css';

// React.
import React from 'react';

// Other dependencies.
import { VerticalSplitter } from '../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

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
				onBeginResize={() => ({
					minimumWidth: 20,
					maximumWidth: context.instance.maximumColumnWidth,
					startingWidth: context.instance.rowHeadersWidth
				})}
				onResize={async width =>
					await context.instance.setRowHeadersWidth(width)
				}
			/>
		</div>
	);
};
