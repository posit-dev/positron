/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { EnvironmentVariableItem } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableItem';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { EnvironmentVariableGroup } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableGroup';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';
import { EnvironmentEntry, IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * Constants.
 */
const LINE_HEIGHT = 26;
const DEFAULT_NAME_COLUMN_WIDTH = 130;
const MINIMUM_NAME_COLUMN_WIDTH = 100;
const TYPE_VISIBILITY_THRESHOLD = 250;

/**
 * isEnvironmentVariableGroup user-defined type guard.
 * @param _ The entry.
 * @returns Whether the entry is IEnvironmentVariableGroup.
 */
const isEnvironmentVariableGroup = (_: EnvironmentEntry): _ is IEnvironmentVariableGroup => {
	return 'title' in _;
};

/**
 * isEnvironmentVariableItem user-defined type guard.
 * @param _ The entry.
 * @returns Whether the entry is IEnvironmentVariableItem.
 */
const isEnvironmentVariableItem = (_: EnvironmentEntry): _ is IEnvironmentVariableItem => {
	return 'path' in _;
};

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
	// Reference hooks.
	const instanceRef = useRef<HTMLDivElement>(undefined!);
	const listRef = useRef<List>(undefined!);

	// State hooks.
	const [nameColumnWidth, setNameColumnWidth] = useState(DEFAULT_NAME_COLUMN_WIDTH);
	const [detailsColumnWidth, setDetailsColumnWidth] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH);
	const [typeVisible, setTypeVisible] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH > TYPE_VISIBILITY_THRESHOLD);
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

		// Set the type visibility.
		setTypeVisible(newDetailsColumnWidth > TYPE_VISIBILITY_THRESHOLD);
	}, [props.width]);

	// Entries useEffect hook.
	useEffect(() => {
		/**
		 * Helper to select the first entry, if there is one.
		 */
		const selectFirstEntry = () => {
			if (entries.length) {
				setSelectedId(entries[0].id);
			}
		};

		// If there isn't selected entry, select the first entry. Otherwise, ensure that the
		// selected entry is still exists in the entries. If it doesn't, select the first entry.
		if (!selectedId) {
			selectFirstEntry();
		} else {
			const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
			if (selectedEntryIndex === -1) {
				selectFirstEntry();
			}
		}
	}, [entries]);

	/**
	 * Handles onKeyDown events.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
				const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
				if (selectedEntryIndex > 0) {
					const index = selectedEntryIndex - 1;
					setSelectedId(entries[index].id);
					listRef.current.scrollToItem(index);
				}
				break;
			}

			// Down arrow key.
			case 'ArrowDown': {
				consumeEvent();
				const selectedEntryIndex = entries.findIndex(entry => entry.id === selectedId);
				if (selectedEntryIndex < entries.length - 1) {
					const index = selectedEntryIndex + 1;
					setSelectedId(entries[index].id);
					listRef.current.scrollToItem(index);
				}
				break;
			}

			// Left arrow key.
			case 'ArrowLeft': {
				consumeEvent();
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
				break;
			}

			// Right arrow key.
			case 'ArrowRight': {
				consumeEvent();
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
				break;
			}

			default:
				console.log(`The user pressed ${e.code}`);
				break;
		}
	};

	/**
	 * startResizeNameColumn event handler.
	 */
	const startResizeNameColumnHandler = () => {
		setResizingColumn(true);
	};

	/**
	 * resizeNameColumn event handler.
	 * @param x The X delta.
	 */
	const resizeNameColumnHandler = (x: number) => {
		resizeNameColumn(x);
	};

	/**
	 * stopResizeNameColumn event handler.
	 * @param x The X delta.
	 */
	const stopResizeNameColumnHandler = (x: number) => {
		resizeNameColumn(x);
		setResizingColumn(false);
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

		// Set the type visibility.
		setTypeVisible(newDetailsColumnWidth > TYPE_VISIBILITY_THRESHOLD);
	};

	const onEntrySelected = (index: number) => {
		setSelectedId(entries[index].id);
		instanceRef.current.focus();
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
					onSelected={() => onEntrySelected(index)}
					positronEnvironmentInstance={props.positronEnvironmentInstance}
				/>
			);
		} else if (isEnvironmentVariableItem(entry)) {
			return (
				<EnvironmentVariableItem
					nameColumnWidth={nameColumnWidth}
					detailsColumnWidth={detailsColumnWidth}
					typeVisible={typeVisible}
					environmentVariableItem={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => onEntrySelected(index)}
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
			ref={instanceRef}
			style={{ width: props.width, height: props.height, maxHeight: props.height }}
			className={classNames}
			tabIndex={0}
			hidden={props.hidden}
			onKeyDown={handleKeyDown}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
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
