/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnController';
import * as React from 'react';
import { CSSProperties } from 'react'; // eslint-disable-line no-duplicate-imports
import { DummyColumnInfo } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/columnsPanel';

/**
 * ColumnControllerProps interface.
 */
interface ColumnControllerProps {
	dummyColumnInfo: DummyColumnInfo;
	style: CSSProperties;
}

/**
 * ColumnController component.
 * @param props A ColumnControllerProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnController = (props: ColumnControllerProps) => {
	return (
		<div className='column-controller' key={props.dummyColumnInfo.key} style={props.style}>
			{props.dummyColumnInfo.name}
		</div>
	);
};
