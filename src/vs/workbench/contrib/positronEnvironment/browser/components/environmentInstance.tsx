/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { EmptyEnvironment } from 'vs/workbench/contrib/positronEnvironment/browser/components/emptyEnvironment';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { EnvironmentVariableItem } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableItem';
import { EnvironmentVariableGroup } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableGroup';
import { EnvironmentEntry, IPositronEnvironmentInstance, isEnvironmentVariableGroup, isEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * Constants.
 */
const LINE_HEIGHT = 26;
const DEFAULT_NAME_COLUMN_WIDTH = 130;
const MINIMUM_NAME_COLUMN_WIDTH = 100;
const TYPE_SIZE_VISIBILITY_THRESHOLD = 250;

/**
 * EnvironmentInstanceProps interface.
 */
interface EnvironmentInstanceProps {
	hidden: boolean;
	width: number;
	height: number;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
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
	const instanceRef = useRef<HTMLDivElement>(undefined!);
	const listRef = useRef<List>(undefined!);

	// State hooks.
	const [nameColumnWidth, setNameColumnWidth] = useState(DEFAULT_NAME_COLUMN_WIDTH);
	const [detailsColumnWidth, setDetailsColumnWidth] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH);
	const [typeSizeVisible, setTypeSizeVisible] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH > TYPE_SIZE_VISIBILITY_THRESHOLD);
	const [entries, setEntries] = useState<EnvironmentEntry[]>([]);
	const [resizingColumn, setResizingColumn] = useState(false);
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const [focused, setFocused] = useState(false);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeState event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeState(state => {
				// TODO
			})
		);

		// Add the onDidChangeEnvironmentGrouping event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEnvironmentGrouping(() => {
				// For the moment, simply re-render everything.
				// setMarker(generateUuid());
			})
		);

		// Add the onDidChangeEnvironmentItems event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEnvironmentSorting(() => {
				// For the moment, simply re-render everything.
				// setMarker(generateUuid());
			})
		);

		// Add the onDidChangeEntries event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEntries(entries =>
				setEntries(entries)
			)
		);

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

		// Set the type / size visibility.
		setTypeSizeVisible(newDetailsColumnWidth > TYPE_SIZE_VISIBILITY_THRESHOLD);
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
	 * Handles onKeyDown events.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const handleKeyDown = async (e: KeyboardEvent<HTMLDivElement>) => {
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
				listRef.current.scrollTo(Math.max(scrollOffset - props.height, 0));
				break;
			}

			// Page down key.
			case 'PageDown': {
				consumeEvent();
				listRef.current.scrollTo(Math.min(scrollOffset + props.height, maxScrollOffset()));
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
				if (e.metaKey && selectedId) {
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
		instanceRef.current.focus();
	};

	/**
	 * onDeselected event handler.
	 */
	const deselectedHandler = () => {
		setSelectedId(undefined);
		instanceRef.current.focus();
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

		// Set the type /size visibility.
		setTypeSizeVisible(newDetailsColumnWidth > TYPE_SIZE_VISIBILITY_THRESHOLD);
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
					nameColumnWidth={nameColumnWidth}
					detailsColumnWidth={detailsColumnWidth}
					typeSizeVisible={typeSizeVisible}
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

	// If there are no environment entries, render the empty environment.
	if (!entries.length) {
		return <EmptyEnvironment />;
	}

	// Render.
	return (
		<div
			ref={instanceRef}
			style={{ width: props.width, height: props.height }}
			className={classNames}
			tabIndex={0}
			hidden={props.hidden}
			onKeyDown={handleKeyDown}
			onFocus={focusHandler}
			onBlur={blurHandler}
		>
			<List
				ref={listRef}
				itemCount={entries.length}
				itemKey={index => entries[index].id} // Use a custom item key instead of index.
				width={props.width}
				height={props.height}
				itemSize={LINE_HEIGHT}
				overscanCount={10}
				onScroll={({ scrollOffset }) => setScrollOffset(scrollOffset)}
			>
				{EnvironmentEntry}
			</List>
		</div>
	);
};
