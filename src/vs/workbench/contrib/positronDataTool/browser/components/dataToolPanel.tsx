/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dataToolPanel';
import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataToolProps } from 'vs/workbench/contrib/positronDataTool/browser/positronDataTool';

// DataToolPanelProps interface.
interface DataToolPanelProps extends PositronDataToolProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * DataToolPanel component.
 * @param props A DataToolPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataToolPanel = (props: DataToolPanelProps) => {
	// Render.
	return (
		<div className='data-tool-panel' style={{ width: props.width, height: props.height }}>
			<div style={{ textAlign: 'left', padding: 8 }}>PositronDataToolCore Component Left</div>
			<div style={{ textAlign: 'right', padding: 8 }}>PositronDataToolCore Component Right</div>
		</div>
	);
};
