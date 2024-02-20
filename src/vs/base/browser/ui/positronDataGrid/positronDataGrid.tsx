/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataGrid';

// React.
import * as React from 'react';

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { DataGridWaffle } from 'vs/base/browser/ui/positronDataGrid/components/dataGridWaffle';
import { PositronDataGridConfiguration, PositronDataGridContextProvider } from 'vs/base/browser/ui/positronDataGrid/positronDataGridContext';

/**
 * DataGridProps interface.
 */
interface PositronDataGridProps extends PositronDataGridConfiguration {
	width: number;
	height: number;
	borderTop?: boolean;
	borderLeft?: boolean;
}

/**
 * PositronDataGrid component.
 * @param props A PositronDataGridProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataGrid = (props: PositronDataGridProps) => {
	// Render.
	return (
		<PositronDataGridContextProvider {...props}>
			<div
				className={positronClassNames(
					'data-grid',
					{ 'border-top': props.borderTop },
					{ 'border-left': props.borderLeft }
				)}
			>
				<DataGridWaffle {...props} />
			</div>
		</PositronDataGridContextProvider>
	);
};
