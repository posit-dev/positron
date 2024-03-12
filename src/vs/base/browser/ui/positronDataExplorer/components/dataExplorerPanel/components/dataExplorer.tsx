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
import { VerticalSplitter, VerticalSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
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
	const dataExplorerRef = useRef<HTMLDivElement>(undefined!);
	const column1Ref = useRef<HTMLDivElement>(undefined!);
	const splitterRef = useRef<HTMLDivElement>(undefined!);
	const column2Ref = useRef<HTMLDivElement>(undefined!);

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
		setWidth(dataExplorerRef.current.offsetWidth);

		// Set the initial columns width.
		setColumnsWidth(Math.max(
			Math.trunc(context.instance.columnsWidthPercent * dataExplorerRef.current.offsetWidth),
			MIN_COLUMN_WIDTH
		));

		// Allocate and initialize the data explorer resize observer.
		const resizeObserver = new ResizeObserver(entries => {
			setWidth(entries[0].contentRect.width);
		});

		// Start observing the size of the data explorer.
		resizeObserver.observe(dataExplorerRef.current);

		// Return the cleanup function that will disconnect the resize observer.
		return () => resizeObserver.disconnect();
	}, [dataExplorerRef]);

	// Layout useEffect.
	useEffect(() => {
		switch (layout) {
			// Columns left.
			case PositronDataExplorerLayout.ColumnsLeft:
				dataExplorerRef.current.style.gridTemplateColumns = `[column-1] ${columnsWidth}px [splitter] 1px [column-2] 1fr [end]`;

				column1Ref.current.style.gridColumn = 'column-1 / splitter';
				column1Ref.current.style.display = 'grid';

				splitterRef.current.style.gridColumn = 'splitter / column-2';
				splitterRef.current.style.display = 'flex';

				column2Ref.current.style.gridColumn = 'column-2 / end';
				column2Ref.current.style.display = 'grid';
				break;

			// Columns right.
			case PositronDataExplorerLayout.ColumnsRight:
				dataExplorerRef.current.style.gridTemplateColumns = `[column-1] 1fr [splitter] 1px [column-2] ${columnsWidth}px [end]`;

				column1Ref.current.style.gridColumn = 'column-2 / end';
				column1Ref.current.style.display = 'grid';

				splitterRef.current.style.gridColumn = 'splitter / column-2';
				splitterRef.current.style.display = 'flex';

				column2Ref.current.style.gridColumn = 'column-1 / splitter';
				column2Ref.current.style.display = 'grid';
				break;

			// Columns hidden.
			case PositronDataExplorerLayout.ColumnsHidden:
				dataExplorerRef.current.style.gridTemplateColumns = `[column] 1fr [end]`;

				column1Ref.current.style.gridColumn = '';
				column1Ref.current.style.display = 'none';

				splitterRef.current.style.gridColumn = '';
				splitterRef.current.style.display = 'none';

				column2Ref.current.style.gridColumn = 'column / end';
				column2Ref.current.style.display = 'grid';
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
		<div ref={dataExplorerRef} className='data-explorer'>
			<div ref={column1Ref} className='column-1'>
				<PositronDataGrid
					layoutService={context.layoutService}
					instance={context.instance.tableSchemaDataGridInstance}
				/>
			</div>
			<div ref={splitterRef} className='splitter'>
				<VerticalSplitter
					showResizeIndicator={true}
					onBeginResize={beginResizeHandler}
					onResize={resizeHandler}
				/>
			</div>
			<div ref={column2Ref} className='column-2'>
				<PositronDataGrid
					layoutService={context.layoutService}
					instance={context.instance.tableDataDataGridInstance}
				/>
			</div>
		</div>
	);
};
