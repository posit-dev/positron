/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataExplorer';

// React.
import * as React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { PixelRatio } from 'vs/base/browser/pixelRatio';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { PositronDataGrid } from 'vs/workbench/browser/positronDataGrid/positronDataGrid';
import { SORTING_BUTTON_WIDTH } from 'vs/workbench/browser/positronDataGrid/components/dataGridColumnHeader';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { VerticalSplitter, VerticalSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';

/**
 * Constants.
 */
const MIN_COLUMN_WIDTH = 300;

/**
 * DataExplorer component.
 * @returns The rendered component.
 */
export const DataExplorer = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const dataExplorerRef = useRef<HTMLDivElement>(undefined!);
	const columnNameExemplar = useRef<HTMLDivElement>(undefined!);
	const typeNameExemplar = useRef<HTMLDivElement>(undefined!);
	const sortIndexExemplar = useRef<HTMLDivElement>(undefined!);
	const leftColumnRef = useRef<HTMLDivElement>(undefined!);
	const splitterRef = useRef<HTMLDivElement>(undefined!);
	const rightColumnRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [width, setWidth] = useState(0);
	const [layout, setLayout] = useState(context.instance.layout);
	const [columnsWidth, setColumnsWidth] = useState(0);
	const [animateColumnsWidth, setAnimateColumnsWidth] = useState(false);
	const [columnsCollapsed, setColumnsCollapsed] = useState(false);

	// Dynamic column width layout.
	useLayoutEffect(() => {
		// Get the window for the data explorer.
		const window = DOM.getWindow(dataExplorerRef.current);

		// Calculate the horizontal cell padding. This is a setting, so it doesn't change over the
		// lifetime of the table data data grid instance.
		const horizontalCellPadding =
			(context.instance.tableDataDataGridInstance.horizontalCellPadding * 2);

		// Set the column header width calculator. Column header widths are measured using the font
		// information from the column name exemplar and the type name exemplar. These exemplars
		// must be styled the same as the data grid title and description.
		context.instance.tableDataDataGridInstance.setColumnHeaderWidthCalculator(
			(columnName: string, typeName: string) => {
				// Calculate the basic column header width. This allows for horizontal cell padding,
				// the sorting button, and the border to be displayed, at a minimum.
				const basicColumnHeaderWidth =
					horizontalCellPadding +
					SORTING_BUTTON_WIDTH +
					1; // +1 for the border.

				// If the column header is empty, return the basic column header width.
				if (!columnName && !typeName) {
					return basicColumnHeaderWidth;
				}

				// Create a canvas and create a 2D rendering context for it to measure text.
				const canvas = window.document.createElement('canvas');
				const canvasRenderingContext2D = canvas.getContext('2d');

				// If the 2D canvas rendering context couldn't be created, return the basic column
				// header width.
				if (!canvasRenderingContext2D) {
					return basicColumnHeaderWidth;
				}

				// Set the column name width.
				let columnNameWidth;
				if (!columnName) {
					columnNameWidth = 0;
				} else {
					// Measure the column name width using the font of the column name exemplar.
					const columnNameExemplarStyle =
						DOM.getComputedStyle(columnNameExemplar.current);
					canvasRenderingContext2D.font = columnNameExemplarStyle.font;
					columnNameWidth = canvasRenderingContext2D.measureText(columnName).width;
				}

				// Set the type name width.
				let typeNameWidth;
				if (!typeName) {
					typeNameWidth = 0;
				} else {
					// Measure the type name width using the font of the type name exemplar.
					const typeNameExemplarStyle = DOM.getComputedStyle(typeNameExemplar.current);
					canvasRenderingContext2D.font = typeNameExemplarStyle.font;
					typeNameWidth = canvasRenderingContext2D.measureText(typeName).width;
				}

				// Calculate return the column header width.
				return Math.ceil(Math.max(columnNameWidth, typeNameWidth) + basicColumnHeaderWidth);
			}
		);

		// Calculate the width of a sort digit. The sort index is styled with font-variant-numeric
		// tabular-nums, so we can calculate the width of the sort index by multiplying the width of
		// a sort digit by the length of the sort index.
		const canvas = window.document.createElement('canvas');
		const canvasRenderingContext2D = canvas.getContext('2d');
		let sortIndexDigitWidth;
		if (!canvasRenderingContext2D) {
			sortIndexDigitWidth = 0;
		} else {
			const sortIndexExemplarStyle = DOM.getComputedStyle(sortIndexExemplar.current);
			canvasRenderingContext2D.font = sortIndexExemplarStyle.font;
			sortIndexDigitWidth = canvasRenderingContext2D.measureText('1').width;
		}

		// Set the sort index width calculator. Sort index widths are calculated.
		context.instance.tableDataDataGridInstance.setSortIndexWidthCalculator(sortIndex =>
			Math.ceil(sortIndex.toString().length * sortIndexDigitWidth)
		);

		// Calculate the editor font space width.
		const editorFontSpaceWidth = FontMeasurements.readFontInfo(
			window,
			BareFontInfo.createFromRawSettings(
				context.configurationService.getValue<IEditorOptions>('editor'),
				PixelRatio.getInstance(window).value
			)
		).spaceWidth;

		// Set the column value width calculator. Column value widths are calculated.
		context.instance.tableDataDataGridInstance.setColumnValueWidthCalculator(length =>
			Math.ceil(
				(editorFontSpaceWidth * length) +
				horizontalCellPadding +
				+ 1 // +1 for the border.
			)
		);

		// Add the onDidChangeConfiguration event handler.
		context.configurationService.onDidChangeConfiguration(configurationChangeEvent => {
			// When something in the editor changes, determine whether it's font-related and, if it
			// is, apply the new font info.
			if (configurationChangeEvent.affectsConfiguration('editor')) {
				if (configurationChangeEvent.affectedKeys.has('editor.fontFamily') ||
					configurationChangeEvent.affectedKeys.has('editor.fontWeight') ||
					configurationChangeEvent.affectedKeys.has('editor.fontSize') ||
					configurationChangeEvent.affectedKeys.has('editor.fontLigatures') ||
					configurationChangeEvent.affectedKeys.has('editor.fontVariations') ||
					configurationChangeEvent.affectedKeys.has('editor.lineHeight') ||
					configurationChangeEvent.affectedKeys.has('editor.letterSpacing')
				) {
					// Set the column value width calculator.
					context.instance.tableDataDataGridInstance.setColumnValueWidthCalculator(
						length => {
							// Calculate the editor font space width.
							const editorFontSpaceWidth = FontMeasurements.readFontInfo(
								window,
								BareFontInfo.createFromRawSettings(
									context.configurationService.getValue<IEditorOptions>('editor'),
									PixelRatio.getInstance(window).value
								)
							).spaceWidth;

							// Calculate the column value width using the font editor font.
							return Math.ceil(
								(editorFontSpaceWidth * length) +
								horizontalCellPadding +
								+ 1 // +1 for the border.
							);
						}
					);
				}
			}
		});

		// Return the cleanup function.
		return () => {
			context.instance.tableDataDataGridInstance.setColumnHeaderWidthCalculator(undefined);
			context.instance.tableDataDataGridInstance.setSortIndexWidthCalculator(undefined);
			context.instance.tableDataDataGridInstance.setColumnValueWidthCalculator(undefined);
		};
	}, [context.configurationService, context.instance.tableDataDataGridInstance]);

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
	}, [context.instance]);

	// Automatic layout useEffect.
	useLayoutEffect(() => {
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
	}, [context.instance.columnsWidthPercent]);

	// ColumnsWidth Layout useEffect.
	useLayoutEffect(() => {
		// Set up the columns.
		let tableSchemaColumn: HTMLDivElement;
		let tableDataColumn: HTMLDivElement;
		switch (layout) {
			// Summary on left.
			case PositronDataExplorerLayout.SummaryOnLeft:
				tableSchemaColumn = leftColumnRef.current;
				tableDataColumn = rightColumnRef.current;
				break;

			// Summary on right.
			case PositronDataExplorerLayout.SummaryOnRight:
				tableSchemaColumn = rightColumnRef.current;
				tableDataColumn = leftColumnRef.current;
				break;
		}

		// Layout the columns.
		tableDataColumn.style.width = 'auto';
		if (columnsCollapsed) {
			tableSchemaColumn.style.width = '0';
			if (animateColumnsWidth) {
				tableSchemaColumn.style.transition = 'width 0.1s ease-out';
				setAnimateColumnsWidth(false);
			}
		} else {
			tableSchemaColumn.style.width = `${columnsWidth}px`;
			if (animateColumnsWidth) {
				tableSchemaColumn.style.transition = 'width 0.1s ease-out';
				setAnimateColumnsWidth(false);
			}
		}
	}, [animateColumnsWidth, columnsCollapsed, columnsWidth, layout]);

	/**
	 * onBeginResize handler.
	 * @returns A VerticalSplitterResizeParams containing the resize parameters.
	 */
	const beginResizeHandler = (): VerticalSplitterResizeParams => ({
		minimumWidth: MIN_COLUMN_WIDTH,
		maximumWidth: Math.trunc(2 * width / 3),
		columnsWidth
	});

	/**
	 * onResize handler.
	 * @param newColumnsWidth The new columns width.
	 */
	const resizeHandler = (newColumnsWidth: number) => {
		setColumnsWidth(newColumnsWidth);
		context.instance.columnsWidthPercent = newColumnsWidth / width;
	};

	// Render.
	return (
		<div
			ref={dataExplorerRef}
			className={positronClassNames(
				'data-explorer',
				{ 'summary-on-left': layout === PositronDataExplorerLayout.SummaryOnLeft },
				{ 'summary-on-right': layout === PositronDataExplorerLayout.SummaryOnRight }
			)}
		>
			<div ref={columnNameExemplar} className='column-name-exemplar' />
			<div ref={typeNameExemplar} className='type-name-exemplar' />
			<div ref={sortIndexExemplar} className='sort-index-exemplar' />

			<div ref={leftColumnRef} className='left-column'>
				<PositronDataGrid
					configurationService={context.configurationService}
					layoutService={context.layoutService}
					instance={layout === PositronDataExplorerLayout.SummaryOnLeft ?
						context.instance.tableSchemaDataGridInstance :
						context.instance.tableDataDataGridInstance
					}
				/>
			</div>
			{layout === PositronDataExplorerLayout.SummaryOnLeft && columnsCollapsed &&
				<div className='collapsed-left-spacer' />
			}
			<div ref={splitterRef} className='splitter'>
				<VerticalSplitter
					configurationService={context.configurationService}
					invert={layout === PositronDataExplorerLayout.SummaryOnRight}
					collapsible={true}
					showSash={true}
					onBeginResize={beginResizeHandler}
					onResize={resizeHandler}
					onCollapsedChanged={collapsed => {
						setAnimateColumnsWidth(!context.accessibilityService.isMotionReduced());
						setColumnsCollapsed(collapsed);
					}}
				/>
			</div>
			{layout === PositronDataExplorerLayout.SummaryOnRight && columnsCollapsed &&
				<div className='collapsed-right-spacer' />
			}
			<div ref={rightColumnRef} className='right-column'>
				<PositronDataGrid
					configurationService={context.configurationService}
					layoutService={context.layoutService}
					instance={layout === PositronDataExplorerLayout.SummaryOnLeft ?
						context.instance.tableDataDataGridInstance :
						context.instance.tableSchemaDataGridInstance
					}
				/>
			</div>
		</div >
	);
};
