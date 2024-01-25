/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variablesInstance';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import * as DOM from 'vs/base/browser/dom';
import { isMacintosh } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { VariableItem } from 'vs/workbench/contrib/positronVariables/browser/components/variableItem';
import { VariableGroup } from 'vs/workbench/contrib/positronVariables/browser/components/variableGroup';
import { VariablesEmpty } from 'vs/workbench/contrib/positronVariables/browser/components/variablesEmpty';
import { VariableOverflow } from 'vs/workbench/contrib/positronVariables/browser/components/variableOverflow';
import { PositronColumnSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/positronColumnSplitter';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { VariableEntry, IPositronVariablesInstance, isVariableGroup, isVariableItem, isVariableOverflow } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';

/**
 * Constants.
 */
const LINE_HEIGHT = 26;
const DEFAULT_NAME_COLUMN_WIDTH = 130;
const MINIMUM_NAME_COLUMN_WIDTH = 100;
const RIGHT_COLUMN_VISIBILITY_THRESHOLD = 250;

/**
 * VariablesInstanceProps interface.
 */
interface VariablesInstanceProps {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronVariablesInstance: IPositronVariablesInstance;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
* VariablesInstance component.
* @param props A VariablesInstanceProps that contains the component properties.
* @returns The rendered component.
*/
export const VariablesInstance = (props: VariablesInstanceProps) => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

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
	const [variableEntries, setVariableEntries] = useState<VariableEntry[]>([]);
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
		disposableStore.add(props.positronVariablesInstance.onDidChangeEntries(entries => {
			// When we've received the first set of entries, we are initialized.
			setInitializing(false);

			// Set the entries.
			setVariableEntries(entries);
		}));

		// Request the initial refresh.
		props.positronVariablesInstance.requestRefresh();

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
			const selectedIndex = variableEntries.findIndex(entry => entry.id === selectedId);
			if (selectedIndex === -1) {
				setSelectedId(undefined);
			}
		}
	}, [variableEntries]);

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
		const maxScrollOffset = () => Math.max(
			(variableEntries.length * LINE_HEIGHT) - props.height,
			0
		);

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
				listRef.current.scrollTo(
					Math.min(
						scrollOffsetRef.current + props.height,
						maxScrollOffset()
					)
				);
				break;
			}

			// Up arrow key.
			case 'ArrowUp': {
				consumeEvent();
				if (!selectedId) {
					if (variableEntries.length) {
						setSelectedId(variableEntries[variableEntries.length - 1].id);
						listRef.current.scrollToItem(variableEntries.length - 1);
					}
				} else {
					const selectedIndex = variableEntries.findIndex(entry =>
						entry.id === selectedId
					);
					if (selectedIndex > 0) {
						const index = selectedIndex - 1;
						setSelectedId(variableEntries[index].id);
						listRef.current.scrollToItem(index);
					}
				}
				break;
			}

			// Down arrow key.
			case 'ArrowDown': {
				consumeEvent();
				if (!selectedId) {
					if (variableEntries.length) {
						setSelectedId(variableEntries[0].id);
						listRef.current.scrollToItem(0);
					}
				} else {
					const selectedEntryIndex = variableEntries.findIndex(entry =>
						entry.id === selectedId
					);
					if (selectedEntryIndex < variableEntries.length - 1) {
						const index = selectedEntryIndex + 1;
						setSelectedId(variableEntries[index].id);
						listRef.current.scrollToItem(index);
					}
				}
				break;
			}

			// Left arrow key.
			case 'ArrowLeft': {
				consumeEvent();
				if (selectedId) {
					const selectedEntryIndex = variableEntries.findIndex(entry =>
						entry.id === selectedId
					);
					const selectedVariableEntry = variableEntries[selectedEntryIndex];
					if (isVariableGroup(selectedVariableEntry)) {
						if (selectedVariableEntry.expanded) {
							props.positronVariablesInstance.collapseVariableGroup(
								selectedVariableEntry.id
							);
						}
					} else if (isVariableItem(selectedVariableEntry) &&
						selectedVariableEntry.hasChildren) {
						if (selectedVariableEntry.expanded) {
							props.positronVariablesInstance.collapseVariableItem(
								selectedVariableEntry.path
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
					const selectedEntryIndex = variableEntries.findIndex(entry =>
						entry.id === selectedId
					);
					const selectedVariableEntry = variableEntries[selectedEntryIndex];
					if (isVariableGroup(selectedVariableEntry)) {
						if (!selectedVariableEntry.expanded) {
							props.positronVariablesInstance.expandVariableGroup(
								selectedVariableEntry.id
							);
						}
					} else if (isVariableItem(selectedVariableEntry) &&
						selectedVariableEntry.hasChildren) {
						if (!selectedVariableEntry.expanded) {
							props.positronVariablesInstance.expandVariableItem(
								selectedVariableEntry.path
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
					const selectedEntryIndex = variableEntries.findIndex(entry =>
						entry.id === selectedId
					);
					const selectedEntry = variableEntries[selectedEntryIndex];
					if (isVariableItem(selectedEntry)) {
						consumeEvent();
						const text = await selectedEntry.formatForClipboard(
							e.shiftKey ? 'text/html' : 'text/plain'
						);
						positronVariablesContext.clipboardService.writeText(text);
					}
				}
				break;
			}
		}
	};

	/**
	 * onBeginResizeNameColumn handler.
	 * @returns A PositronColumnSplitterResizeParams containing the resize parameters.
	 */
	const beginResizeNameColumnHandler = (): PositronColumnSplitterResizeParams => ({
		minimumWidth: MINIMUM_NAME_COLUMN_WIDTH,
		maximumWidth: Math.trunc(2 * props.width / 3),
		startingWidth: nameColumnWidth
	});

	/**
	 * onResize event handler.
	 * @param newNameColumnWidth The new name column width.
	 */
	const resizeNameColumnHandler = (newNameColumnWidth: number) => {
		// Calculate the new details column width.
		const newDetailsColumnWidth = props.width - newNameColumnWidth;

		// Adjust the column widths.
		setNameColumnWidth(newNameColumnWidth);
		setDetailsColumnWidth(newDetailsColumnWidth);

		// Set the right column visibility.
		setRightColumnVisible(newDetailsColumnWidth > RIGHT_COLUMN_VISIBILITY_THRESHOLD);
	};

	/**
	 * onSelected event handler.
	 * @param index The index of the entry that was selected.
	 */
	const selectedHandler = (index: number) => {
		const entry = variableEntries[index];
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
		const selectedEntry = variableEntries[index];
		if (isVariableGroup(selectedEntry)) {
			if (selectedEntry.expanded) {
				props.positronVariablesInstance.collapseVariableGroup(
					selectedEntry.id
				);
			} else {
				props.positronVariablesInstance.expandVariableGroup(
					selectedEntry.id
				);
			}
		} else if (isVariableItem(selectedEntry) && selectedEntry.hasChildren) {
			if (selectedEntry.expanded) {
				props.positronVariablesInstance.collapseVariableItem(
					selectedEntry.path
				);
			} else {
				props.positronVariablesInstance.expandVariableItem(
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
		positronVariablesContext.reactComponentContainer.focusChanged?.(true);
	};

	/**
	 * onBlur event handler.
	 */
	const blurHandler = () => {
		setFocused(false);
		positronVariablesContext.reactComponentContainer.focusChanged?.(false);
	};

	/**
	 * VariableEntry component.
	 * @param index The index of the variable entry.
	 * @param style The style (positioning) at which to render the variable entry.
	 * @returns The rendered variable entry.
	 */
	const VariableEntry = ({ index, style }: ListChildComponentProps<VariableEntry>) => {
		// Get the entry being rendered.
		const entry = variableEntries[index];
		if (isVariableGroup(entry)) {
			return (
				<VariableGroup
					key={entry.id}
					variableGroup={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onToggleExpandCollapse={() => toggleExpandCollapseHandler(index)}
					positronVariablesInstance={props.positronVariablesInstance}
				/>
			);
		} else if (isVariableItem(entry)) {
			return (
				<VariableItem
					key={entry.id}
					nameColumnWidth={nameColumnWidth}
					detailsColumnWidth={detailsColumnWidth}
					rightColumnVisible={rightColumnVisible}
					variableItem={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onToggleExpandCollapse={() => toggleExpandCollapseHandler(index)}
					onBeginResizeNameColumn={beginResizeNameColumnHandler}
					onResizeNameColumn={resizeNameColumnHandler}
					positronVariablesInstance={props.positronVariablesInstance}
				/>
			);
		} else if (isVariableOverflow(entry)) {
			return (
				<VariableOverflow
					key={entry.id}
					nameColumnWidth={nameColumnWidth}
					detailsColumnWidth={detailsColumnWidth}
					variableOverflow={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onBeginResizeNameColumn={beginResizeNameColumnHandler}
					onResizeNameColumn={resizeNameColumnHandler}
				/>
			);
		} else {
			// It's a bug to get here.
			return null;
		}
	};

	// Render.
	return (
		<div
			ref={outerRef}
			className='variables-instance'
			style={{ width: props.width, height: props.height, zIndex: props.active ? 1 : -1 }}
			tabIndex={0}
			onKeyDown={keyDownHandler}
			onFocus={focusHandler}
			onBlur={blurHandler}
		>
			{!variableEntries.length ?
				<VariablesEmpty initializing={initializing} /> :
				<List
					className='list'
					ref={listRef}
					innerRef={innerRef}
					itemCount={variableEntries.length}
					// Use a custom item key instead of index.
					itemKey={index => variableEntries[index].id}
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
					{VariableEntry}
				</List>
			}
		</div>
	);
};
