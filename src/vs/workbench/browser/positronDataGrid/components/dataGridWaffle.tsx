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
import { DataGridRowHeaders } from 'vs/workbench/browser/positronDataGrid/components/dataGridRowHeaders';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';
import { DataGridCornerTopLeft } from 'vs/workbench/browser/positronDataGrid/components/dataGridCornerTopLeft';
import { DataGridColumnHeaders } from 'vs/workbench/browser/positronDataGrid/components/dataGridColumnHeaders';
import { DataGridScrollbarCorner } from 'vs/workbench/browser/positronDataGrid/components/dataGridScrollbarCorner';
import { DataGridSmoothScrollbar } from 'vs/workbench/browser/positronDataGrid/components/dataGridSmoothScrollbar';
import { ExtendColumnSelectionBy, ExtendRowSelectionBy } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';

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
			await context.instance.setSize(width, height);
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
					await context.instance.setScrollOffsets(0, 0);
					context.instance.setCursorPosition(0, 0);
					return;
				}

				// Home clears the selection and positions the screen and cursor to the left.
				context.instance.clearSelection();
				await context.instance.setHorizontalScrollOffset(0);
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
					await context.instance.setScrollOffsets(
						context.instance.maximumHorizontalScrollOffset,
						context.instance.maximumVerticalScrollOffset
					);
					context.instance.setCursorPosition(
						context.instance.columns - 1,
						context.instance.rows - 1
					);
					return;
				}

				// End clears the selection and positions the screen and cursor to the left.
				context.instance.clearSelection();
				await context.instance.setHorizontalScrollOffset(context.instance.maximumHorizontalScrollOffset);
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
				// the top of the page.
				context.instance.clearSelection();

				// Scroll page up.
				context.instance.scrollPageUp();
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
				// at the top of the page
				context.instance.clearSelection();

				// Scroll page down.
				context.instance.scrollPageDown();
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

		// When the user is holding the shift key, invert delta X and delta Y.
		if (e.shiftKey) {
			[deltaX, deltaY] = [deltaY, deltaX];
		}

		// If the alt key is pressed, scroll by 10 times the delta X and delta Y.
		if (e.altKey) {
			deltaX *= 10;
			deltaY *= 10;
		}

		/**
		 * Sets the scroll offsets.
		 */
		await context.instance.setScrollOffsets(
			pinToRange(
				context.instance.horizontalScrollOffset + deltaX,
				0,
				context.instance.maximumHorizontalScrollOffset
			),
			pinToRange(
				context.instance.verticalScrollOffset + deltaY,
				0,
				context.instance.maximumVerticalScrollOffset
			)
		);
	};

	// Create the data grid rows.
	const dataGridRows: JSX.Element[] = [];
	for (let rowLayoutEntry = context.instance.firstRow;
		rowLayoutEntry && rowLayoutEntry.top < context.instance.layoutBottom;
		rowLayoutEntry = context.instance.getRow(rowLayoutEntry.rowIndex + 1)
	) {
		dataGridRows.push(
			<DataGridRow
				key={`row-${rowLayoutEntry.rowIndex}`}
				width={width}
				top={rowLayoutEntry.top - context.instance.verticalScrollOffset}
				rowIndex={rowLayoutEntry.rowIndex}
			/>
		);
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
						await context.instance.setScrollOffsets(0, 0);
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
				<DataGridSmoothScrollbar
					containerWidth={width}
					containerHeight={height}
					orientation='horizontal'
					bothScrollbarsVisible={
						context.instance.horizontalScrollbar && context.instance.verticalScrollbar
					}
					scrollbarThickness={context.instance.scrollbarThickness}
					scrollSize={context.instance.scrollWidth}
					layoutSize={context.instance.layoutWidth}
					pageSize={context.instance.pageWidth}
					scrollOffset={context.instance.horizontalScrollOffset}
					maximumScrollOffset={() => context.instance.maximumHorizontalScrollOffset}
					onDidChangeScrollOffset={async scrollOffset => {
						await context.instance.setHorizontalScrollOffset(scrollOffset);
					}}
				/>
			}
			{context.instance.verticalScrollbar &&
				<DataGridSmoothScrollbar
					containerWidth={width}
					containerHeight={height}
					orientation='vertical'
					bothScrollbarsVisible={
						context.instance.horizontalScrollbar && context.instance.verticalScrollbar
					}
					scrollbarThickness={context.instance.scrollbarThickness}
					scrollSize={context.instance.scrollHeight}
					layoutSize={context.instance.layoutHeight}
					pageSize={context.instance.pageHeight}
					scrollOffset={context.instance.verticalScrollOffset}
					maximumScrollOffset={() => context.instance.maximumVerticalScrollOffset}
					onDidChangeScrollOffset={async scrollOffset => {
						await context.instance.setVerticalScrollOffset(scrollOffset);
					}}
				/>
			}
			{context.instance.horizontalScrollbar && context.instance.verticalScrollbar &&
				<DataGridScrollbarCorner
					onClick={async () => {
						await context.instance.setScrollOffsets(
							context.instance.maximumHorizontalScrollOffset,
							context.instance.maximumVerticalScrollOffset
						);
					}}
				/>
			}
			<div
				ref={dataGridRowsRef}
				className='data-grid-rows'
				style={{
					width: width - context.instance.rowHeadersWidth,
					height: height - context.instance.columnHeadersHeight,
					overflow: 'hidden'
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
