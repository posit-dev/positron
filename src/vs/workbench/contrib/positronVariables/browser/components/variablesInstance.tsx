/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variablesInstance.css';

// React.
import React, { KeyboardEvent, useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { isMacintosh, isWeb } from '../../../../../base/common/platform.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { VerticalSplitterResizeParams } from '../../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { VariableItem } from './variableItem.js';
import { VariableGroup } from './variableGroup.js';
import { VariablesEmpty } from './variablesEmpty.js';
import { VariableOverflow } from './variableOverflow.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { VariableEntry, IPositronVariablesInstance, isVariableGroup, isVariableItem, isVariableOverflow } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { RuntimeClientState } from '../../../../services/languageRuntime/common/languageRuntimeClientInstance.js';
import { IVariableItem } from '../../../../services/positronVariables/common/interfaces/variableItem.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

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
 * Row data passed to the virtualized row component via react-window's `itemData`.
 *
 * The row component (`VariableEntryRow`) is defined at module scope so its reference
 * is stable across renders. react-window calls `createElement(children, ...)` per cell,
 * so an inline children function would change component-type identity each render and
 * remount every row -- which would tear the sash element out of the DOM mid-drag and
 * break column resizing.
 */
interface VariableEntryRowData {
	readonly entries: VariableEntry[];
	readonly selectedId: string | undefined;
	readonly focused: boolean;
	readonly positronVariablesInstance: IPositronVariablesInstance;
	readonly detailsColumnWidth: number;
	readonly nameColumnWidth: number;
	readonly rightColumnVisible: boolean;
	readonly clientState: RuntimeClientState;
	readonly onSelected: (index: number) => void;
	readonly onDeselected: () => void;
	readonly onToggleExpandCollapse: (index: number) => void;
	readonly onBeginResizeNameColumn: () => VerticalSplitterResizeParams;
	readonly onResizeNameColumn: (newNameColumnWidth: number) => void;
}

/**
 * Stable row component for the virtualized variable list.
 */
const VariableEntryRow = ({ index, style, data }: ListChildComponentProps<VariableEntryRowData>) => {
	const entry = data.entries[index];
	if (isVariableGroup(entry)) {
		return (
			<VariableGroup
				key={entry.id}
				focused={data.focused}
				positronVariablesInstance={data.positronVariablesInstance}
				selected={data.selectedId === entry.id}
				style={style}
				variableGroup={entry}
				onDeselected={data.onDeselected}
				onSelected={() => data.onSelected(index)}
				onToggleExpandCollapse={() => data.onToggleExpandCollapse(index)}
			/>
		);
	} else if (isVariableItem(entry)) {
		return (
			<VariableItem
				key={entry.id}
				detailsColumnWidth={data.detailsColumnWidth}
				disabled={data.clientState === RuntimeClientState.Closed}
				focused={data.focused}
				nameColumnWidth={data.nameColumnWidth}
				positronVariablesInstance={data.positronVariablesInstance}
				rightColumnVisible={data.rightColumnVisible}
				selected={data.selectedId === entry.id}
				style={style}
				variableItem={entry}
				onBeginResizeNameColumn={data.onBeginResizeNameColumn}
				onDeselected={data.onDeselected}
				onResizeNameColumn={data.onResizeNameColumn}
				onSelected={() => data.onSelected(index)}
				onToggleExpandCollapse={() => data.onToggleExpandCollapse(index)}
			/>
		);
	} else if (isVariableOverflow(entry)) {
		return (
			<VariableOverflow
				key={entry.id}
				detailsColumnWidth={data.detailsColumnWidth}
				focused={data.focused}
				nameColumnWidth={data.nameColumnWidth}
				selected={data.selectedId === entry.id}
				style={style}
				variableOverflow={entry}
				onBeginResizeNameColumn={data.onBeginResizeNameColumn}
				onDeselected={data.onDeselected}
				onResizeNameColumn={data.onResizeNameColumn}
				onSelected={() => data.onSelected(index)}
			/>
		);
	} else {
		// It's a bug to get here.
		return null;
	}
};

/**
* VariablesInstance component.
* @param props A VariablesInstanceProps that contains the component properties.
* @returns The rendered component.
*/
export const VariablesInstance = (props: VariablesInstanceProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();
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
	const [clientState, setClientState] = useState(props.positronVariablesInstance.state);
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

		// Add the onDidChangeState event handler.
		disposableStore.add(props.positronVariablesInstance.onDidChangeState(state => {
			setClientState(state);
		}));

		// Register listener to drive focus inside the variable tree
		disposableStore.add(props.positronVariablesInstance.onFocusElement(state => {
			outerRef.current.focus();
		}));

		// Request the initial refresh.
		props.positronVariablesInstance.requestRefresh();

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [
		props.positronVariablesInstance,
		props.reactComponentContainer,
		scrollStateRef,
		setScrollState
	]);

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
	}, [nameColumnWidth, props.width]);

	// Entries useEffect hook.
	useEffect(() => {
		if (selectedId) {
			const selectedIndex = variableEntries.findIndex(entry => entry.id === selectedId);
			if (selectedIndex === -1) {
				setSelectedId(undefined);
			}
		}
	}, [selectedId, variableEntries]);

	// useEffect to scroll to recently defined variable(s).
	useEffect(() => {
		if (!listRef.current) {
			return;
		}
		for (let i = 0; i < variableEntries.length; i++) {
			const entry = variableEntries[i];
			if (isVariableItem(entry)) {
				const variable = entry as IVariableItem;
				if (variable.isRecent.get()) {
					listRef.current.scrollToItem(i);
					break;
				}
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

		// Determine that a key is pressed without any modifiers
		const noModifierKey = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

		// Determine whether the cmd or ctrl key is pressed without other modifiers.
		const onlyCmdOrCtrlKey = (isMacintosh ? e.metaKey : e.ctrlKey) &&
			(isMacintosh ? !e.ctrlKey : !e.metaKey) &&
			!e.shiftKey &&
			!e.altKey;

		if (noModifierKey) {
			// Process the code.
			switch (e.code) {
				// Home key.
				case 'Home': {
					consumeEvent();
					listRef.current.scrollTo(0);
					return;
				}

				// End key.
				case 'End': {
					consumeEvent();
					listRef.current.scrollTo(maxScrollOffset());
					return;
				}

				// Page up key.
				case 'PageUp': {
					consumeEvent();
					listRef.current.scrollTo(Math.max(scrollOffsetRef.current - props.height, 0));
					return;
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
					return;
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
					return;
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
					return;
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
					return;
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
					return;
				}

				default: {
					return;
				}
			}
		}

		if (onlyCmdOrCtrlKey) {
			switch (e.key) {
				// C key.
				case 'c': {
					// Process the key.
					if (selectedId) {
						const selectedEntryIndex = variableEntries.findIndex(entry =>
							entry.id === selectedId
						);
						const selectedEntry = variableEntries[selectedEntryIndex];
						if (isVariableItem(selectedEntry)) {
							consumeEvent();
							const text = await selectedEntry.formatForClipboard(
								e.shiftKey ? 'text/html' : 'text/plain'
							);
							services.clipboardService.writeText(text);
						}
					}
					return;
				}

				default: {
					return;
				}
			}
		}
	};

	/**
	 * onBeginResizeNameColumn handler.
	 * @returns A VerticalSplitterResizeParams containing the resize parameters.
	 */
	const beginResizeNameColumnHandler = (): VerticalSplitterResizeParams => ({
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

	// workaround for web disabling scrolling on the window to prevent URL navigation
	const wheelHandler = (e: React.WheelEvent<HTMLDivElement>) => {
		if (!isWeb) {
			return;
		}

		innerRef.current.parentElement?.scrollBy(e.deltaX, e.deltaY);
	};

	// Build the row data passed to the stable virtualized row component. Identity changes
	// each render, but `VariableEntryRow` itself is hoisted at module scope so react-window
	// re-renders rows with new props instead of unmounting and remounting them.
	const itemData: VariableEntryRowData = {
		entries: variableEntries,
		selectedId,
		focused,
		positronVariablesInstance: props.positronVariablesInstance,
		detailsColumnWidth,
		nameColumnWidth,
		rightColumnVisible,
		clientState,
		onSelected: selectedHandler,
		onDeselected: deselectedHandler,
		onToggleExpandCollapse: toggleExpandCollapseHandler,
		onBeginResizeNameColumn: beginResizeNameColumnHandler,
		onResizeNameColumn: resizeNameColumnHandler,
	};

	// Render.
	return (
		<div
			ref={outerRef}
			className={'variables-instance state-' + clientState}
			style={{ width: props.width, height: props.height, zIndex: props.active ? 1 : -1 }}
			tabIndex={0}
			onBlur={blurHandler}
			onFocus={focusHandler}
			onKeyDown={keyDownHandler}
			onWheel={wheelHandler}
		>
			{!variableEntries.length ?
				<VariablesEmpty initializing={initializing} /> :
				<List
					ref={listRef}
					className='list'
					height={props.height}
					innerRef={innerRef}
					itemCount={variableEntries.length}
					itemData={itemData}
					itemKey={index => variableEntries[index].id}
					itemSize={LINE_HEIGHT}
					overscanCount={10}
					width={props.width}
					// Use a custom item key instead of index.
					onScroll={({ scrollOffset }) => {
						// Save the scroll offset when we're active and scrolled.
						if (props.active) {
							setScrollOffset(scrollOffset);
						}
					}}
				>
					{VariableEntryRow}
				</List>
			}
		</div>
	);
};
