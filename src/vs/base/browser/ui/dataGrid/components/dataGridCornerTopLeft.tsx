/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridCornerTopLeft';

// React.
import * as React from 'react';

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
	// Render.
	return (
		<div className='data-grid-corner-top-left' onClick={props.onClick} />
	);
};
