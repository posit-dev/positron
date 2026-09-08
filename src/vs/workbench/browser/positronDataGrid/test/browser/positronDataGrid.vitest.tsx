/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Testing libraries.
import { act, screen } from '@testing-library/react';

// Other dependencies.
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubGridLayoutWithSize } from '../../../../../test/vitest/stubGridLayout.js';
import { PositronDataGrid } from '../../positronDataGrid.js';
import { DataGridInstance } from '../../classes/dataGridInstance.js';

// The grid geometry every test works against. Round numbers keep the clipping arithmetic legible.
const COLUMN_WIDTH = 100;
const ROW_HEIGHT = 20;
const COLUMNS = 10;
const ROWS = 40;

// A viewport that shows a handful of columns and rows, and leaves both axes scrollable.
const VIEWPORT_WIDTH = 400;
const VIEWPORT_HEIGHT = 80;

// Scrolls the unpinned columns so that one of them straddles the pinned band: with columns 0 and 1
// pinned (a 200px band) column 3 lands at left: 150, and with only column 0 pinned (100px) column 2
// lands at left: 50. Either way, 50px of that column falls inside the band.
const HORIZONTAL_SCROLL_OFFSET = 150;

// Scrolls the unpinned rows so that row 2 lands at top: 10, 10px inside a one-row (20px) band.
const VERTICAL_SCROLL_OFFSET = 30;

/**
 * A minimal concrete data grid instance. Column and row pinning are enabled, and headers are off so
 * the grid paints nothing but cells, which is what the pinned band clipping applies to.
 * @param columnWidths Per-column widths, for the non-uniform case. Defaults to COLUMN_WIDTH each.
 * @param rowHeights Per-row heights, for the non-uniform case. Defaults to ROW_HEIGHT each.
 */
class TestDataGridInstance extends DataGridInstance {
	constructor(columnWidths?: number[], rowHeights?: number[]) {
		super({
			columnHeaders: false,
			rowHeaders: false,
			defaultColumnWidth: COLUMN_WIDTH,
			defaultRowHeight: ROW_HEIGHT,
			columnResize: false,
			rowResize: false,
			columnPinning: true,
			maximumPinnedColumns: 4,
			rowPinning: true,
			maximumPinnedRows: 4,
			horizontalScrollbar: false,
			verticalScrollbar: false,
			useEditorFont: false,
			automaticLayout: true,
			cellBorders: false,
			internalCursor: false,
		});

		// The layout managers hold the shape the grid lays out from. Real instances fill this in when
		// their data arrives; this one has a fixed shape.
		this._columnLayoutManager.setEntries(COLUMNS, columnWidths);
		this._rowLayoutManager.setEntries(ROWS, rowHeights);
	}

	get columns() {
		return COLUMNS;
	}

	get rows() {
		return ROWS;
	}

	cell(columnIndex: number, rowIndex: number) {
		return <span>{`${columnIndex},${rowIndex}`}</span>;
	}
}

