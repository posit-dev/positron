/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dataToolPanel';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataToolProps } from 'vs/workbench/contrib/positronDataTool/browser/positronDataTool';
import { RowsPanel } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/rowsPanel';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { ColumnsPanel } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/columnsPanel';
import { PositronDataToolLayout } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';
import { PositronColumnSplitter, PositronColumnSplitterResizeResult } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';

/**
 * Constants.
 */
const MIN_COLUMN_WIDTH = 200;

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
	const context = usePositronDataToolContext();

	// Reference hooks.
	const dataToolPanel = useRef<HTMLDivElement>(undefined!);
	const column1 = useRef<HTMLDivElement>(undefined!);
	const splitter = useRef<HTMLDivElement>(undefined!);
	const column2 = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [layout, setLayout] = useState(context.instance.layout);
	const [columnsWidth, setColumnsWidth] = useState(
		Math.max(context.instance.columnsWidthPercent * props.width, MIN_COLUMN_WIDTH)
	);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeLayout event handler.
		disposableStore.add(context.instance.onDidChangeLayout(layout => {
			setLayout(layout);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Layout effect.
	useEffect(() => {
		switch (layout) {
			// Columns left.
			case PositronDataToolLayout.ColumnsLeft:
				dataToolPanel.current.style.gridTemplateRows = '[main] 1fr [end]';
				dataToolPanel.current.style.gridTemplateColumns = `[column-1] ${columnsWidth}px [splitter] 8px [column-2] 1fr [end]`;

				column1.current.style.gridRow = 'main / end';
				column1.current.style.gridColumn = 'column-1 / splitter';
				column1.current.style.display = 'grid';

				splitter.current.style.gridRow = 'main / end';
				splitter.current.style.gridColumn = 'splitter / column-2';
				splitter.current.style.display = 'flex';

				column2.current.style.gridRow = 'main / end';
				column2.current.style.gridColumn = 'column-2 / end';
				column2.current.style.display = 'grid';
				break;

			// Columns right.
			case PositronDataToolLayout.ColumnsRight:
				dataToolPanel.current.style.gridTemplateRows = '[main] 1fr [end]';
				dataToolPanel.current.style.gridTemplateColumns = `[column-1] 1fr [splitter] 8px [column-2] ${columnsWidth}px [end]`;

				column1.current.style.gridRow = 'main / end';
				column1.current.style.gridColumn = 'column-2 / end';
				column1.current.style.display = 'grid';

				splitter.current.style.gridRow = 'main / end';
				splitter.current.style.gridColumn = 'splitter / column-2';
				splitter.current.style.display = 'flex';

				column2.current.style.gridRow = 'main / end';
				column2.current.style.gridColumn = 'column-1 / splitter';
				column2.current.style.display = 'grid';
				break;

			// Columns hidden.
			case PositronDataToolLayout.ColumnsHidden:
				dataToolPanel.current.style.gridTemplateRows = '[main] 1fr [end]';
				dataToolPanel.current.style.gridTemplateColumns = `[column] 1fr [end]`;

				column1.current.style.gridRow = '';
				column1.current.style.gridColumn = '';
				column1.current.style.display = 'none';

				splitter.current.style.gridRow = '';
				splitter.current.style.gridColumn = '';
				splitter.current.style.display = 'none';

				column2.current.style.gridRow = 'main / end';
				column2.current.style.gridColumn = 'column / end';
				column2.current.style.display = 'grid';
				break;
		}
	}, [layout, columnsWidth]);

	/**
	 * onResize handler.
	 * @param x The X delta.
	 */
	const resizeHandler = (x: number) => {
		// Calculate the new column width.
		let newColumnWidth = -1;
		switch (layout) {
			// Columns left.
			case PositronDataToolLayout.ColumnsLeft:
				newColumnWidth = columnsWidth + x;
				break;

			// Columns right.
			case PositronDataToolLayout.ColumnsRight:
				newColumnWidth = columnsWidth - x;
				break;

			// Columns hidden. This can't happen.
			case PositronDataToolLayout.ColumnsHidden:
				throw new Error('Resize is unavailable');
		}

		// If the new column width is too small, pin it at the minimum column width and return
		// ColumnSplitterResizeResult.TooSmall to get the cursor updated.
		if (newColumnWidth < MIN_COLUMN_WIDTH) {
			setColumnsWidth(MIN_COLUMN_WIDTH);
			return PositronColumnSplitterResizeResult.TooSmall;
		}

		// If the new column width is too large, pin it at the maximum column width and return
		// ColumnSplitterResizeResult.TooLarge to get the cursor updated.
		const maxColumnWidth = props.width - (MIN_COLUMN_WIDTH + 24);
		if (newColumnWidth > maxColumnWidth) {
			setColumnsWidth(maxColumnWidth);
			return PositronColumnSplitterResizeResult.TooLarge;
		}

		// Update the the column width and return ColumnSplitterResizeResult.Resizing to get the
		// cursor updated.
		setColumnsWidth(newColumnWidth);
		context.instance.columnsWidthPercent = newColumnWidth / props.width;
		return PositronColumnSplitterResizeResult.Resizing;
	};

	// Render.
	return (
		<div
			className='data-tool-panel-container'
			style={{ width: props.width, height: props.height }}
		>
			<div
				ref={dataToolPanel}
				className='data-tool-panel'
			>
				<div ref={column1} className='column-1'>
					<ColumnsPanel height={props.height - 16} />
				</div>
				<div ref={splitter} className='splitter'>
					<PositronColumnSplitter width={8} onResize={resizeHandler} />
				</div>
				<div ref={column2} className='column-2'>
					<RowsPanel />
				</div>
			</div>
		</div>
	);
};
