/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGrid';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGridWaffle } from 'vs/base/browser/ui/dataGrid/components/dataGridWaffle';
import { DataGridConfiguration, DataGridContextProvider } from 'vs/base/browser/ui/dataGrid/dataGridContext';

/**
 * DataGridProps interface.
 */
interface DataGridProps extends DataGridConfiguration {
	width: number;
	height: number;
}

/**
 * DataGrid component.
 * @param props A DataGridProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGrid = (props: DataGridProps) => {
	// Render.
	return (
		<DataGridContextProvider {...props}>
			<div className='data-grid'>
				<DataGridWaffle {...props} />
			</div>
		</DataGridContextProvider>
	);
};
