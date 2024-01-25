/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS>
import 'vs/css!./dataToolPanel';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataToolProps } from 'vs/base/browser/ui/positronDataTool/positronDataTool';
import { usePositronDataToolContext } from 'vs/base/browser/ui/positronDataTool/positronDataToolContext';
import { RowsPanel } from 'vs/base/browser/ui/positronDataTool/components/dataToolPanel/components/rowsPanel';
import { ColumnsPanel } from 'vs/base/browser/ui/positronDataTool/components/dataToolPanel/components/columnsPanel';
import { PositronDataToolLayout } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';
import { PositronColumnSplitter, PositronColumnSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';

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

	useEffect(() => {

	}, [props.width, props.height]);

	// Layout effect.
	useEffect(() => {
		switch (layout) {
			// Columns left.
			case PositronDataToolLayout.ColumnsLeft:
				dataToolPanel.current.style.gridTemplateRows = '[main] 1fr [end]';
				dataToolPanel.current.style.gridTemplateColumns = `[column-1] ${columnsWidth}px [splitter] 1px [column-2] 1fr [end]`;

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
				dataToolPanel.current.style.gridTemplateColumns = `[column-1] 1fr [splitter] 1px [column-2] ${columnsWidth}px [end]`;

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
	 * onBeginResize handler.
	 * @returns A PositronColumnSplitterResizeParams containing the resize parameters.
	 */
	const beginResizeHandler = (): PositronColumnSplitterResizeParams => ({
		minimumWidth: MIN_COLUMN_WIDTH,
		maximumWidth: Math.trunc(2 * props.width / 3),
		startingWidth: columnsWidth,
		invert: layout === PositronDataToolLayout.ColumnsRight
	});

	/**
	 * onResize handler.
	 * @param newColumnsWidth The new columns width.
	 */
	const resizeHandler = (newColumnsWidth: number) => {
		setColumnsWidth(newColumnsWidth);
		context.instance.columnsWidthPercent = newColumnsWidth / props.width;
	};

	// Calculate the panel height.
	const panelHeight = props.height - 60;

	// Render.
	return (
		<div
			className='data-tool-container'
			style={{ width: props.width, height: props.height }}
		>
			<div
				ref={dataToolPanel}
				className='data-tool'
			>
				<div ref={column1} className='column-1'>
					<ColumnsPanel
						width={columnsWidth}
						height={panelHeight}
					/>
				</div>
				<div ref={splitter} className='splitter'>
					<PositronColumnSplitter
						onBeginResize={beginResizeHandler}
						onResize={resizeHandler}
					/>
				</div>
				<div ref={column2} className='column-2'>
					<RowsPanel
						width={props.width - columnsWidth}
						height={panelHeight}
					/>
				</div>
			</div>
		</div>
	);
};
