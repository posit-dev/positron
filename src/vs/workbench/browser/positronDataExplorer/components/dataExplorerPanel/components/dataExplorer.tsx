/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataExplorer.css';

// React.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../../base/browser/dom.js';
import { PixelRatio } from '../../../../../../base/browser/pixelRatio.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { PositronDataGrid } from '../../../../positronDataGrid/positronDataGrid.js';
import { positronClassNames } from '../../../../../../base/common/positronUtilities.js';
import { IEditorOptions } from '../../../../../../editor/common/config/editorOptions.js';
import { usePositronDataExplorerContext } from '../../../positronDataExplorerContext.js';
import { FontMeasurements } from '../../../../../../editor/browser/config/fontMeasurements.js';
import { SORTING_BUTTON_WIDTH } from '../../../../positronDataGrid/components/dataGridColumnHeader.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { ColumnWidthCalculators } from '../../../../../services/positronDataExplorer/common/tableDataCache.js';
import { PositronDataExplorerLayout } from '../../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { VerticalSplitter, VerticalSplitterResizeParams } from '../../../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { SummaryRowActionBar } from './summaryRowActionBar/summaryRowActionBar.js';
import { createBareFontInfoFromRawSettings } from '../../../../../../editor/common/config/fontInfoFromSettings.js';

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
	const services = usePositronReactServicesContext();
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

		/**
		 * Creates the column header width calculator.
		 *
		 * The canvas, the exemplar fonts, and the basic column header width are all established
		 * here, once, because none of them change while the calculator is in use. The calculator
		 * that comes back reads nothing from the document, which matters because the table data
		 * cache holds it across several backend round trips and calls it once per column: reading a
		 * computed style per call cost a style resolution per column, and threw outright if the
		 * calculator was called after this component unmounted, when the exemplar refs are null.
		 * @returns The column header width calculator.
		 */
		const createColumnHeaderWidthCalculator = (): ColumnWidthCalculators['columnHeaderWidthCalculator'] => {
			// Create a canvas and a 2D rendering context for it to measure text with. The canvas is
			// never added to the document, so it stays usable for as long as the calculator is held.
			const canvas = window.document.createElement('canvas');
			const canvasRenderingContext2D = canvas.getContext('2d');

			// Measure the width of a sort digit and read the exemplar fonts. The sort index is
			// styled with font-variant-numeric tabular-nums, so we can calculate the width of the
			// sort index by multiplying the width of a sort digit by 2.
			let sortIndexWidth = 0;
			let columnNameFont = '';
			let typeNameFont = '';
			if (canvasRenderingContext2D) {
				canvasRenderingContext2D.font =
					DOM.getComputedStyle(sortIndexExemplarRef.current).font;
				sortIndexWidth = canvasRenderingContext2D.measureText('99').width;
				columnNameFont = DOM.getComputedStyle(columnNameExemplarRef.current).font;
				typeNameFont = DOM.getComputedStyle(typeNameExemplarRef.current).font;
			}

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

			return (columnName, typeName) => {
				// If the column header is empty, or text cannot be measured, return the basic
				// column header width.
				if ((!columnName && !typeName) || !canvasRenderingContext2D) {
					return basicColumnHeaderWidth;
				}

				// Measure the column name width using the font of the column name exemplar.
				let columnNameWidth = 0;
				if (columnName) {
					canvasRenderingContext2D.font = columnNameFont;
					columnNameWidth = canvasRenderingContext2D.measureText(columnName).width;
				}

				// Measure the type name width using the font of the type name exemplar.
				let typeNameWidth = 0;
				if (typeName) {
					canvasRenderingContext2D.font = typeNameFont;
					typeNameWidth = canvasRenderingContext2D.measureText(typeName).width;
				}

				// Calculate and return the column header width.
				return Math.ceil(Math.max(columnNameWidth, typeNameWidth) + basicColumnHeaderWidth);
			};
		};

		// Create the column header width calculator. Once is enough: it measures with the exemplar
		// fonts, which are the inherited workbench font plus static CSS, so nothing it depends on
		// changes over the lifetime of this component.
		const columnHeaderWidthCalculator = createColumnHeaderWidthCalculator();

		/**
		 * Creates the column width calculators. Column values are rendered in the editor font, so the
		 * column value width calculator is rebuilt whenever that font changes.
		 * @returns The column width calculators.
		 */
		const createColumnWidthCalculators = (): ColumnWidthCalculators => {
			// Get the editor font space width.
			const { spaceWidth } = FontMeasurements.readFontInfo(
				window,
				createBareFontInfoFromRawSettings(
					services.configurationService.getValue<IEditorOptions>('editor'),
					PixelRatio.getInstance(window).value
				)
			);

			return {
				columnHeaderWidthCalculator,
				columnValueWidthCalculator: length => Math.ceil(
					(spaceWidth * length) +
					horizontalCellPadding +
					1 // For the border.
				)
			};
		};

		// Set the column width calculators.
		context.instance.tableDataDataGridInstance.setColumnWidthCalculators(createColumnWidthCalculators());

		// Create a disposable store for event handlers within this layout effect
		const disposableStore = new DisposableStore();

		// Add the onDidChangeConfiguration event handler.
		disposableStore.add(services.configurationService.onDidChangeConfiguration(configurationChangeEvent => {
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
					// Rebuild the column width calculators so column values are measured with the new
					// editor font.
					context.instance.tableDataDataGridInstance.setColumnWidthCalculators(
						createColumnWidthCalculators()
					);
				}
			}
		}));

		// Return the cleanup function that disposes event listeners and cleans up resources
		return () => {
			context.instance.tableDataDataGridInstance.setColumnWidthCalculators(undefined);
			disposableStore.dispose();
		};
	}, [services.configurationService, context.instance.tableDataDataGridInstance]);

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
				setAnimateColumnsWidth(!services.accessibilityService.isMotionReduced());
				setColumnsCollapsed(true);
			}
		}));

		// Add the onDidExpandSummary event handler.
		disposableStore.add(context.instance.onDidExpandSummary(() => {
			if (columnsCollapsed) {
				setAnimateColumnsWidth(!services.accessibilityService.isMotionReduced());
				setColumnsCollapsed(false);
			}
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [columnsCollapsed, services.accessibilityService, context.instance]);

	// Automatic layout useLayoutEffect.
	useLayoutEffect(() => {
		// Set the initial width.
		const initialWidth = dataExplorerRef.current.offsetWidth;
		setWidth(initialWidth);

		// Set the initial columns width - use stored width or default
		const savedWidth = context.instance.summaryWidth;
		const columnsWidth = savedWidth > 0
			? Math.max(savedWidth, MIN_COLUMN_WIDTH)
			: DEFAULT_SUMMARY_WIDTH;
		setColumnsWidth(columnsWidth);

		// Collapse the summary panel if it would take up more than 50%
		// of the width and isn't already collapsed
		if (columnsWidth > (initialWidth * 0.5) && !context.instance.isSummaryCollapsed) {
			context.instance.collapseSummary();
			// Set the summary panel collapsed state manually here in case the
			// onDidCollapseSummary event is not registered by the time this
			// layout effect runs
			setColumnsCollapsed(true);
		}

		// Allocate and initialize the data explorer resize observer.
		const resizeObserver = new ResizeObserver(entries => {
			setWidth(entries[0].contentRect.width);
		});

		// Start observing the size of the data explorer.
		resizeObserver.observe(dataExplorerRef.current);

		// Return the cleanup function that will disconnect the resize observer.
		return () => resizeObserver.disconnect();
	}, [context.instance]);

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
				{layout === PositronDataExplorerLayout.SummaryOnLeft &&
					<SummaryRowActionBar
						instance={context.instance.tableSchemaDataGridInstance}
					/>
				}
				<div className='data-grid-container'>
					<PositronDataGrid
						instance={layout === PositronDataExplorerLayout.SummaryOnLeft ?
							context.instance.tableSchemaDataGridInstance :
							context.instance.tableDataDataGridInstance
						}
					/>
				</div>
			</div>
			{layout === PositronDataExplorerLayout.SummaryOnLeft && columnsCollapsed &&
				<div className='collapsed-left-spacer' />
			}
			<div ref={splitterRef} className='splitter'>
				<VerticalSplitter
					alwaysShowExpandCollapseButton={true}
					collapsible={true}
					invert={layout === PositronDataExplorerLayout.SummaryOnRight}
					isCollapsed={columnsCollapsed}
					showSash={true}
					onBeginResize={beginResizeHandler}
					onCollapsedChanged={collapsed => {
						setAnimateColumnsWidth(!services.accessibilityService.isMotionReduced());
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
				{layout !== PositronDataExplorerLayout.SummaryOnLeft &&
					<SummaryRowActionBar
						instance={context.instance.tableSchemaDataGridInstance}
					/>
				}
				<div className='data-grid-container'>
					<PositronDataGrid
						instance={layout === PositronDataExplorerLayout.SummaryOnLeft ?
							context.instance.tableDataDataGridInstance :
							context.instance.tableSchemaDataGridInstance
						}
					/>
				</div>
			</div>
		</div >
	);
};