describe('DataGridInstance pinned band descriptors', () => {
	// Descriptor math needs no rendering -- it's a plain class. The builder is still used for its
	// auto-disposed store and disposable-leak detection.
	const ctx = createTestContainer().build();

	/**
	 * Builds a grid whose pinned columns and rows have differing sizes, so that a band size can only
	 * come from summing the pinned entries -- not from the count times the default size.
	 */
	function newUnevenGrid(): TestDataGridInstance {
		// Columns 0 and 3 are pinned below, at 40px and 60px; rows 0 and 5 at 8px and 12px. Everything
		// else keeps its default size -- setEntries only honors a size array that covers every entry.
		const columnWidths = Array.from({ length: COLUMNS }, () => COLUMN_WIDTH);
		columnWidths[0] = 40;
		columnWidths[3] = 60;
		const rowHeights = Array.from({ length: ROWS }, () => ROW_HEIGHT);
		rowHeights[0] = 8;
		rowHeights[5] = 12;

		const instance = new TestDataGridInstance(columnWidths, rowHeights);
		ctx.disposables.add(instance);
		return instance;
	}

	it('reports the pinned column band width and shifts the unpinned columns past it', () => {
		const instance = newUnevenGrid();
		instance.pinColumn(0);
		instance.pinColumn(3);

		// The band is 40 + 60 = 100px wide, and the unpinned columns are laid out past it: column 1
		// starts the unpinned space, so its descriptor sits at 100.
		const descriptors = instance.getColumnDescriptors(0, VIEWPORT_WIDTH);
		expect({
			pinned: descriptors.pinnedColumnDescriptors,
			pinnedWidth: descriptors.pinnedColumnDescriptorsWidth,
			firstUnpinned: descriptors.unpinnedColumnDescriptors[0],
			unpinnedCount: descriptors.unpinnedColumnDescriptors.length,
		}).toMatchInlineSnapshot(`
			{
			  "firstUnpinned": {
			    "columnIndex": 1,
			    "left": 100,
			    "width": 100,
			  },
			  "pinned": [
			    {
			      "columnIndex": 0,
			      "left": 0,
			      "width": 40,
			    },
			    {
			      "columnIndex": 3,
			      "left": 40,
			      "width": 60,
			    },
			  ],
			  "pinnedWidth": 100,
			  "unpinnedCount": 3,
			}
		`);
	});

	it('reports the pinned row band height and shifts the unpinned rows past it', () => {
		const instance = newUnevenGrid();
		instance.pinRow(0);
		instance.pinRow(5);

		// The band is 8 + 12 = 20px tall, and the unpinned rows are laid out past it: row 1 starts
		// the unpinned space, so its descriptor sits at 20.
		const descriptors = instance.getRowDescriptors(0, VIEWPORT_HEIGHT);
		expect({
			pinned: descriptors.pinnedRowDescriptors,
			pinnedHeight: descriptors.pinnedRowDescriptorsHeight,
			firstUnpinned: descriptors.unpinnedRowDescriptors[0],
			unpinnedCount: descriptors.unpinnedRowDescriptors.length,
		}).toMatchInlineSnapshot(`
			{
			  "firstUnpinned": {
			    "height": 20,
			    "rowIndex": 1,
			    "top": 20,
			  },
			  "pinned": [
			    {
			      "height": 8,
			      "rowIndex": 0,
			      "top": 0,
			    },
			    {
			      "height": 12,
			      "rowIndex": 5,
			      "top": 8,
			    },
			  ],
			  "pinnedHeight": 20,
			  "unpinnedCount": 3,
			}
		`);
	});
});

