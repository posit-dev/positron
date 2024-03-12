/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataGrid';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGridWaffle } from 'vs/base/browser/ui/positronDataGrid/components/dataGridWaffle';
import { PositronDataGridConfiguration, PositronDataGridContextProvider } from 'vs/base/browser/ui/positronDataGrid/positronDataGridContext';

/**
 * PositronDataGridProps interface.
 */
interface PositronDataGridProps extends PositronDataGridConfiguration { }

/**
 * PositronDataGrid component.
 * @param props A PositronDataGridProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataGrid = (props: PositronDataGridProps) => {
	// Render.
	return (
		<PositronDataGridContextProvider {...props}>
			<div className='data-grid'>
				<DataGridWaffle />
			</div>
		</PositronDataGridContextProvider>
	);
};
