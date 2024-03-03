/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS>
import 'vs/css!./dataExplorerPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { StatusBar } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/statusBar';
import { ActionsBar } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/actionsBar';
import { DataExplorer } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/dataExplorer';

/**
 * DataExplorerProps interface.
 */
interface DataExplorerPanelProps {
	readonly width: number;
	readonly height: number;
}

/**
 * DataExplorerPanel component.
 * @param props A DataExplorerPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataExplorerPanel = (props: DataExplorerPanelProps) => {
	// Render.
	return (
		<div className='data-explorer-panel' style={{ width: props.width, height: props.height }}>
			<ActionsBar />
			<DataExplorer width={props.width} height={props.height - 64 - 24} />
			<StatusBar />
		</div>
	);
};
