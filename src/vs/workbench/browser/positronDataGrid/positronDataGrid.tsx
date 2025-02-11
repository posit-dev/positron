/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDataGrid.css';

// React.
import React, { forwardRef } from 'react';

// Other dependencies.
import { DataGridWaffle } from './components/dataGridWaffle.js';
import { PositronDataGridConfiguration, PositronDataGridContextProvider } from './positronDataGridContext.js';

/**
 * PositronDataGridProps interface.
 */
interface PositronDataGridProps extends PositronDataGridConfiguration {
	id?: string;
}

/**
 * PositronDataGrid component.
 * @param props A PositronDataGridProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataGrid = forwardRef<HTMLDivElement, PositronDataGridProps>((props, ref) => {

	// Render.
	return (
		<PositronDataGridContextProvider {...props}>
			<div className='data-grid' id={props.id}>
				<DataGridWaffle ref={ref} />
			</div>
		</PositronDataGridContextProvider>
	);
});

// Set the display name.
PositronDataGrid.displayName = 'PositronDataGrid';
