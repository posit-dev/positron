/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridWaffle';

// React.
import * as React from 'react';
import { forwardRef, KeyboardEvent, useEffect, useImperativeHandle, useRef, useState, WheelEvent } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { generateUuid } from 'vs/base/common/uuid';
import { isMacintosh } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { pinToRange } from 'vs/base/common/positronUtilities';
import { editorFontApplier } from 'vs/workbench/browser/editorFontApplier';
import { DataGridRow } from 'vs/workbench/browser/positronDataGrid/components/dataGridRow';
import { DataGridScrollbar } from 'vs/workbench/browser/positronDataGrid/components/dataGridScrollbar';
import { DataGridRowHeaders } from 'vs/workbench/browser/positronDataGrid/components/dataGridRowHeaders';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';
import { DataGridCornerTopLeft } from 'vs/workbench/browser/positronDataGrid/components/dataGridCornerTopLeft';
import { DataGridColumnHeaders } from 'vs/workbench/browser/positronDataGrid/components/dataGridColumnHeaders';
import { DataGridScrollbarCorner } from 'vs/workbench/browser/positronDataGrid/components/dataGridScrollbarCorner';
import { ExtendColumnSelectionBy, ExtendRowSelectionBy } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';

/**
 * Constants.
 */
const MOUSE_WHEEL_SENSITIVITY = 50;

/**
 * DataGridWaffle component.
 * @param ref The foreard ref.
 * @returns The rendered component.
 */
