/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnHeaders';
import * as React from 'react';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { ColumnHeader } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/columnHeader';

/**
 * ColumnHeadersProps interface.
 */
interface ColumnHeadersProps {
}

/**
 * ColumnHeaders component.
 * @param props A ColumnHeadersProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnHeaders = (props: ColumnHeadersProps) => {
	// Context hooks.
	const context = usePositronDataToolContext();

	// Render.
	return (
		<div className='column-headers'>
			{context.instance.columns.map((column, index) =>
				<ColumnHeader index={index} />
			)}
		</div>
	);
};
