/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataGrid';

// React.
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DataGridWaffle } from 'vs/workbench/browser/positronDataGrid/components/dataGridWaffle';
import { PositronDataGridConfiguration, PositronDataGridContextProvider } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

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
			<div id={props.id} className='data-grid'>
				<DataGridWaffle ref={ref} />
			</div>
		</PositronDataGridContextProvider>
	);
});

// Set the display name.
PositronDataGrid.displayName = 'PositronDataGrid';
