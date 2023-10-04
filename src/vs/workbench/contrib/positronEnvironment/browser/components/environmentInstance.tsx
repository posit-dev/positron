/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import * as DOM from 'vs/base/browser/dom';
import { isMacintosh } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { EmptyEnvironment } from 'vs/workbench/contrib/positronEnvironment/browser/components/emptyEnvironment';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { EnvironmentVariableItem } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableItem';
import { EnvironmentVariableGroup } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableGroup';
import { EnvironmentEntry, IPositronEnvironmentInstance, isEnvironmentVariableGroup, isEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentInstance';

/**
 * Constants.
 */
const LINE_HEIGHT = 26;
const DEFAULT_NAME_COLUMN_WIDTH = 130;
const MINIMUM_NAME_COLUMN_WIDTH = 100;
const RIGHT_COLUMN_VISIBILITY_THRESHOLD = 250;

/**
 * EnvironmentInstanceProps interface.
 */
interface EnvironmentInstanceProps {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronEnvironmentInstance: IPositronEnvironmentInstance;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
* EnvironmentInstance component.
* @param props A EnvironmentInstanceProps that contains the component properties.
* @returns The rendered component.
*/
export const EnvironmentInstance = (props: EnvironmentInstanceProps) => {
	// Context hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// Reference hooks.
	const outerRef = useRef<HTMLDivElement>(undefined!);
	const listRef = useRef<List>(undefined!);
	const innerRef = useRef<HTMLElement>(undefined!);

	// State hooks.
	const [nameColumnWidth, setNameColumnWidth] = useState(DEFAULT_NAME_COLUMN_WIDTH);
	const [detailsColumnWidth, setDetailsColumnWidth] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH);
	const [rightColumnVisible, setRightColumnVisible] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH > RIGHT_COLUMN_VISIBILITY_THRESHOLD);
	const [initializing, setInitializing] = useState(true);
	const [entries, setEntries] = useState<EnvironmentEntry[]>([]);
	const [resizingColumn, setResizingColumn] = useState(false);
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const [focused, setFocused] = useState(false);
	const [, setScrollOffset, scrollOffsetRef] = useStateRef(0);
	const [, setScrollState, scrollStateRef] = useStateRef<number[] | undefined>(undefined);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSaveScrollPosition event handler.
		disposableStore.add(props.reactComponentContainer.onSaveScrollPosition(() => {
			// Save the scroll state.
			if (innerRef.current) {
				setScrollState(DOM.saveParentsScrollTop(innerRef.current));
			}
		}));

		// Add the onRestoreScrollPosition event handler.
		disposableStore.add(props.reactComponentContainer.onRestoreScrollPosition(() => {
			// Restore the scroll state.
			if (scrollStateRef.current) {
				if (innerRef.current) {
					DOM.restoreParentsScrollTop(innerRef.current, scrollStateRef.current);
				}

				// Erase the saved scroll state.
				setScrollState(undefined);
			}
		}));

		// Add the onDidChangeEntries event handler.
		disposableStore.add(props.positronEnvironmentInstance.onDidChangeEntries(entries => {
			// When we've received the first set of entries, we are initialized.
			setInitializing(false);

			// Set the entries.
			setEntries(entries);
		}));

		// Request the initial refresh.
		props.positronEnvironmentInstance.requestRefresh();

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Width useEffect hook.
	useEffect(() => {
		// Calculate the new details column width.
		const newDetailsColumnWidth = Math.max(
			props.width - nameColumnWidth,
			Math.trunc(props.width / 3)
		);

		// Adjust the column widths.
		setNameColumnWidth(props.width - newDetailsColumnWidth);
		setDetailsColumnWidth(newDetailsColumnWidth);

		// Set the right column visibility.
		setRightColumnVisible(newDetailsColumnWidth > RIGHT_COLUMN_VISIBILITY_THRESHOLD);
	}, [props.width]);

	// Entries useEffect hook.
	useEffect(() => {
		if (selectedId) {
			const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
			if (selectedEntryIndex === -1) {
				setSelectedId(undefined);
			}
		}
	}, [entries]);

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		// Consumes the event.
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Calculates the max scroll offset.
		const maxScrollOffset = () => Math.max((entries.length * LINE_HEIGHT) - props.height, 0);

		// Process the code.
		switch (e.code) {
			// Home key.
			case 'Home': {
				consumeEvent();
				listRef.current.scrollTo(0);
				break;
			}

			// End key.
			case 'End': {
				consumeEvent();
				listRef.current.scrollTo(maxScrollOffset());
				break;
			}

			// Page up key.
			case 'PageUp': {
				consumeEvent();
				listRef.current.scrollTo(Math.max(scrollOffsetRef.current - props.height, 0));
				break;
			}

			// Page down key.
			case 'PageDown': {
				consumeEvent();
				listRef.current.scrollTo(Math.min(scrollOffsetRef.current + props.height, maxScrollOffset()));
				break;
			}

			// Up arrow key.
			case 'ArrowUp': {
				consumeEvent();
				if (!selectedId) {
					if (entries.length) {
						setSelectedId(entries[entries.length - 1].id);
						listRef.current.scrollToItem(entries.length - 1);
					}
				} else {
					const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
					if (selectedEntryIndex > 0) {
						const index = selectedEntryIndex - 1;
						setSelectedId(entries[index].id);
						listRef.current.scrollToItem(index);
					}
				}
				break;
			}

			// Down arrow key.
			case 'ArrowDown': {
				consumeEvent();
				if (!selectedId) {
					if (entries.length) {
						setSelectedId(entries[0].id);
						listRef.current.scrollToItem(0);
					}
				} else {
					const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
					if (selectedEntryIndex < entries.length - 1) {
						const index = selectedEntryIndex + 1;
						setSelectedId(entries[index].id);
						listRef.current.scrollToItem(index);
					}
				}
				break;
			}

			// Left arrow key.
			case 'ArrowLeft': {
				consumeEvent();
				if (selectedId) {
					const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
					const selectedEntry = entries[selectedEntryIndex];
					if (isEnvironmentVariableGroup(selectedEntry)) {
						if (selectedEntry.expanded) {
							props.positronEnvironmentInstance.collapseEnvironmentVariableGroup(
								selectedEntry.id
							);
						}
					} else if (isEnvironmentVariableItem(selectedEntry) && selectedEntry.hasChildren) {
						if (selectedEntry.expanded) {
							props.positronEnvironmentInstance.collapseEnvironmentVariableItem(
								selectedEntry.path
							);
						}
					}
				}
				break;
			}

			// Right arrow key.
			case 'ArrowRight': {
				consumeEvent();
				if (selectedId) {
					const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
					const selectedEntry = entries[selectedEntryIndex];
					if (isEnvironmentVariableGroup(selectedEntry)) {
						if (!selectedEntry.expanded) {
							props.positronEnvironmentInstance.expandEnvironmentVariableGroup(
								selectedEntry.id
							);
						}
					} else if (isEnvironmentVariableItem(selectedEntry) && selectedEntry.hasChildren) {
						if (!selectedEntry.expanded) {
							props.positronEnvironmentInstance.expandEnvironmentVariableItem(
								selectedEntry.path
							);
						}
					}
				}
				break;
			}

			// C key.
			case 'KeyC': {
				// Process the key.
				if (isMacintosh ? e.metaKey : e.ctrlKey && selectedId) {
					const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
					const selectedEntry = entries[selectedEntryIndex];
					if (isEnvironmentVariableItem(selectedEntry)) {
						consumeEvent();
						const text = await selectedEntry.formatForClipboard(e.shiftKey ? 'text/html' : 'text/plain');
						positronEnvironmentContext.clipboardService.writeText(text);
					}
				}
				break;
			}
		}
	};

	/**
	 * onStartResizeNameColumn event handler.
	 */
	const startResizeNameColumnHandler = () => {
		setResizingColumn(true);
	};

	/**
	 * onResizeNameColumn event handler.
	 * @param x The X delta.
	 */
	const resizeNameColumnHandler = (x: number) => {
		resizeNameColumn(x);
	};

	/**
	 * onStopResizeNameColumn event handler.
	 * @param x The X delta.
	 */
	const stopResizeNameColumnHandler = (x: number) => {
		resizeNameColumn(x);
		setResizingColumn(false);
	};

	/**
	 * onSelected event handler.
	 * @param index The index of the entry that was selected.
	 */
	const selectedHandler = (index: number) => {
		const entry = entries[index];
		setSelectedId(entry.id);
		outerRef.current.focus();
	};

	/**
	 * onDeselected event handler.
	 */
	const deselectedHandler = () => {
		setSelectedId(undefined);
		outerRef.current.focus();
	};

	/**
	 * onToggleExpandCollapse event handler.
	 * @param index The index of the entry that was selected.
	 */
	const toggleExpandCollapseHandler = (index: number) => {
		const selectedEntry = entries[index];
		if (isEnvironmentVariableGroup(selectedEntry)) {
			if (selectedEntry.expanded) {
				props.positronEnvironmentInstance.collapseEnvironmentVariableGroup(
					selectedEntry.id
				);
			} else {
				props.positronEnvironmentInstance.expandEnvironmentVariableGroup(
					selectedEntry.id
				);
			}
		} else if (isEnvironmentVariableItem(selectedEntry) && selectedEntry.hasChildren) {
			if (selectedEntry.expanded) {
				props.positronEnvironmentInstance.collapseEnvironmentVariableItem(
					selectedEntry.path
				);
			} else {
				props.positronEnvironmentInstance.expandEnvironmentVariableItem(
					selectedEntry.path
				);
			}
		}
	};

	/**
	 * onFocus event handler.
	 */
	const focusHandler = () => {
		setFocused(true);
		positronEnvironmentContext.reactComponentContainer.focusChanged?.(true);
	};

	/**
	 * onBlur event handler.
	 */
	const blurHandler = () => {
		setFocused(false);
		positronEnvironmentContext.reactComponentContainer.focusChanged?.(false);
	};

	/**
	 * Resizes the name column.
	 * @param x The X delta.
	 */
	const resizeNameColumn = (x: number) => {
		// Calculate the new column widths.
		const newNameColumnWidth = Math.min(
			Math.max(nameColumnWidth + x, MINIMUM_NAME_COLUMN_WIDTH),
			Math.trunc(2 * props.width / 3)
		);
		const newDetailsColumnWidth = props.width - newNameColumnWidth;

		// Adjust the column widths.
		setNameColumnWidth(newNameColumnWidth);
		setDetailsColumnWidth(newDetailsColumnWidth);

		// Set the right column visibility.
		setRightColumnVisible(newDetailsColumnWidth > RIGHT_COLUMN_VISIBILITY_THRESHOLD);
	};

	/**
	 * EnvironmentEntry component.
	 * @param index The index of the environment entry.
	 * @param style The style (positioning) at which to render the environment entry.
	 * @returns The rendered environment entry.
	 */
	const EnvironmentEntry = ({ index, style }: ListChildComponentProps<EnvironmentEntry>) => {
		// Get the entry being rendered.
		const entry = entries[index];
		if (isEnvironmentVariableGroup(entry)) {
			return (
				// <div style={style}>Group</div>
				<EnvironmentVariableGroup
					key={entry.id}
					environmentVariableGroup={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onToggleExpandCollapse={() => toggleExpandCollapseHandler(index)}
					positronEnvironmentInstance={props.positronEnvironmentInstance}
				/>
			);
		} else if (isEnvironmentVariableItem(entry)) {
			return (
				<EnvironmentVariableItem
					key={entry.id}
					nameColumnWidth={nameColumnWidth}
					detailsColumnWidth={detailsColumnWidth}
					rightColumnVisible={rightColumnVisible}
					environmentVariableItem={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onToggleExpandCollapse={() => toggleExpandCollapseHandler(index)}
					onStartResizeNameColumn={startResizeNameColumnHandler}
					onResizeNameColumn={resizeNameColumnHandler}
					onStopResizeNameColumn={stopResizeNameColumnHandler}
					positronEnvironmentInstance={props.positronEnvironmentInstance}
				/>
			);
		} else {
			// It's a bug to get here.
			return null;
		}
	};

	// Create the class names.
	const classNames = positronClassNames(
		'environment-instance',
		{ 'resizing': resizingColumn }
	);

	// Render.
	return (
		<div
			ref={outerRef}
			className={classNames}
			style={{ width: props.width, height: props.height, zIndex: props.active ? 1 : -1 }}
			tabIndex={0}
			onKeyDown={keyDownHandler}
			onFocus={focusHandler}
			onBlur={blurHandler}
		>
			{!entries.length ?
				<EmptyEnvironment initializing={initializing} /> :
				<List
					className='list'
					ref={listRef}
					innerRef={innerRef}
					itemCount={entries.length}
					itemKey={index => entries[index].id} // Use a custom item key instead of index.
					width={props.width}
					height={props.height}
					itemSize={LINE_HEIGHT}
					overscanCount={10}
					onScroll={({ scrollOffset }) => {
						// Save the scroll offset when we're active and scrolled.
						if (props.active) {
							setScrollOffset(scrollOffset);
						}
					}}
				>
					{EnvironmentEntry}
				</List>
			}
		</div>
	);
};