describe('PositronDataGrid pinned band clipping', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let restoreLayout: () => void;
	beforeEach(() => {
		restoreLayout = stubGridLayoutWithSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
	});
	afterEach(() => {
		restoreLayout();
		vi.unstubAllGlobals();
	});

	function newGrid(): TestDataGridInstance {
		const instance = new TestDataGridInstance();
		ctx.disposables.add(instance);
		return instance;
	}

	/**
	 * Renders a data grid instance. The viewport size the real app gets from layout arrives from the
	 * stubbed ResizeObserver during the layout effect, which is also what tells the grid how many
	 * rows and columns to paint.
	 */
	function renderGrid(instance: TestDataGridInstance) {
		rtl.render(<PositronDataGrid instance={instance} />);
	}

	/**
	 * Scrolls the grid, which re-renders the rows at their new offsets.
	 */
	async function scrollTo(instance: TestDataGridInstance, horizontal: number, vertical: number) {
		await act(async () => await instance.setScrollOffsets(horizontal, vertical));
	}

	/**
	 * Reads a cell's inline clip-path. An empty string means the cell is unclipped.
	 */
	function cellClipPath(columnIndex: number, rowIndex: number) {
		return screen.getByTestId(`data-grid-row-cell-${columnIndex}-${rowIndex}`).style.clipPath;
	}

	/**
	 * Reads a cell's inline left, for the test whose point turns on where the cell sits.
	 */
	function cellLeft(columnIndex: number, rowIndex: number) {
		return screen.getByTestId(`data-grid-row-cell-${columnIndex}-${rowIndex}`).style.left;
	}

	/**
	 * Reads a row's inline top. Cells carry no top of their own; the row positions all of them.
	 */
	function rowTop(rowIndex: number) {
		return screen.getByTestId(`data-grid-row-${rowIndex}`).style.top;
	}

	it('clips the part of a cell that scrolls under the pinned columns', async () => {
		const instance = newGrid();
		instance.pinColumn(0);
		instance.pinColumn(1);
		renderGrid(instance);

		await scrollTo(instance, HORIZONTAL_SCROLL_OFFSET, 0);

		// Column 3 sits at left: 150, inside the 200px band, so its leftmost 50px has to go. Column 4
		// starts at left: 250, clear of the band, and neither pinned column paints over anything.
		expect({
			pinnedColumn0: cellClipPath(0, 0),
			pinnedColumn1: cellClipPath(1, 0),
			straddlingColumn3: cellClipPath(3, 0),
			clearColumn4: cellClipPath(4, 0),
		}).toMatchInlineSnapshot(`
			{
			  "clearColumn4": "",
			  "pinnedColumn0": "",
			  "pinnedColumn1": "",
			  "straddlingColumn3": "inset(0px 0 0 50px)",
			}
		`);
	});

	it('clips the part of a row that scrolls under the pinned rows', async () => {
		const instance = newGrid();
		instance.pinRow(0);
		renderGrid(instance);

		await scrollTo(instance, 0, VERTICAL_SCROLL_OFFSET);

		// Row 2 straddles the 20px band at top: 10, so every cell in it loses 10px off the top.
		// Row 3 starts at top: 30, clear of the band.
		expect({
			straddlingRow2Column0: cellClipPath(0, 2),
			straddlingRow2Column1: cellClipPath(1, 2),
			clearRow3Column0: cellClipPath(0, 3),
		}).toMatchInlineSnapshot(`
			{
			  "clearRow3Column0": "",
			  "straddlingRow2Column0": "inset(10px 0 0 0px)",
			  "straddlingRow2Column1": "inset(10px 0 0 0px)",
			}
		`);
	});

	it('clips against both bands at once, including the pinned cells of an unpinned row', async () => {
		const instance = newGrid();
		instance.pinColumn(0);
		instance.pinRow(0);
		renderGrid(instance);

		await scrollTo(instance, HORIZONTAL_SCROLL_OFFSET, VERTICAL_SCROLL_OFFSET);

		// The two insets compose: a cell inside both bands is clipped on both edges. A pinned column
		// still scrolls vertically, so its cell in row 2 is clipped at the top; a pinned row still
		// scrolls horizontally, so its cell in column 2 is clipped at the left.
		expect({
			pinnedRowAndColumn: cellClipPath(0, 0),
			pinnedRowOnly: cellClipPath(2, 0),
			pinnedColumnOnly: cellClipPath(0, 2),
			neitherPinned: cellClipPath(2, 2),
		}).toMatchInlineSnapshot(`
			{
			  "neitherPinned": "inset(10px 0 0 50px)",
			  "pinnedColumnOnly": "inset(10px 0 0 0px)",
			  "pinnedRowAndColumn": "",
			  "pinnedRowOnly": "inset(0px 0 0 50px)",
			}
		`);
	});

	it('leaves every cell unclipped when nothing is pinned', async () => {
		const instance = newGrid();
		renderGrid(instance);

		await scrollTo(instance, HORIZONTAL_SCROLL_OFFSET, VERTICAL_SCROLL_OFFSET);

		// Cell (1,1) is the one that could regress: it is scrolled off the left and top edges of the
		// viewport, so subtracting its negative left and top from an empty band would clip it. That
		// clip would be invisible -- the rows container already hides everything above and to the left
		// of the viewport -- so what this pins down is that a grid with nothing pinned pays no
		// clip-path cost at all. The snapshot carries the off-edge position so a later change to the
		// scroll offsets cannot quietly leave the test asserting nothing.
		expect({
			offEdgeCellLeft: cellLeft(1, 1),
			offEdgeRowTop: rowTop(1),
			offEdgeCellClipPath: cellClipPath(1, 1),
			interiorCellClipPath: cellClipPath(2, 2),
		}).toMatchInlineSnapshot(`
			{
			  "interiorCellClipPath": "",
			  "offEdgeCellClipPath": "",
			  "offEdgeCellLeft": "-50px",
			  "offEdgeRowTop": "-10px",
			}
		`);
	});
});
