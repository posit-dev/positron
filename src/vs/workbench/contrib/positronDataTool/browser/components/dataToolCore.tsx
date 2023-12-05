/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dataToolCore';
import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataToolProps } from 'vs/workbench/contrib/positronDataTool/browser/positronDataTool';

// DataToolCoreProps interface.
interface DataToolCoreProps extends PositronDataToolProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * DataToolCore component.
 * @param props A DataToolCoreProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataToolCore = (props: DataToolCoreProps) => {
	// Context hooks.
	// const positronDataToolContext = usePositronDataToolContext();

	// Calculate the adjusted height (the height minus the action bars height).
	// const adjustedHeight = props.height - 64;

	// Render.
	return (
		<div className='data-tool-core'>
			<div>PositronDataToolCore Component</div>
		</div>
	);
};
