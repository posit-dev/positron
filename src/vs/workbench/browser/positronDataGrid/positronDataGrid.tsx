/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataGrid';

// React.
import * as React from 'react';
import { forwardRef, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DataGridWaffle } from 'vs/workbench/browser/positronDataGrid/components/dataGridWaffle';
import { PositronDataGridConfiguration, PositronDataGridContextProvider } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

/**
 * PositronDataGridProps interface.
 */
interface PositronDataGridProps extends PositronDataGridConfiguration {
	id?: string;
	tabIndex: number;
}

/**
 * PositronDataGrid component.
 * @param props A PositronDataGridProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataGrid = forwardRef<HTMLDivElement, PositronDataGridProps>((props, ref) => {
	// Reference hooks.
	const dataGridWaffleRef = useRef<HTMLDivElement>(undefined!);

	// Render.
	return (
		<PositronDataGridContextProvider {...props}>
			<div ref={ref} id={props.id} className='data-grid'>
				<DataGridWaffle ref={dataGridWaffleRef} />
			</div>
		</PositronDataGridContextProvider>
	);
});

// Set the display name.
PositronDataGrid.displayName = 'PositronDataGrid';
