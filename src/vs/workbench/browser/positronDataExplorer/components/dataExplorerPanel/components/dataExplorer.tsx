/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataExplorer.css';

// React.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../../base/browser/dom.js';
import { PixelRatio } from '../../../../../../base/browser/pixelRatio.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { BareFontInfo } from '../../../../../../editor/common/config/fontInfo.js';
import { positronClassNames } from '../../../../../../base/common/positronUtilities.js';
import { IEditorOptions } from '../../../../../../editor/common/config/editorOptions.js';
import { FontMeasurements } from '../../../../../../editor/browser/config/fontMeasurements.js';
import { PositronDataGrid } from '../../../../positronDataGrid/positronDataGrid.js';
import { SORTING_BUTTON_WIDTH } from '../../../../positronDataGrid/components/dataGridColumnHeader.js';
import { usePositronDataExplorerContext } from '../../../positronDataExplorerContext.js';
import { VerticalSplitter, VerticalSplitterResizeParams } from '../../../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { PositronDataExplorerLayout } from '../../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';

/**
 * Constants.
 */
const MIN_COLUMN_WIDTH = 300;
const DEFAULT_SUMMARY_WIDTH = 350;

/**
 * DataExplorer component.
 * @returns The rendered component.
 */
export const DataExplorer = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const dataExplorerRef = useRef<HTMLDivElement>(undefined!);
	const columnNameExemplarRef = useRef<HTMLDivElement>(undefined!);
	const typeNameExemplarRef = useRef<HTMLDivElement>(undefined!);
	const sortIndexExemplarRef = useRef<HTMLDivElement>(undefined!);
	const leftColumnRef = useRef<HTMLDivElement>(undefined!);
	const splitterRef = useRef<HTMLDivElement>(undefined!);
	const rightColumnRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [width, setWidth] = useState(0);
	const [layout, setLayout] = useState(context.instance.layout);
	const [columnsWidth, setColumnsWidth] = useState(0);
	const [animateColumnsWidth, setAnimateColumnsWidth] = useState(false);
	const [columnsCollapsed, setColumnsCollapsed] = useState(context.instance.isSummaryCollapsed);

	// Dynamic column width layout.
	useLayoutEffect(() => {
		// Get the window for the data explorer.
		const window = DOM.getWindow(dataExplorerRef.current);

		// Calculate the horizontal cell padding. This is a setting, so it doesn't change over the
		// lifetime of the table data data grid instance.
		const horizontalCellPadding =
			context.instance.tableDataDataGridInstance.horizontalCellPadding * 2;

		// Calculate the width of a sort digit. The sort index is styled with font-variant-numeric
		// tabular-nums, so we can calculate the width of the sort index by multiplying the width of
		// a sort digit by 2.
		const canvas = window.document.createElement('canvas');
		const canvasRenderingContext2D = canvas.getContext('2d');
		let sortIndexWidth;
		if (!canvasRenderingContext2D) {
			sortIndexWidth = 0;
		} else {
			const sortIndexExemplarStyle = DOM.getComputedStyle(sortIndexExemplarRef.current);
			canvasRenderingContext2D.font = sortIndexExemplarStyle.font;
			sortIndexWidth = canvasRenderingContext2D.measureText('99').width;
		}

		/**
		 * The column header width calculator.
		 * @param columnName The column name.
		 * @param typeName The type name.
		 * @returns The column header width.
		 */
		const columnHeaderWidthCalculator = (columnName: string, typeName: string) => {
			// Calculate the basic column header width. This allows for horizontal cell padding,
			// the sorting button, the sort indicator, the sort index, and the border to be
			// displayed, at a minimum.
			const basicColumnHeaderWidth =
				horizontalCellPadding +	// Horizontal cell padding.
				sortIndexWidth +		// The sort index width.
				6 +						// The sort index padding.
				20 + 					// The sort indicator width
				SORTING_BUTTON_WIDTH +	// The sorting button width.
				1;						// +1 for the border.

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
					DOM.getComputedStyle(columnNameExemplarRef.current);
				canvasRenderingContext2D.font = columnNameExemplarStyle.font;
				columnNameWidth = canvasRenderingContext2D.measureText(columnName).width;
			}

			// Set the type name width.
			let typeNameWidth;
			if (!typeName) {
				typeNameWidth = 0;
			} else {
				// Measure the type name width using the font of the type name exemplar.
				const typeNameExemplarStyle = DOM.getComputedStyle(typeNameExemplarRef.current);
				canvasRenderingContext2D.font = typeNameExemplarStyle.font;
				typeNameWidth = canvasRenderingContext2D.measureText(typeName).width;
			}

			// Calculate return the column header width.
			return Math.ceil(Math.max(columnNameWidth, typeNameWidth) + basicColumnHeaderWidth);
		};

		// Get the editor font space width.
		const { spaceWidth } = FontMeasurements.readFontInfo(
			window,
			BareFontInfo.createFromRawSettings(
				context.configurationService.getValue<IEditorOptions>('editor'),
				PixelRatio.getInstance(window).value
			)
		);

		// Set the width calculators.
		context.instance.tableDataDataGridInstance.setWidthCalculators({
			columnHeaderWidthCalculator,
			columnValueWidthCalculator: length => Math.ceil(
				(spaceWidth * length) +
				horizontalCellPadding +
				1 // For the border.
			)
		});

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
					// Get the editor font space width.
					const { spaceWidth } = FontMeasurements.readFontInfo(
						window,
						BareFontInfo.createFromRawSettings(
							context.configurationService.getValue<IEditorOptions>('editor'),
							PixelRatio.getInstance(window).value
						)
					);

					context.instance.tableDataDataGridInstance.setWidthCalculators({
						columnHeaderWidthCalculator,
						columnValueWidthCalculator: length => Math.ceil(
							(spaceWidth * length) +
							horizontalCellPadding +
							1 // For the border.
						)
					});
				}
			}
		});

		// Return the cleanup function.
		return () => {
			context.instance.tableDataDataGridInstance.setWidthCalculators(undefined);
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

		// Add the onDidCollapseSummary event handler.
		disposableStore.add(context.instance.onDidCollapseSummary(() => {
			if (!columnsCollapsed) {
				setAnimateColumnsWidth(!context.accessibilityService.isMotionReduced());
				setColumnsCollapsed(true);
			}
		}));

		// Add the onDidExpandSummary event handler.
		disposableStore.add(context.instance.onDidExpandSummary(() => {
			if (columnsCollapsed) {
				setAnimateColumnsWidth(!context.accessibilityService.isMotionReduced());
				setColumnsCollapsed(false);
			}
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [columnsCollapsed, context.accessibilityService, context.instance]);

	// Automatic layout useEffect.
	useLayoutEffect(() => {
		// Set the initial width.
		setWidth(dataExplorerRef.current.offsetWidth);

		// Set the initial columns width - use stored width or default
		const savedWidth = context.instance.summaryWidth;
		setColumnsWidth(
			savedWidth > 0 ?
				Math.max(savedWidth, MIN_COLUMN_WIDTH) :
				DEFAULT_SUMMARY_WIDTH
		);

		// Allocate and initialize the data explorer resize observer.
		const resizeObserver = new ResizeObserver(entries => {
			setWidth(entries[0].contentRect.width);
		});

		// Start observing the size of the data explorer.
		resizeObserver.observe(dataExplorerRef.current);

		// Return the cleanup function that will disconnect the resize observer.
		return () => resizeObserver.disconnect();
	}, [context.instance.summaryWidth]);

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
		startingWidth: columnsWidth
	});

	/**
	 * onResize handler.
	 * @param newColumnsWidth The new columns width.
	 */
	const resizeHandler = (newColumnsWidth: number) => {
		setColumnsWidth(newColumnsWidth);
		context.instance.summaryWidth = newColumnsWidth;
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
			<div ref={columnNameExemplarRef} className='column-name-exemplar' />
			<div ref={typeNameExemplarRef} className='type-name-exemplar' />
			<div ref={sortIndexExemplarRef} className='sort-index-exemplar' />

			<div ref={leftColumnRef} className='left-column'>
				<PositronDataGrid
					configurationService={context.configurationService}
					instance={layout === PositronDataExplorerLayout.SummaryOnLeft ?
						context.instance.tableSchemaDataGridInstance :
						context.instance.tableDataDataGridInstance
					}
					layoutService={context.layoutService}
				/>
			</div>
			{layout === PositronDataExplorerLayout.SummaryOnLeft && columnsCollapsed &&
				<div className='collapsed-left-spacer' />
			}
			<div ref={splitterRef} className='splitter'>
				<VerticalSplitter
					collapsible={true}
					configurationService={context.configurationService}
					invert={layout === PositronDataExplorerLayout.SummaryOnRight}
					isCollapsed={columnsCollapsed}
					showSash={true}
					onBeginResize={beginResizeHandler}
					onCollapsedChanged={collapsed => {
						setAnimateColumnsWidth(!context.accessibilityService.isMotionReduced());
						if (collapsed) {
							context.instance.collapseSummary();
						} else {
							context.instance.expandSummary();
						}
					}}
					onResize={resizeHandler}
				/>
			</div>
			{layout === PositronDataExplorerLayout.SummaryOnRight && columnsCollapsed &&
				<div className='collapsed-right-spacer' />
			}
			<div ref={rightColumnRef} className='right-column'>
				<PositronDataGrid
					configurationService={context.configurationService}
					instance={layout === PositronDataExplorerLayout.SummaryOnLeft ?
						context.instance.tableDataDataGridInstance :
						context.instance.tableSchemaDataGridInstance
					}
					layoutService={context.layoutService}
				/>
			</div>
		</div >
	);
};
