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
 * DataExplorer component.
 * @returns The rendered component.
 */
export const DataExplorer = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const dataExplorer = useRef<HTMLDivElement>(undefined!);
	const column1 = useRef<HTMLDivElement>(undefined!);
	const splitter = useRef<HTMLDivElement>(undefined!);
	const column2 = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [width, setWidth] = useState(0);
	const [layout, setLayout] = useState(context.instance.layout);
	const [columnsWidth, setColumnsWidth] = useState(0);

	// Main useEffect. This is where we set up event handlers.
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

	// Automatic layout useEffect.
	useEffect(() => {
		// Set the initial width.
		setWidth(dataExplorer.current.offsetWidth);

		// Set the initial columns width.
		setColumnsWidth(Math.max(
			Math.trunc(context.instance.columnsWidthPercent * dataExplorer.current.offsetWidth),
			MIN_COLUMN_WIDTH
		));

		// Allocate and initialize the data explorer resize observer.
		const resizeObserver = new ResizeObserver(entries => {
			setWidth(entries[0].contentRect.width);
		});

		// Start observing the size of the data explorer.
		resizeObserver.observe(dataExplorer.current);

		// Return the cleanup function that will disconnect the resize observer.
		return () => resizeObserver.disconnect();
	}, [dataExplorer]);

	// Layout useEffect.
	useEffect(() => {
		switch (layout) {
			// Columns left.
			case PositronDataExplorerLayout.ColumnsLeft:
				dataExplorer.current.style.gridTemplateColumns = `[column-1] ${columnsWidth}px [splitter] 1px [column-2] 1fr [end]`;

				column1.current.style.gridColumn = 'column-1 / splitter';
				column1.current.style.display = 'grid';

				splitter.current.style.gridColumn = 'splitter / column-2';
				splitter.current.style.display = 'flex';

				column2.current.style.gridColumn = 'column-2 / end';
				column2.current.style.display = 'grid';
				break;

			// Columns right.
			case PositronDataExplorerLayout.ColumnsRight:
				dataExplorer.current.style.gridTemplateColumns = `[column-1] 1fr [splitter] 1px [column-2] ${columnsWidth}px [end]`;

				column1.current.style.gridColumn = 'column-2 / end';
				column1.current.style.display = 'grid';

				splitter.current.style.gridColumn = 'splitter / column-2';
				splitter.current.style.display = 'flex';

				column2.current.style.gridColumn = 'column-1 / splitter';
				column2.current.style.display = 'grid';
				break;

			// Columns hidden.
			case PositronDataExplorerLayout.ColumnsHidden:
				dataExplorer.current.style.gridTemplateColumns = `[column] 1fr [end]`;

				column1.current.style.gridColumn = '';
				column1.current.style.display = 'none';

				splitter.current.style.gridColumn = '';
				splitter.current.style.display = 'none';

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
		maximumWidth: Math.trunc(2 * width / 3),
		startingWidth: columnsWidth,
		invert: layout === PositronDataExplorerLayout.ColumnsRight
	});

	/**
	 * onResize handler.
	 * @param newColumnsWidth The new columns width.
	 */
	const resizeHandler = (newColumnsWidth: number) => {
		setColumnsWidth(newColumnsWidth);
		context.instance.columnsWidthPercent = newColumnsWidth / width;
	};

	console.log('Rendering data explorer');

	// Render.
	return (
		<div ref={dataExplorer} className='data-explorer'>
			<div ref={column1} className='column-1'>
				<PositronDataGrid
					layoutService={context.layoutService}
					instance={context.instance.tableSchemaDataGridInstance}
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
				/>
			</div>
		</div>
	);
};
