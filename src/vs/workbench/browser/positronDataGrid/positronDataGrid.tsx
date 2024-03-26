/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataGrid';

// React.
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports

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
export const PositronDataGrid = (props: PositronDataGridProps) => {
	// Reference hooks.
	const dataGridWaffleRef = useRef<HTMLDivElement>(undefined!);

	// Render.
	return (
		<PositronDataGridContextProvider {...props}>
			<div
				id={props.id}
				tabIndex={0}
				className='data-grid'
				onFocus={() => dataGridWaffleRef.current.focus()}
			>
				<DataGridWaffle ref={dataGridWaffleRef} />
			</div>
		</PositronDataGridContextProvider>
	);
};
