/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS>
import 'vs/css!./dataExplorer';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronDataGrid } from 'vs/base/browser/ui/positronDataGrid/positronDataGrid';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';
import { VerticalSplitter, VerticalSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/verticalSplitter';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';

/**
 * Constants.
 */
const MIN_COLUMN_WIDTH = 275;

/**
 * DataExplorerProps interface.
 */
interface DataExplorerProps {
	readonly width: number;
	readonly height: number;
}

/**
 * DataExplorer component.
 * @param props A DataExplorerProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataExplorer = (props: DataExplorerProps) => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const dataExplorer = useRef<HTMLDivElement>(undefined!);
	const column1 = useRef<HTMLDivElement>(undefined!);
	const splitter = useRef<HTMLDivElement>(undefined!);
	const column2 = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [layout, setLayout] = useState(context.instance.layout);
	const [columnsWidth, setColumnsWidth] = useState(
		Math.max(Math.trunc(context.instance.columnsWidthPercent * props.width), MIN_COLUMN_WIDTH)
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
			case PositronDataExplorerLayout.ColumnsLeft:
				dataExplorer.current.style.gridTemplateRows = '[main] 1fr [end]';
				dataExplorer.current.style.gridTemplateColumns = `[column-1] ${columnsWidth}px [splitter] 1px [column-2] 1fr [end]`;

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
			case PositronDataExplorerLayout.ColumnsRight:
				dataExplorer.current.style.gridTemplateRows = '[main] 1fr [end]';
				dataExplorer.current.style.gridTemplateColumns = `[column-1] 1fr [splitter] 1px [column-2] ${columnsWidth}px [end]`;

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
			case PositronDataExplorerLayout.ColumnsHidden:
				dataExplorer.current.style.gridTemplateRows = '[main] 1fr [end]';
				dataExplorer.current.style.gridTemplateColumns = `[column] 1fr [end]`;

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
	 * onBeginResize handler.
	 * @returns A VerticalSplitterResizeParams containing the resize parameters.
	 */
	const beginResizeHandler = (): VerticalSplitterResizeParams => ({
		minimumWidth: MIN_COLUMN_WIDTH,
		maximumWidth: Math.trunc(2 * props.width / 3),
		startingWidth: columnsWidth,
		invert: layout === PositronDataExplorerLayout.ColumnsRight
	});

	/**
	 * onResize handler.
	 * @param newColumnsWidth The new columns width.
	 */
	const resizeHandler = (newColumnsWidth: number) => {
		setColumnsWidth(newColumnsWidth);
		context.instance.columnsWidthPercent = newColumnsWidth / props.width;
	};

	// Render.
	return (
		<div ref={dataExplorer} className='data-explorer'>
			<div ref={column1} className='column-1'>
				<PositronDataGrid
					layoutService={context.layoutService}
					instance={context.instance.tableSchemaDataGridInstance}
					width={columnsWidth}
					height={props.height}
				/>
			</div>
			<div ref={splitter} className='splitter'>
				<VerticalSplitter
					showResizeIndicator={true}
					onBeginResize={beginResizeHandler}
					onResize={resizeHandler}
				/>
			</div>
			<div ref={column2} className='column-2'>
				<PositronDataGrid
					layoutService={context.layoutService}
					instance={context.instance.tableDataDataGridInstance}
					width={layout === PositronDataExplorerLayout.ColumnsHidden ?
						props.width :
						props.width - columnsWidth
					}
					height={props.height}
				/>
			</div>
		</div>
	);
};