export const DataGridWaffle = forwardRef<HTMLDivElement>((_: unknown, ref) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Reference hooks.
	const dataGridWaffleRef = useRef<HTMLDivElement>(undefined!);
	const dataGridRowsRef = useRef<HTMLDivElement>(undefined!);

	// Customize the ref handle that is exposed.
	useImperativeHandle(ref, () => dataGridWaffleRef.current, []);

	// State hooks.
	const [width, setWidth] = useState(0);
	const [height, setHeight] = useState(0);
	const [, setRenderMarker] = useState(generateUuid());
	const [lastWheelEvent, setLastWheelEvent] = useState(0);
	const [wheelDeltaX, setWheelDeltaX] = useState(0);
	const [wheelDeltaY, setWheelDeltaY] = useState(0);

	// Main useEffect. This is where we set up event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Use the editor font, if so configured.
		if (context.instance.useEditorFont) {
			disposableStore.add(
				editorFontApplier(
					context.configurationService,
					dataGridRowsRef.current
				)
			);
		}

		// Add the onDidUpdate event handler.
		disposableStore.add(context.instance.onDidUpdate(() => {
			setRenderMarker(generateUuid());
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context.configurationService, context.instance]);

	// Layout useEffect.
	useEffect(() => {
		// Set the initial width and height.
		setWidth(dataGridWaffleRef.current.offsetWidth);
		setHeight(dataGridWaffleRef.current.offsetHeight);

		/**
		 * Sets the screen size.
		 * @returns A Promise<void> that resolves when the operation is complete.
		 */
		const setScreenSize = async (width: number, height: number) => {
			// Set the screen size.
			await context.instance.setScreenSize(width, height);
		};

		// Set the initial screen size.
		setScreenSize(
			dataGridWaffleRef.current.offsetWidth,
			dataGridWaffleRef.current.offsetHeight
		);

		// If automatic layout isn't enabled, return.
		if (!context.instance.automaticLayout) {
			return;
		}

		// Allocate and initialize the waffle resize observer.
		const resizeObserver = new ResizeObserver(async entries => {
			// Set the width and height.
			setWidth(entries[0].contentRect.width);
			setHeight(entries[0].contentRect.height);

			// Set the screen size.
			await setScreenSize(
				entries[0].contentRect.width,
				entries[0].contentRect.height
			);
		});

		// Start observing the size of the waffle.
		resizeObserver.observe(dataGridWaffleRef.current);

		// Return the cleanup function that will disconnect the resize observer.
		return () => resizeObserver.disconnect();
	}, [context.instance, dataGridWaffleRef]);

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		// Ignore onKeyDown events that arrive while we're receiving onWheelEvents.
		if (e.timeStamp - lastWheelEvent < 250) {
			return;
		}

		// Consumes the event.
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Process the code.
		switch (e.code) {
			// Space key.
			case 'Space': {

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// If selection is enabled, process the key.
				if (context.instance.selection) {
					// Consume the event only if there's an action supported for it
					consumeEvent();

					if (e.ctrlKey && !e.shiftKey) {
						context.instance.selectColumn(context.instance.cursorColumnIndex);
					} else if (e.shiftKey && !e.ctrlKey) {
						context.instance.selectRow(context.instance.cursorRowIndex);
					} if (isMacintosh ? e.metaKey : e.ctrlKey && e.shiftKey) {
						context.instance.selectAll();
					}
				}
				break;
			}

			// Enter key.
			case 'Enter': {
				break;
			}

			// Home key.
			case 'Home': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Shift + Home does nothing.
				if (e.shiftKey) {
					context.instance.extendRowSelectionUp(ExtendRowSelectionBy.Screen);
					return;
				}

				// On macOS, Ctrl + Home does nothing.
				if (isMacintosh && e.ctrlKey) {
					return;
				}

				// Cmd / Ctrl + Home clears the selection and positions the screen and cursor to the
				// top left.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					context.instance.clearSelection();
					await context.instance.setScreenPosition(0, 0);
					context.instance.setCursorPosition(0, 0);
					return;
				}

				// Home clears the selection and positions the screen and cursor to the left.
				context.instance.clearSelection();
				await context.instance.setFirstColumn(0);
				context.instance.setCursorColumn(0);
				break;
			}

			// End key.
			case 'End': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Shift + End does nothing.
				if (e.shiftKey) {
					context.instance.extendRowSelectionDown(ExtendRowSelectionBy.Screen);
					return;
				}

				// On macOS, Ctrl + End does nothing.
				if (isMacintosh && e.ctrlKey) {
					return;
				}

				// Cmd / Ctrl + End clears the selection and positions the screen and cursor to the
				// bottom right.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					context.instance.clearSelection();
					await context.instance.setScreenPosition(
						context.instance.maximumFirstColumnIndex,
						context.instance.maximumFirstRowIndex
					);
					context.instance.setCursorPosition(
						context.instance.columns - 1,
						context.instance.rows - 1
					);
					return;
				}

				// End clears the selection and positions the screen and cursor to the left.
				context.instance.clearSelection();
				await context.instance.setFirstColumn(context.instance.maximumFirstColumnIndex);
				context.instance.setCursorColumn(context.instance.columns - 1);
				break;
			}

			// Page up key.
			case 'PageUp': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Cmd / Ctrl + PageUp does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// Range selection.
				if (e.shiftKey) {
					context.instance.extendRowSelectionUp(ExtendRowSelectionBy.Page);
					return;
				}

				// PageUp clears the selection and moves up by one page, positioning the cursor at
				// the top left of the page.
				context.instance.clearSelection();
				const firstRowIndex = Math.max(
					context.instance.firstRowIndex - (e.altKey ? context.instance.visibleRows * 10 : context.instance.visibleRows),
					0
				);
				await context.instance.setFirstRow(firstRowIndex);
				context.instance.setCursorRow(firstRowIndex);
				break;
			}

			// Page down key.
			case 'PageDown': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Cmd / Ctrl + PageDown does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// Range selection.
				if (e.shiftKey) {
					context.instance.extendRowSelectionDown(ExtendRowSelectionBy.Page);
					return;
				}

				// PageDown clears the selection and moves down by one page, positioning the cursor
				// at the bottom left of the page.
				context.instance.clearSelection();
				const firstRowIndex = Math.min(
					context.instance.firstRowIndex + (e.altKey ? context.instance.visibleRows * 10 : context.instance.visibleRows),
					context.instance.maximumFirstRowIndex
				);
				await context.instance.setFirstRow(firstRowIndex);
				context.instance.setCursorRow(firstRowIndex);
				break;
			}

			// Up arrow key.
			case 'ArrowUp': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Cmd / Ctrl + ArrowUp does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection up.
					if (e.shiftKey) {
						context.instance.extendRowSelectionUp(ExtendRowSelectionBy.Row);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Move the cursor up.
				if (context.instance.cursorRowIndex > 0) {
					context.instance.setCursorRow(context.instance.cursorRowIndex - 1);
					context.instance.scrollToCursor();
				}
				break;
			}

			// Down arrow key.
			case 'ArrowDown': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Cmd / Ctrl + ArrowDown does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection down.
					if (e.shiftKey) {
						context.instance.extendRowSelectionDown(ExtendRowSelectionBy.Row);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Move the cursor down.
				if (context.instance.cursorRowIndex < context.instance.rows - 1) {
					context.instance.setCursorRow(context.instance.cursorRowIndex + 1);
					context.instance.scrollToCursor();
				}
				break;
			}

			// Left arrow key.
			case 'ArrowLeft': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Cmd / Ctrl + ArrowLeft does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection left.
					if (e.shiftKey) {
						context.instance.extendColumnSelectionLeft(ExtendColumnSelectionBy.Column);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Moves the cursor left.
				if (context.instance.cursorColumnIndex > 0) {
					context.instance.setCursorColumn(context.instance.cursorColumnIndex - 1);
					context.instance.scrollToCursor();
				}
				break;
			}

			// Right arrow key.
			case 'ArrowRight': {
				// Consume the event.
				consumeEvent();

				// Make sure the cursor is showing.
				if (context.instance.showCursor()) {
					return;
				}

				// Cmd / Ctrl + ArrowRight does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection right.
					if (e.shiftKey) {
						context.instance.extendColumnSelectionRight(ExtendColumnSelectionBy.Column);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Move the cursor right.
				context.instance.clearSelection();
				if (context.instance.cursorColumnIndex < context.instance.columns - 1) {
					context.instance.setCursorColumn(context.instance.cursorColumnIndex + 1);
					context.instance.scrollToCursor();
				}
				break;
			}
		}
	};

	/**
	 * onWheel event handler.
	 * @param e A WheelEvent<HTMLDivElement> that describes a user interaction with the mouse wheel.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	const wheelHandler = async (e: WheelEvent<HTMLDivElement>) => {
		// Record the last wheel event.
		setLastWheelEvent(e.timeStamp);

		// Get the delta X and delta Y.
		let deltaX = e.deltaX;
		let deltaY = e.deltaY;

		// When the user is holding the shift key, invert the delta X and delta Y.
		if (e.shiftKey) {
			[deltaX, deltaY] = [deltaY, deltaX];
		}

		// The predominant axis is vertical scrolling. When delta Y is greater than or equal to
		// delta X, ignore and reset the delta X and scroll vertically.
		if (Math.abs(deltaY) >= Math.abs(deltaX)) {
			// Calculate the adjusted wheel delta Y.
			const adjustedWheelDeltaY = wheelDeltaY + (e.altKey ? deltaY * 10 : deltaY);

			// Reset wheel delta X.
			setWheelDeltaX(0);

			// Determine whether there's enough delta Y to scroll one or more rows.
			const rowsToScroll = Math.trunc(adjustedWheelDeltaY / MOUSE_WHEEL_SENSITIVITY);
			if (!rowsToScroll) {
				setWheelDeltaY(adjustedWheelDeltaY);
			} else {
				await context.instance.setFirstRow(pinToRange(
					context.instance.firstRowIndex + rowsToScroll,
					0,
					context.instance.maximumFirstRowIndex
				));
				setWheelDeltaY(adjustedWheelDeltaY - (rowsToScroll * MOUSE_WHEEL_SENSITIVITY));
			}
		} else if (Math.abs(deltaX) >= Math.abs(deltaY)) {
			// Calculate the adjusted wheel delta X.
			const adjustedWheelDeltaX = wheelDeltaX + (e.altKey ? deltaX * 10 : deltaX);

			// Determine whether there's enough delta X to scroll one or more columns.
			const columnsToScroll = Math.trunc(adjustedWheelDeltaX / MOUSE_WHEEL_SENSITIVITY);
			if (columnsToScroll) {
				await context.instance.setFirstColumn(pinToRange(
					context.instance.firstColumnIndex + columnsToScroll,
					0,
					context.instance.maximumFirstColumnIndex
				));
				setWheelDeltaX(adjustedWheelDeltaX - (columnsToScroll * MOUSE_WHEEL_SENSITIVITY));
			} else {
				setWheelDeltaX(adjustedWheelDeltaX);
			}

			// Reset wheel delta Y.
			setWheelDeltaY(0);
		}
	};

	// Render the data grid rows.
	const dataGridRows: JSX.Element[] = [];
	for (let rowIndex = context.instance.firstRowIndex, top = 0;
		rowIndex < context.instance.rows && top < height;
		rowIndex++
	) {
		// Render the data grid row.
		dataGridRows.push(
			<DataGridRow
				key={`row-${rowIndex}`}
				width={width}
				top={top}
				rowIndex={rowIndex}
			/>
		);

		// Adjust the top for the next row.
		top += context.instance.getRowHeight(rowIndex);
	}

	// Render.
	return (
		<div
			ref={dataGridWaffleRef}
			tabIndex={0}
			className='data-grid-waffle'
			onKeyDown={keyDownHandler}
			onWheel={wheelHandler}
			onBlur={() => context.instance.setFocused(false)}
			onFocus={() => context.instance.setFocused(true)}
		>
			{context.instance.columnHeaders && context.instance.rowHeaders &&
				<DataGridCornerTopLeft
					onClick={async () => {
						await context.instance.setScreenPosition(0, 0);
					}}
				/>
			}

			{context.instance.columnHeaders &&
				<DataGridColumnHeaders
					width={width - context.instance.rowHeadersWidth}
					height={context.instance.columnHeadersHeight}
				/>
			}

			{context.instance.rowHeaders &&
				<DataGridRowHeaders
					height={height - context.instance.columnHeadersHeight}
				/>
			}

			{context.instance.horizontalScrollbar &&
				<DataGridScrollbar
					orientation='horizontal'
					bothScrollbarsVisible={
						context.instance.horizontalScrollbar &&
						context.instance.verticalScrollbar
					}
					scrollbarWidth={context.instance.scrollbarWidth}
					containerWidth={width}
					containerHeight={height - context.instance.columnHeadersHeight}
					entries={context.instance.columns}
					visibleEntries={context.instance.visibleColumns}
					firstEntry={context.instance.firstColumnIndex}
					maximumFirstEntry={context.instance.maximumFirstColumnIndex}
					onDidChangeFirstEntry={async firstColumnIndex =>
						await context.instance.setFirstColumn(firstColumnIndex)
					}
				/>
			}

			{context.instance.verticalScrollbar &&
				<DataGridScrollbar
					orientation='vertical'
					bothScrollbarsVisible={
						context.instance.horizontalScrollbar &&
						context.instance.verticalScrollbar
					}
					scrollbarWidth={context.instance.scrollbarWidth}
					containerWidth={width - context.instance.rowHeadersWidth}
					containerHeight={height}
					entries={context.instance.rows}
					visibleEntries={context.instance.visibleRows}
					firstEntry={context.instance.firstRowIndex}
					maximumFirstEntry={context.instance.maximumFirstRowIndex}
					onDidChangeFirstEntry={async firstRowIndex =>
						await context.instance.setFirstRow(firstRowIndex)
					}
				/>
			}

			{context.instance.horizontalScrollbar && context.instance.verticalScrollbar &&
				<DataGridScrollbarCorner
					onClick={async () => {
						await context.instance.setScreenPosition(
							context.instance.maximumFirstColumnIndex,
							context.instance.maximumFirstRowIndex
						);
					}}
				/>
			}

			<div
				ref={dataGridRowsRef}
				className='data-grid-rows'
				style={{
					width: width - context.instance.rowHeadersWidth,
					height: height - context.instance.columnHeadersHeight
				}}
			>

				<div style={{
					position: 'relative',
					margin: context.instance.rowsMargin
				}}>
					{dataGridRows}
				</div>

			</div>
		</div>
	);
});

// Set the display name.
DataGridWaffle.displayName = 'DataGridWaffle';
