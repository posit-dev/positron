/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dataToolPanel';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataToolProps } from 'vs/workbench/contrib/positronDataTool/browser/positronDataTool';
import { PositronDataToolLayout } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolState';
import { RowsPanel } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/rowsPanel';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { ColumnsPanel } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/columnsPanel';

/**
 * DataToolPanelProps interface.
 */
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
	// Context hooks.
	const positronDataToolContext = usePositronDataToolContext();

	// Reference hooks.
	const dataToolPanel = useRef<HTMLDivElement>(undefined!);
	const column1 = useRef<HTMLDivElement>(undefined!);
	const splitter = useRef<HTMLDivElement>(undefined!);
	const column2 = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [columnsWidth, setColumnsWidth] = useState(200);

	// Layout effect.
	useEffect(() => {
		switch (positronDataToolContext.layout) {
			case PositronDataToolLayout.ColumnsLeft:
				dataToolPanel.current.style.gridTemplateColumns = `[left-gutter] 8px [column-1] ${columnsWidth}px [splitter] 8px [column-2] 1fr [right-gutter] 8px`;
				column1.current.style.display = 'flex';
				column1.current.style.gridColumn = 'column-1 / splitter';
				column2.current.style.gridColumn = 'column-2 / right-gutter';
				break;

			case PositronDataToolLayout.ColumnsRight:
				dataToolPanel.current.style.gridTemplateColumns = `[left-gutter] 8px [column-1] 1fr [splitter] 8px [column-2] ${columnsWidth}px [right-gutter] 8px`;
				column1.current.style.display = 'flex';
				column1.current.style.gridColumn = 'column-2 / right-gutter';
				column2.current.style.gridColumn = 'column-1 / splitter';
				break;

			case PositronDataToolLayout.ColumnsHidden:
				dataToolPanel.current.style.gridTemplateColumns = `[left-gutter] 8px [column-1] 1fr [splitter] 8px [column-2] 0px [right-gutter] 8px`;
				column1.current.style.display = 'none';
				column2.current.style.gridColumn = 'column-1 / right-gutter';
				break;
		}
	}, [positronDataToolContext.layout]);

	// Render.
	return (
		<div ref={dataToolPanel} className='data-tool-panel' style={{ width: props.width, height: props.height }}>
			<div ref={column1} className='column-1'>
				<ColumnsPanel />
			</div>
			<div ref={splitter} className='splitter'>
			</div>
			<div ref={column2} className='column-2'>
				<RowsPanel />
			</div>
		</div>
	);
};
