/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridScrollbarCorner';

// React.
import * as React from 'react';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

/**
 * DataGridScrollbarCornerProps interface.
 */
interface DataGridScrollbarCornerProps {
	onClick: () => void;
}

/**
 * DataGridScrollbarCorner component.
 * @param props A DataGridScrollbarCornerProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridScrollbarCorner = (props: DataGridScrollbarCornerProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Render.
	return (
		<div
			className='data-grid-scrollbar-corner'
			style={{
				width: context.instance.scrollbarThickness,
				height: context.instance.scrollbarThickness
			}}
			onClick={props.onClick}
		/>
	);
};
